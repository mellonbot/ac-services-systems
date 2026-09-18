import { signal, type Signal } from "../../../packages/ui/src/index.ts";
import type { Shell } from "../../../packages/shell/src/index.ts";
import type { Refusal } from "../../../packages/contracts/src/index.ts";

/**
 * S6's STATE. Same shape as S2's and S3's (09 §3.5): truth is the gateway's,
 * the surface holds per-screen query results in signals keyed by the
 * operation and its input, and nothing older than the screen. For S6 this is
 * what "last known sites, work and agreements, each stamped with when the
 * gateway last answered" (SURFACES.S6.degraded) means in code: `lastOkAt` is
 * the stamp, and the resources simply stop refreshing.
 *
 * Duplicated from S2's state.ts rather than imported from it: each surface's
 * `apps/` tree builds and ships independently (build-surface.ts bundles one
 * app at a time), so an import from a sibling app is a dependency this repo
 * does not otherwise have. The same ~40 lines with S6 in the doc.
 */
export type Resource<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "refused"; readonly refusal: Refusal };

export type Store = {
  /** Read (and fetch on first read) a resource by key. Re-reading returns the same signal until invalidated. */
  readonly read: <T>(key: string, fetcher: () => Promise<T>) => Signal<Resource<T>>;
  /** Forget every resource whose key starts with the prefix; mounted readers refetch on their next render. */
  readonly invalidate: (prefix: string) => void;
  /** Epoch ms of the last answered request (any status: a refusal is a gateway that is up). Null until one answers. */
  readonly lastOkAt: Signal<number | null>;
  /** A one-line notice for the next screen — "released", a refused assignment's reason. */
  readonly notice: Signal<readonly string[]>;
  /** Bumped by invalidate(); a screen that reads it re-renders and re-reads its resources. */
  readonly version: Signal<number>;
};

export const createStore = (shell: Pick<Shell, "refusalOf">, now: () => number): Store => {
  const cache = new Map<string, Signal<Resource<unknown>>>();
  const lastOkAt = signal<number | null>(null);
  const notice = signal<readonly string[]>([]);
  const version = signal(0);

  const read = <T>(key: string, fetcher: () => Promise<T>): Signal<Resource<T>> => {
    const hit = cache.get(key);
    if (hit) return hit as Signal<Resource<T>>;
    const s = signal<Resource<T>>({ state: "loading" });
    cache.set(key, s as Signal<Resource<unknown>>);
    fetcher().then(
      (value) => { lastOkAt.value = now(); s.value = { state: "ready", value }; },
      (e: unknown) => {
        const refusal = shell.refusalOf(e) ?? { kind: "transport", status: null, message: String(e) } as const;
        if (refusal.kind !== "transport") lastOkAt.value = now();
        s.value = { state: "refused", refusal };
      },
    );
    return s;
  };

  const invalidate = (prefix: string) => {
    for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
    version.value++;
  };

  return { read, invalidate, lastOkAt, notice, version };
};

/** Stable key for a query: the operation id plus its input, in key order. */
export const keyOf = (op: string, input?: Readonly<Record<string, unknown>>): string =>
  input ? `${op}?${Object.keys(input).sort().map((k) => `${k}=${String(input[k])}`).join("&")}` : op;
