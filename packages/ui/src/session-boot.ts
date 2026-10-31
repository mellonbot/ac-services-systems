import type { Refusal } from "../../contracts/src/index.ts";

/**
 * The cookie-session boot shared by the office and portal surfaces.
 *
 * What stays in the surface: becoming ready (its store, its home route, its
 * subscriptions), stopping a messenger, and any tick that is not the degraded
 * flag. S1 has no login. S5 signs a device in. S3 can answer a dead local
 * gateway with a preview. Those are hooks, not a second copy of this sequence.
 */
type CookieCredentials =
  | { readonly email: string; readonly password: string; readonly session: "cookie"; readonly newPassword?: string }
  | { readonly session: "cookie" };

type LiveShell = {
  isDegraded(): boolean;
  logout(): Promise<unknown>;
  gateway: { health(): Promise<unknown> };
};

const refusalOf = (e: unknown): Refusal =>
  (e as { refusal?: Refusal })?.refusal ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) };

const PROBE_MS = 15_000;

export const bindCookieSession = <P extends { readonly shell: LiveShell }, S extends LiveShell>(opts: {
  readonly degraded: { value: boolean };
  readonly now: () => number;
  /** The signed-in phase, or null while booting, at login, or in a preview. */
  readonly isReady: () => P | null;
  readonly setLogin: (busy: boolean, refusal: Refusal | null) => void;
  readonly setReady: (shell: S) => void;
  readonly connect: (credentials: CookieCredentials) => Promise<S>;
  readonly onLogout?: (ready: P) => void;
  readonly afterLogout: () => void;
  /** Return true to keep the failure — S3's local preview — instead of showing login. */
  readonly onBootFailure?: (refusal: Refusal) => boolean;
}) => {
  let lastProbe = 0;

  /** `newPassword` replaces a temporary password the office issued (0038). */
  const login = async (email: string, password: string, newPassword?: string) => {
    opts.setLogin(true, null);
    try { opts.setReady(await opts.connect({ email, password, session: "cookie", ...(newPassword ? { newPassword } : {}) })); }
    catch (e) { opts.setLogin(false, refusalOf(e)); }
  };

  const boot = async () => {
    try { opts.setReady(await opts.connect({ session: "cookie" })); }
    catch (e) {
      const r = refusalOf(e);
      if (opts.onBootFailure?.(r)) return;
      // No session is the normal first visit; anything else is worth showing.
      opts.setLogin(false, r.kind === "token" ? null : r);
    }
  };

  const logout = async () => {
    const ready = opts.isReady();
    if (!ready) return;
    opts.onLogout?.(ready);
    try { await ready.shell.logout(); }
    finally { opts.afterLogout(); }
  };

  const tick = () => {
    const ready = opts.isReady();
    if (!ready) return;
    opts.degraded.value = ready.shell.isDegraded();
  };

  const probe = () => {
    const ready = opts.isReady();
    if (!ready || !opts.degraded.value) return;
    if (opts.now() - lastProbe < PROBE_MS) return;
    lastProbe = opts.now();
    ready.shell.gateway.health().catch(() => {});
  };

  return { login, boot, logout, tick, probe };
};
