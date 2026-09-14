/**
 * Non-negotiable #5 — object storage behind our own interface.
 *
 * A StorageKey is `region/org/kind/id`. It carries NO bucket, NO host, NO
 * vendor. The day storage moves, or a region has to be pinned for data
 * residency, the difference is a config change versus a data migration with
 * four years of job photos in it.
 */
declare const brand: unique symbol;
export type StorageKey = string & { readonly [brand]: "StorageKey" };

const SEGMENT = /^[a-zA-Z0-9_-]+$/;

export const storageKey = (
  regionId: string, orgId: string, kind: string, id: string,
): StorageKey => {
  for (const [label, s] of [["region", regionId], ["org", orgId], ["kind", kind], ["id", id]] as const) {
    if (!SEGMENT.test(s)) throw new Error(`[storage] ${label} segment "${s}" is not key-safe`);
  }
  return `${regionId}/${orgId}/${kind}/${id}` as StorageKey;
};

export const parseStorageKey = (k: StorageKey) => {
  const [regionId, orgId, kind, id] = k.split("/");
  return { regionId: regionId!, orgId: orgId!, kind: kind!, id: id! };
};

export type ObjectStore = {
  put(key: StorageKey, body: Uint8Array, contentType: string): Promise<void>;
  get(key: StorageKey): Promise<Uint8Array>;
  /** Time-bounded, signed by us. A surface never receives a vendor URL. */
  presign(key: StorageKey, ttlSeconds: number): Promise<string>;
};
