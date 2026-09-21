import { signal, type Signal } from "../../../packages/ui/src/index.ts";
import type { Shell } from "../../../packages/shell/src/index.ts";
import type { Refusal } from "../../../packages/contracts/src/index.ts";

/**
 * S1's STATE. The same shape as S2's, S3's, S6's and S8's (09 §3.5) and, for
 * the same reason they each duplicated it rather than importing a sibling,
 * duplicated again: `build-surface.ts` bundles one app at a time, and an
 * import across `apps/` is a dependency this repo does not otherwise have.
 *
 * S1 holds less than any of them. It has one read — the coverage map — and
 * the writes go through the buffer, not through here. What `lastOkAt` means
 * on this surface is also different: on a console it stamps how stale the
 * board is, and here it is the only evidence on the page that there is a
 * gateway at all.
 */
export type Resource<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "refused"; readonly refusal: Refusal };

export type Store = {
  readonly read: <T>(key: string, fetcher: () => Promise<T>) => Signal<Resource<T>>;
  readonly invalidate: (prefix: string) => void;
  readonly lastOkAt: Signal<number | null>;
  readonly notice: Signal<readonly string[]>;
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
