import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import os from "node:os";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { openDb } from "./db.ts";
import type { LoginsDb } from "./db.ts";
import { loadConnections, saveConnections, LOCAL_DEFAULT } from "./connections.ts";
import type { Cipher, Connections, DbName } from "./connections.ts";
import type { Api } from "./preload.ts";

const CONFIG_DIR = path.join(os.homedir(), ".config", "ac-logins");
const WRONG_DB = "The window is showing a different database — reload.";

let conns: Connections = { local: LOCAL_DEFAULT };
let connectionsError: string | null = null;
// The OS keychain (safeStorage) seals the production string on disk. Asked after `ready`: on Linux it is not known before.
let cipher: Cipher | undefined;

const loadConfig = (): void => {
  cipher = safeStorage.isEncryptionAvailable() ? safeStorage : undefined;
  if (!cipher) console.warn("ac-logins: no OS keychain — the production connection string is kept in connections.json in the clear (mode 0600).");
  try {
    const loaded = loadConnections(CONFIG_DIR, cipher);
    conns = { local: loaded.local, ...(loaded.production === undefined ? {} : { production: loaded.production }) };
    // A string written before the keychain was used is sealed now.
    if (loaded.plaintext && cipher) saveConnections(CONFIG_DIR, conns, cipher);
  } catch {
    // Never forward the parse error: V8 quotes the source around the bad token, which can be part of a connection string.
    conns = { local: LOCAL_DEFAULT };
    connectionsError = "connections.json could not be read — enter the connection strings again.";
  }
};

const openFor = async (name: DbName): Promise<LoginsDb> => {
  const url = conns[name];
  if (!url) throw new Error("Production is not configured — set its connection string with ⚙.");
  try {
    return await openDb(url);
  } catch (e) {
    throw new Error(`Could not connect to ${name}: ${(e as Error).message}`);
  }
};

// `current` holds the open database, or the rejection that says why it is not open.
// Always Local at start: production is the live site's database, and is opened only when someone picks it.
let selected: DbName = "local";
let current: Promise<LoginsDb> = Promise.reject(new Error("Not connected yet."));
current.catch(() => {});

const use = (name: DbName): Promise<LoginsDb> => {
  if (name !== selected) return Promise.reject(new Error(WRONG_DB));
  return current;
};

const select = async (name: DbName): Promise<void> => {
  const old = current;
  selected = name;
  current = old.then((d) => d.close(), () => {}).catch(() => {}).then(() => openFor(name));
  current.catch(() => {});
  await current;
};

type Handlers = { [K in keyof Api]: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> };

const handlers: Handlers = {
  connections: async () => ({ production: Boolean(conns.production), local: Boolean(conns.local), localIsDefault: conns.local === LOCAL_DEFAULT, selected, error: connectionsError }),
  setConnection: async (name, url) => {
    // Proven before it is kept: a mistyped string must not overwrite the one that works.
    const probe = await openDb(url.trim());
    await probe.close();
    conns = { ...conns, [name]: url.trim() };
    saveConnections(CONFIG_DIR, conns, cipher);
    connectionsError = null;
  },
  select,
  listUsers: async (db, includeInactive) => (await use(db)).listUsers({ includeInactive }),
  listRegions: async (db) => (await use(db)).listRegions(),
  listFirms: async (db) => (await use(db)).listFirms(),
  listCompanies: async (db, includeInactive) => (await use(db)).listCompanies({ includeInactive }),
  addCompany: async (db, n) => (await use(db)).addCompany(n),
  removeCompany: async (db, id) => (await use(db)).removeCompany(id),
  reactivateCompany: async (db, id) => (await use(db)).reactivateCompany(id),
  listCustomerOrgs: async (db) => (await use(db)).listCustomerOrgs(),
  listAccountTree: async (db, orgId) => (await use(db)).listAccountTree(orgId),
  addLogin: async (db, n) => (await use(db)).addLogin(n),
  resetPassword: async (db, userId, password) => (await use(db)).resetPassword(userId, password),
  editLogin: async (db, userId, e) => (await use(db)).editLogin(userId, e),
  deactivate: async (db, userId) => (await use(db)).deactivate(userId),
  reactivate: async (db, userId) => (await use(db)).reactivate(userId),
  listDevices: async (db) => (await use(db)).listDevices(),
  grantShift: async (db, n) => (await use(db)).grantShift(n),
};

for (const [name, f] of Object.entries(handlers) as [string, (...a: unknown[]) => Promise<unknown>][]) {
  ipcMain.handle(name, async (_event, ...args: unknown[]) => {
    try {
      return await f(...args);
    } catch (e) {
      throw new Error((e instanceof Error ? e.message : String(e)) || "Lost the connection to the database.");
    }
  });
}

// AC_LOGINS_SMOKE=<file.png>: wait for the first render, print the sidebar, save a screenshot, quit.
const smoke = async (win: BrowserWindow, file: string): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript(`document.body.dataset.ready === "1"`)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(await win.webContents.executeJavaScript(
    `[...document.querySelectorAll("#kinds li, #banner:not([hidden])")].map((e) => e.textContent.replace(/\\s+/g, " ").trim()).join("\\n")`));
  await win.webContents.executeJavaScript(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  writeFileSync(file, (await win.webContents.capturePage()).toPNG());
  app.quit();
};

app.whenReady().then(() => {
  loadConfig();
  current = openFor(selected);
  current.catch(() => {});
  const win = new BrowserWindow({
    width: 1200, height: 800, title: "AC Logins",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  const shot = process.env.AC_LOGINS_SMOKE;
  if (shot) win.webContents.once("did-finish-load", () => { void smoke(win, shot); });
});

app.on("window-all-closed", () => { app.quit(); });
