import { signal, type Signal } from "../../../packages/ui/src/index.ts";
import type { Shell } from "../../../packages/shell/src/index.ts";
import type { Refusal } from "../../../packages/contracts/src/index.ts";

/**
 * S5's STATE — the same read/invalidate/notice shape as S2's and S3's
 * (09 §3.5). Duplicated rather than imported for the reason state.ts always
 * gives: `apps/s5-technician` stops at the shell (schema-guard.ts's
 * "dependencies point one way"), and a generic import from a sibling `apps/`
 * tree is a coupling this repo does not otherwise have.
 *
 * What differs from S2/S3 in how this gets USED, not in this file: S5 is
 * read-only from the LAST FETCH the same way, but a write here never waits
 * on this store's freshness — see ./offline.ts. The two are independent
 * because the whole point of item 4's field surface is that a stale read and
 * a queued write are not the same kind of stale.
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

export const keyOf = (op: string, input?: Readonly<Record<string, unknown>>): string =>
  input ? `${op}?${Object.keys(input).sort().map((k) => `${k}=${String(input[k])}`).join("&")}` : op;
