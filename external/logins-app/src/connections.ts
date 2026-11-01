import fs from "node:fs";
import path from "node:path";

export type DbName = "production" | "local";
export type Connections = { readonly production?: string; readonly local: string };

/** Electron's safeStorage, or anything shaped like it (the OS keychain behind it is what keeps the string). */
export type Cipher = { encryptString(s: string): Buffer; decryptString(b: Buffer): string };

/** What is on disk: the production string sealed by the cipher, or — only when there is none — in the clear. */
type Stored = { readonly local?: string; readonly production?: string; readonly productionSealed?: string };

export const LOCAL_DEFAULT = "postgres://postgres:postgres@localhost:5433/ac_dev";

const fileIn = (dir: string) => path.join(dir, "connections.json");

/** `plaintext`: the file holds the production string unsealed — re-save it once a cipher is available. */
export const loadConnections = (dir: string, cipher?: Cipher): Connections & { readonly plaintext?: boolean } => {
  const file = fileIn(dir);
  if (!fs.existsSync(file)) return { local: LOCAL_DEFAULT };
  const stored = JSON.parse(fs.readFileSync(file, "utf8")) as Stored;
  const local = stored.local ?? LOCAL_DEFAULT;
  if (stored.productionSealed !== undefined) {
    // Sealed by this machine's keychain: without it the string is unreadable, and production is simply not configured.
    if (!cipher) return { local };
    return { local, production: cipher.decryptString(Buffer.from(stored.productionSealed, "base64")) };
  }
  return stored.production === undefined ? { local } : { local, production: stored.production, plaintext: true };
};

export const saveConnections = (dir: string, c: Connections, cipher?: Cipher): void => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = fileIn(dir);
  const stored: Stored = c.production === undefined
    ? { local: c.local }
    : cipher
      ? { local: c.local, productionSealed: cipher.encryptString(c.production).toString("base64") }
      : { local: c.local, production: c.production };
  fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};
