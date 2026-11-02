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

/**
 * What the gateway needs of a store: write an object, read it back. There is
 * no presigned URL — a surface never receives a vendor URL; the gateway reads
 * the object and hands the bytes over under the caller's own row security.
 */
export type ObjectStore = {
  put(key: StorageKey, body: Uint8Array, contentType: string): Promise<void>;
  get(key: StorageKey): Promise<Uint8Array>;
  /**
   * Prove the store answers with these credentials, writing nothing. Rejects
   * with the reason; /readyz turns that into a 503.
   */
  probe(): Promise<void>;
};

export { s3Store, signV4, type S3Config, type S3Fetch } from "./s3.ts";
export { diskStore } from "./disk.ts";
export { storeFromEnv } from "./env.ts";
