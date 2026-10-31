import { access, constants, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ObjectStore, StorageKey } from "./index.ts";

/**
 * A directory as an object store — a laptop, CI and the integration tests.
 * The key is already key-safe (storageKey refuses anything else), so it is
 * the relative path as it stands.
 */
export const diskStore = (root: string): ObjectStore => ({
  async put(key: StorageKey, body: Uint8Array) {
    const path = join(root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  },
  async get(key: StorageKey) {
    return new Uint8Array(await readFile(join(root, key)));
  },
  async probe() {
    await mkdir(root, { recursive: true });
    await access(root, constants.R_OK | constants.W_OK);
  },
});
