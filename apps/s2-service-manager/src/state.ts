import { signal, type Signal } from "../../../packages/ui/src/index.ts";
import type { Shell } from "../../../packages/shell/src/index.ts";
import type { Refusal } from "../../../packages/contracts/src/index.ts";

/**
 * S2's STATE (09 §3.5). Truth is the gateway's. The surface holds per-screen
 * query results in signals keyed by the operation and its input, and nothing
 * older than the screen: "read-only from last server state" in degraded mode
 * is exactly the signals currently mounted.
 *
 * There is no client-side store of domain state. `invalidate()` forgets a
 * prefix and the next read refetches — which is also the only behaviour that
 * is correct after a missed event, because envelopes carry no payload.
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
  /** A one-line notice for the next screen — "created", "moved with 3 descendants", a D14 caveat. */
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
