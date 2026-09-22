import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { bootBudgetMs, awaitEndpoint, COLD_START_OBSERVED_MS } from "./cdp.ts";

/**
 * A STAND-IN FOR CHROME, so the budget can be tested without a browser.
 *
 * The unit under test reads one thing off a child process: a ws:// line on
 * stderr, before a deadline. A node one-liner produces exactly that, on demand,
 * late or never — which is the whole behaviour space the deadline governs.
 */
const stubChrome = (script: string): ChildProcess =>
  spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });

const prints = (afterMs: number) =>
  `setTimeout(() => { process.stderr.write("DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc\\n"); }, ${afterMs})`;

const silentFor = (ms: number) => `setTimeout(() => {}, ${ms})`;

test("the defect this exists for: a cold Chrome that needs longer than 20s is not killed", async () => {
  // Run 35661724377 attempt 1, verbatim: "chrome did not print a debugger
  // endpoint" at cdp.ts:64, after 0 checks, on the FIRST browser drive of the
  // job. Chrome had not crashed — it was still writing dbus warnings at 19s
  // when the 20s deadline fired.
  //
  // The cold launch is the first in the job, so it pays for a page-cache miss
  // on the binary and a fresh profile. Measured on ubuntu-latest: 9.9s and
  // 15.5s on the two green runs of this same commit, and over 20s on the red
  // one. Warm launches later in the same job: 2.6s.
  //
  // So the budget has to clear the cold start with real headroom, not sit
  // inside its noise band.
  assert.ok(
    bootBudgetMs() >= 3 * COLD_START_OBSERVED_MS,
    `budget ${bootBudgetMs()}ms must be at least 3x the observed cold start ${COLD_START_OBSERVED_MS}ms`,
  );
  assert.ok(bootBudgetMs() >= 60_000, `budget ${bootBudgetMs()}ms is below the 60s floor`);
});

test("an endpoint printed late, but inside the budget, is adopted", async () => {
  const proc = stubChrome(prints(300));
  try {
    const endpoint = await awaitEndpoint(proc, 5_000);
    assert.equal(endpoint, "ws://127.0.0.1:9222/devtools/browser/abc");
  } finally {
    proc.kill("SIGKILL");
  }
});

test("a chrome that never advertises is refused, and the message names the budget it blew", async () => {
  const proc = stubChrome(silentFor(5_000));
  try {
    await assert.rejects(
      awaitEndpoint(proc, 300),
      (e: Error) => {
        assert.match(e.message, /did not print a debugger endpoint/);
        // A deadline with no number is a mystery to whoever reads the red run.
        assert.match(e.message, /300ms/);
        return true;
      },
    );
  } finally {
    proc.kill("SIGKILL");
  }
});

test("a chrome that exits is refused immediately, not after the budget", async () => {
  // The exit path must not wait out the deadline: a browser that died at 1s
  // should not cost 60s of CI before saying so.
  const started = Date.now();
  const proc = stubChrome(`process.exit(3)`);
  await assert.rejects(awaitEndpoint(proc, 30_000), /chrome exited 3/);
  assert.ok(Date.now() - started < 10_000, "an exited chrome was waited out instead of reported");
});

test("AC_CHROME_BOOT_MS overrides the budget, for a runner that is slower still", () => {
  const prev = process.env.AC_CHROME_BOOT_MS;
  try {
    process.env.AC_CHROME_BOOT_MS = "90000";
    assert.equal(bootBudgetMs(), 90_000);
  } finally {
    if (prev === undefined) delete process.env.AC_CHROME_BOOT_MS; else process.env.AC_CHROME_BOOT_MS = prev;
  }
});

test("a malformed AC_CHROME_BOOT_MS is an error, not a silent default", () => {
  // Falling back to the default from a value somebody typed on purpose is the
  // same class of quiet failure as findChrome falling back from AC_CHROME.
  const prev = process.env.AC_CHROME_BOOT_MS;
  try {
    for (const bad of ["nonsense", "0", "-5", ""]) {
      process.env.AC_CHROME_BOOT_MS = bad;
      if (bad === "") { assert.equal(bootBudgetMs(), 60_000); continue; }
      assert.throws(() => bootBudgetMs(), /AC_CHROME_BOOT_MS/, `${JSON.stringify(bad)} was accepted`);
    }
  } finally {
    if (prev === undefined) delete process.env.AC_CHROME_BOOT_MS; else process.env.AC_CHROME_BOOT_MS = prev;
  }
});
