import type { Refusal } from "../../contracts/src/index.ts";
import { signal, type Signal } from "./render.ts";

export type Resource<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "refused"; readonly refusal: Refusal };

export type Store = {
  readonly read: <T>(key: string, fetcher: () => Promise<T>) => Signal<Resource<T>>;
  readonly peek: <T>(key: string) => Resource<T> | null;
  readonly invalidate: (prefix: string) => void;
  readonly lastOkAt: Signal<number | null>;
  readonly notice: Signal<readonly string[]>;
  readonly version: Signal<number>;
};

export const createResourceStore = (
  shell: { readonly refusalOf: (error: unknown) => Refusal | null },
  now: () => number,
): Store => {
  const cache = new Map<string, Signal<Resource<unknown>>>();
  const lastOkAt = signal<number | null>(null);
  const notice = signal<readonly string[]>([]);
  const version = signal(0);

  const read = <T>(key: string, fetcher: () => Promise<T>): Signal<Resource<T>> => {
    const hit = cache.get(key);
    if (hit) return hit as Signal<Resource<T>>;
    const resource = signal<Resource<T>>({ state: "loading" });
    cache.set(key, resource as Signal<Resource<unknown>>);
    fetcher().then(
      (value) => { lastOkAt.value = now(); resource.value = { state: "ready", value }; },
      (error: unknown) => {
        const refusal = shell.refusalOf(error) ?? { kind: "transport", status: null, message: String(error) } as const;
        if (refusal.kind !== "transport") lastOkAt.value = now();
        resource.value = { state: "refused", refusal };
      },
    );
    return resource;
  };

  const peek = <T>(key: string): Resource<T> | null =>
    cache.get(key)?.value as Resource<T> | undefined ?? null;

  const invalidate = (prefix: string): void => {
    for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
    version.value++;
  };

  return { read, peek, invalidate, lastOkAt, notice, version };
};

export const keyOf = (operation: string, input?: Readonly<Record<string, unknown>>): string =>
  input ? `${operation}?${Object.keys(input).sort().map((key) => `${key}=${String(input[key])}`).join("&")}` : operation;
