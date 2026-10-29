import { test } from "node:test";
import assert from "node:assert/strict";
import type { Refusal } from "../../contracts/src/index.ts";
import { bindCookieSession } from "./session-boot.ts";

type Shell = {
  isDegraded(): boolean;
  logout(): Promise<unknown>;
  gateway: { health(): Promise<unknown> };
};

const token: Refusal = { kind: "token", code: "expired", message: "gone" };
const transport: Refusal = { kind: "transport", status: null, message: "down" };

const harness = (opts?: { readonly onBootFailure?: (r: Refusal) => boolean }) => {
  const calls: string[] = [];
  const degraded = { value: false };
  let now = 20_000;
  let ready: { shell: Shell } | null = null;
  let login: { busy: boolean; refusal: Refusal | null } | null = null;
  const healths: number[] = [];
  const shell: Shell = {
    isDegraded: () => true,
    logout: async () => { calls.push("logout"); },
    gateway: { health: async () => { healths.push(now); } },
  };
  const session = bindCookieSession({
    degraded,
    now: () => now,
    isReady: () => ready,
    setLogin: (busy, refusal) => { login = { busy, refusal }; },
    setReady: (next) => { ready = { shell: next }; login = null; },
    connect: async (credentials) => {
      calls.push("session" in credentials && "email" in credentials ? `login:${credentials.email}` : "boot");
      if ("email" in credentials && credentials.email === "bad") throw Object.assign(new Error("nope"), { refusal: transport });
      if (!("email" in credentials) && calls.includes("boot-token")) throw Object.assign(new Error("expired"), { refusal: token });
      if (!("email" in credentials) && calls.includes("boot-down")) throw new Error("socket");
      return shell;
    },
    onLogout: () => { calls.push("stop"); },
    afterLogout: () => { calls.push("after"); ready = null; },
    ...(opts?.onBootFailure ? { onBootFailure: opts.onBootFailure } : {}),
  });
  return { session, calls, degraded, healths, shell, setNow: (n: number) => { now = n; }, ready: () => ready, login: () => login };
};

test("login failure shows the refusal and a token-less boot does not", async () => {
  const h = harness();
  await h.session.login("bad", "pw");
  assert.deepEqual(h.login(), { busy: false, refusal: transport });
  assert.equal(h.ready(), null);

  const boot = harness();
  boot.calls.push("boot-token");
  await boot.session.boot();
  assert.deepEqual(boot.login(), { busy: false, refusal: null });

  const down = harness();
  down.calls.push("boot-down");
  await down.session.boot();
  const shown = down.login();
  assert.equal(shown?.busy, false);
  assert.equal(shown?.refusal?.kind, "transport");
  assert.equal(shown?.refusal?.message, "socket");
});

test("a boot failure the surface claims is not turned into login", async () => {
  let claimed = false;
  const h = harness({ onBootFailure: () => { claimed = true; return true; } });
  h.calls.push("boot-down");
  await h.session.boot();
  assert.equal(claimed, true);
  assert.equal(h.login(), null);
  assert.equal(h.ready(), null);
});

test("logout runs the surface hook, then the shell, then the reset", async () => {
  const h = harness();
  await h.session.logout();
  assert.deepEqual(h.calls, []);

  await h.session.login("ada@ac.test", "pw");
  assert.equal(h.ready()?.shell, h.shell);
  await h.session.logout();
  assert.deepEqual(h.calls, ["login:ada@ac.test", "stop", "logout", "after"]);
  assert.equal(h.ready(), null);
});

test("the degraded flag is read only while ready, and health is probed at 15s", async () => {
  const h = harness();
  h.session.tick();
  h.session.probe();
  assert.equal(h.degraded.value, false);
  assert.deepEqual(h.healths, []);

  await h.session.login("ada@ac.test", "pw");
  h.session.tick();
  assert.equal(h.degraded.value, true);
  h.session.probe();
  h.session.probe();
  assert.deepEqual(h.healths, [20_000]);
  h.setNow(35_000);
  h.session.probe();
  assert.deepEqual(h.healths, [20_000, 35_000]);
});
