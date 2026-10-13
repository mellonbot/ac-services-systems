/**
 * THE CONTAINER'S PID 1 — runs the gateway and the worker as two Node
 * processes in one container and ties their fates together: if either exits,
 * the other is stopped and the container exits non-zero, so the platform
 * restarts the pair rather than leaving a gateway up with no relay behind it
 * (or a relay running against a gateway that is gone).
 *
 * SIGTERM from the platform (a rollout, an inactivity stop) is forwarded to
 * both and the exit is clean. Fifteen minutes is the platform's patience
 * before SIGKILL; ours is five seconds, which is more than either needs.
 */
import { spawn } from "node:child_process";

const GRACE_MS = 5_000;
const children = new Map();
let stopping = false;

const gone = (child) => child.exitCode !== null || child.signalCode !== null;

const stop = (code) => {
  if (stopping) return;
  stopping = true;
  // Set first: if the event loop drains before the race settles, Node's own
  // exit still carries this code rather than 0.
  process.exitCode = code;
  for (const child of children.values()) if (!gone(child)) child.kill("SIGTERM");
  const exits = [...children.values()].map((c) => gone(c) ? Promise.resolve() : new Promise((r) => c.once("exit", r)));
  // Not unref'd: the deadline must hold the loop open, or a child that was
  // killed by a signal (exitCode null, signalCode set) would end the process
  // as a clean 0 before anyone decided it was not.
  const deadline = new Promise((r) => setTimeout(r, GRACE_MS));
  Promise.race([Promise.all(exits), deadline]).then(() => process.exit(code));
};

const run = (name, entry, extraEnv = {}) => {
  const child = spawn(process.execPath, [entry], { stdio: "inherit", env: { ...process.env, ...extraEnv } });
  children.set(name, child);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${name} exited (${signal ?? `code ${code}`}); stopping the container so the platform restarts both`);
    stop(code ?? 1);
  });
  child.on("error", (e) => { console.error(`${name} failed to start:`, e.message); stop(1); });
};

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));

run("gateway", "apps/gateway/src/main.ts");
run("worker", "apps/worker/src/main.ts");
