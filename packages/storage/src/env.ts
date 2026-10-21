import { diskStore } from "./disk.ts";
import { s3Store, type S3Fetch } from "./s3.ts";
import type { ObjectStore } from "./index.ts";

/**
 * Which store this process writes to, from its environment:
 *
 *   AC_STORAGE_ENDPOINT, AC_STORAGE_BUCKET,       an S3-compatible bucket (R2);
 *   AC_STORAGE_KEY_ID, AC_STORAGE_SECRET          AC_STORAGE_REGION defaults to "auto"
 *   AC_STORAGE_DIR                                 a directory (laptop, CI)
 *
 * Neither → null, and an upload is refused as `storage_not_configured`: an
 * answer, not an error, the way unconfigured imagery is. Half a bucket
 * configuration is a deploy mistake and fails the process at start.
 */
export const storeFromEnv = (env: Readonly<Record<string, string | undefined>>, fetchImpl: S3Fetch): ObjectStore | null => {
  const s3 = ["AC_STORAGE_ENDPOINT", "AC_STORAGE_BUCKET", "AC_STORAGE_KEY_ID", "AC_STORAGE_SECRET"] as const;
  const set = s3.filter((k) => env[k]?.trim());
  if (set.length === s3.length) {
    return s3Store({
      endpoint: env.AC_STORAGE_ENDPOINT!.trim(), bucket: env.AC_STORAGE_BUCKET!.trim(), region: env.AC_STORAGE_REGION?.trim() || "auto",
      accessKeyId: env.AC_STORAGE_KEY_ID!.trim(), secretAccessKey: env.AC_STORAGE_SECRET!.trim(),
    }, fetchImpl);
  }
  if (set.length > 0) throw new Error(`[storage] bucket half-configured: ${s3.filter((k) => !set.includes(k)).join(", ")} not set`);
  const dir = env.AC_STORAGE_DIR?.trim();
  return dir ? diskStore(dir) : null;
};
