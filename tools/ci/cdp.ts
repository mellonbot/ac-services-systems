/**
 * A CHROME DEVTOOLS PROTOCOL CLIENT IN ONE FILE, zero install.
 *
 * `packages/ui` renders to a string under `node --test`, and 61 tests say the
 * markup is right. They cannot say the PAGE is right, because the two defects
 * C4 shipped with were both invisible to a string render:
 *
 *   - `value="USD"` set Preact's DOM *property*, so `form.reset()` restored the
 *     field to its empty *attribute*. The markup is identical either way.
 *   - a pill printed `background_check` where the chips beside it printed
 *     "background check" — a render test asserts what the component was told,
 *     not what two components agreed on.
 *
 * Both need a real DOM, a real form, and two actions in a row. That is what
 * this is for. Node 22 has a global WebSocket, so this needs nothing installed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where a headless Chrome might be. AC_CHROME wins; otherwise the first that exists. */
const CANDIDATES = [
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter((p): p is string => typeof p === "string" && p.length > 0);

/**
 * AC_CHROME is authoritative when set. Falling back from a path somebody typed
 * on purpose means a typo silently drives a different browser than the one the
 * run was pinned to, which is the same class of quiet failure as a skip.
 */
export const findChrome = (): string | null => {
  const pinned = process.env.AC_CHROME?.trim();
  if (pinned) return existsSync(pinned) ? pinned : null;
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  return null;
};

type Msg = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };

export class Cdp {
  private ws!: WebSocket;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private proc!: ChildProcess;
  private profile!: string;
  sessionId = "";

  static async launch(chrome: string): Promise<Cdp> {
    const c = new Cdp();
    c.profile = mkdtempSync(join(tmpdir(), "ac-drive-"));
    c.proc = spawn(chrome, [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
      "--remote-debugging-port=0", `--user-data-dir=${c.profile}`, "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const endpoint = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const to = setTimeout(() => reject(new Error(`chrome did not print a debugger endpoint\n${buf}`)), 20_000);
      c.proc.stderr!.on("data", (d) => {
        buf += String(d);
        const m = buf.match(/ws:\/\/[^\s]+/);
        if (m) { clearTimeout(to); resolve(m[0]); }
      });
      c.proc.on("exit", (code) => { clearTimeout(to); reject(new Error(`chrome exited ${code}\n${buf}`)); });
    });

    c.ws = new WebSocket(endpoint);
    await new Promise<void>((res, rej) => { c.ws.onopen = () => res(); c.ws.onerror = () => rej(new Error("cdp socket failed")); });
    c.ws.onmessage = (ev) => {
      const m: Msg = JSON.parse(String(ev.data));
      if (m.id === undefined) return;
      const p = c.pending.get(m.id);
      if (!p) return;
      c.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result ?? {});
    };
    return c;
  }

  send(method: string, params: Record<string, unknown> = {}, useSession = true): Promise<Record<string, unknown>> {
    const id = this.next++;
    const payload: Msg = { id, method, params };
    if (useSession && this.sessionId) payload.sessionId = this.sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30_000);
    });
  }

  async openTab(url: string): Promise<void> {
    const { targetId } = await this.send("Target.createTarget", { url }, false) as { targetId: string };
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true }, false) as { sessionId: string };
    this.sessionId = sessionId;
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }

  async navigate(url: string): Promise<void> { await this.send("Page.navigate", { url }); }

  /** Evaluate in the page and return the value. Throws the page's own error, not a wrapper. */
  async eval<T>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }) as
      { result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Poll an expression until it is truthy. The message names what was waited for, because a timeout with no subject is a mystery. */
  async waitFor(expression: string, what: string, ms = 15_000): Promise<void> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await this.eval<boolean>(`!!(${expression})`)) return;
      if (Date.now() > deadline) {
        const seen = await this.eval<string>(`document.body ? document.body.innerText.slice(0, 600) : "(no body)"`).catch(() => "(unreadable)");
        throw new Error(`timed out waiting for ${what}\n--- page text ---\n${seen}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async close(): Promise<void> {
    try { this.ws.close(); } catch { /* already gone */ }
    this.proc?.kill("SIGKILL");
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
