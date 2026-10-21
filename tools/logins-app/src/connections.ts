import fs from "node:fs";
import path from "node:path";

export type DbName = "production" | "local";
export type Connections = { readonly production?: string; readonly local: string };

export const LOCAL_DEFAULT = "postgres://postgres:postgres@localhost:5433/ac_dev";

const fileIn = (dir: string) => path.join(dir, "connections.json");

export const loadConnections = (dir: string): Connections => {
  const file = fileIn(dir);
  if (!fs.existsSync(file)) return { local: LOCAL_DEFAULT };
  const stored = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Connections>;
  return { ...stored, local: stored.local ?? LOCAL_DEFAULT };
};

export const saveConnections = (dir: string, c: Connections): void => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = fileIn(dir);
  fs.writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};
