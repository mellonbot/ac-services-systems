import type { OperationId } from "../../contracts/src/index.ts";
import { signal, type ReadonlySignal } from "./render.ts";

/**
 * THE SCREEN REGISTRY AND ITS ROUTER (09 §3.4).
 *
 * A surface declares `SCREENS`: id → path pattern + the operations it uses.
 * The router is built from it; the navigation is emitted from it; the guard
 * checks that every operation a screen names is one its surface is admitted
 * to call in OPERATIONS. A screen that reaches for an operation its surface
 * does not have fails the build, not the demo.
 *
 * ~60 lines of our own over the History API. Not `URLPattern` — Node 22 and
 * the older Safari baseline lack it — and not a library, because screens are
 * data the guard can read only if the shape stays ours.
 */
export type ScreenSpec = {
  /** `/accounts/:orgId?` — `:name` binds a segment; a trailing `?` makes it optional. */
  readonly path: string;
  readonly uses: readonly OperationId[];
  /** Shown in the emitted navigation; screens without a title are reachable but not listed. */
  readonly title?: string;
};

export type Params = Readonly<Record<string, string>>;

/** Pattern → path. `null` when it does not match. Segments are exact; params are decoded. */
export const matchPath = (pattern: string, path: string): Params | null => {
  const pat = pattern.split("/").filter(Boolean);
  const seg = path.split("?")[0]!.split("/").filter(Boolean);
  const out: Record<string, string> = {};
  let i = 0;
  for (; i < pat.length; i++) {
    const p = pat[i]!;
    const s = seg[i];
    if (p.startsWith(":")) {
      const optional = p.endsWith("?");
      const name = p.slice(1, optional ? -1 : undefined);
      if (s === undefined) { if (optional) continue; return null; }
      out[name] = decodeURIComponent(s);
    } else if (s !== p) return null;
  }
  return seg.length > pat.length ? null : out;
};

/** Pattern + params → path. A missing required param throws; a missing optional one is omitted. */
export const buildPath = (pattern: string, params: Params = {}): string => {
  const parts = pattern.split("/").filter(Boolean).flatMap((p) => {
    if (!p.startsWith(":")) return [p];
    const optional = p.endsWith("?");
    const name = p.slice(1, optional ? -1 : undefined);
    const v = params[name];
    if (v === undefined) { if (optional) return []; throw new Error(`route ${pattern} needs :${name}`); }
    return [encodeURIComponent(v)];
  });
  return `/${parts.join("/")}`;
};

export type Location<S extends Record<string, ScreenSpec>> = { readonly screen: keyof S & string; readonly params: Params };

/** What the router needs from the browser, as an interface so a test can hand it a fake. */
export type History = {
  readonly path: () => string;
  readonly push: (path: string) => void;
  /** Subscribe to back/forward; returns unsubscribe. */
  readonly onPop: (cb: () => void) => () => void;
};

export type Router<S extends Record<string, ScreenSpec>> = {
  readonly current: ReadonlySignal<Location<S> | null>;
  readonly resolve: (path: string) => Location<S> | null;
  readonly href: <K extends keyof S & string>(screen: K, params?: Params) => string;
  readonly navigate: <K extends keyof S & string>(screen: K, params?: Params) => void;
  /** Begin listening to the history; returns stop. */
  readonly start: () => () => void;
};

/** First declared match wins: order the registry from specific to general. */
export const createRouter = <S extends Record<string, ScreenSpec>>(screens: S, history: History): Router<S> => {
  const resolve = (path: string): Location<S> | null => {
    for (const id of Object.keys(screens) as (keyof S & string)[]) {
      const params = matchPath(screens[id]!.path, path);
      if (params) return { screen: id, params };
    }
    return null;
  };
  const current = signal<Location<S> | null>(resolve(history.path()));
  const href: Router<S>["href"] = (screen, params) => buildPath(screens[screen]!.path, params);
  return {
    current,
    resolve,
    href,
    navigate: (screen, params) => { const p = href(screen, params); history.push(p); current.value = resolve(p); },
    start: () => history.onPop(() => { current.value = resolve(history.path()); }),
  };
};

/** The browser's History API in the router's shape. Not called under node --test; the tests hand in a fake. */
export const browserHistory = (w: { location: { pathname: string }; history: { pushState: (s: unknown, t: string, u: string) => void }; addEventListener: (t: "popstate", cb: () => void) => void; removeEventListener: (t: "popstate", cb: () => void) => void }): History => ({
  path: () => w.location.pathname,
  push: (p) => w.history.pushState(null, "", p),
  onPop: (cb) => { w.addEventListener("popstate", cb); return () => w.removeEventListener("popstate", cb); },
});
