/**
 * THE OFFLINE SHELL — the service worker that keeps S1's and S5's pages on the
 * device, so a technician with no signal still gets a page to open their shift
 * from (tools/ci/offline-shell.ts writes `/sw.js`; this only registers it).
 *
 * Registered from the site root, so one worker serves both the front door and
 * /technician/. Where there is no worker to register — a single-surface dev
 * build, a browser without them, site data blocked — nothing happens and the
 * page works as it always has: it is an addition, never a dependency.
 */
export const OFFLINE_SHELL_SCRIPT = "/sw.js";

type WorkerHost = { readonly navigator: { readonly serviceWorker?: { register(url: string, opts: { scope: string }): Promise<unknown> } } };

export const registerOfflineShell = (w: WorkerHost): void => {
  try {
    w.navigator.serviceWorker?.register(OFFLINE_SHELL_SCRIPT, { scope: "/" }).catch(() => {});
  } catch { /* no workers here */ }
};
