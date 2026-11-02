import { contextBridge, ipcRenderer } from "electron";
import type { DbName } from "./connections.ts";
import type { UserRecord } from "./kinds.ts";
import type { NewLogin } from "./rows.ts";
import type { Region, Firm, Crew, CustomerOrg, AccountNode, LoginEdit, Device, NewShift } from "./db.ts";
import type { NewCrew } from "./crews.ts";

export type Api = {
  /** Which connections are configured — never the strings. `localIsDefault`: Local is LOCAL_DEFAULT. `selected`: the database the main process opened. `error`: connections.json could not be read. */
  connections(): Promise<{ production: boolean; local: boolean; localIsDefault: boolean; selected: DbName; error: string | null }>;
  setConnection(db: DbName, url: string): Promise<void>;
  select(db: DbName): Promise<void>;
  listUsers(db: DbName, includeInactive: boolean): Promise<readonly UserRecord[]>;
  listRegions(db: DbName): Promise<readonly Region[]>;
  listFirms(db: DbName): Promise<readonly Firm[]>;
  listCrews(db: DbName, includeInactive: boolean): Promise<readonly Crew[]>;
  addCrew(db: DbName, n: NewCrew): Promise<{ id: string; firmId: string | null }>;
  removeCrew(db: DbName, id: string): Promise<void>;
  reactivateCrew(db: DbName, id: string): Promise<void>;
  listCustomerOrgs(db: DbName): Promise<readonly CustomerOrg[]>;
  listAccountTree(db: DbName, orgId: string): Promise<readonly AccountNode[]>;
  addLogin(db: DbName, n: NewLogin): Promise<{ id: string }>;
  resetPassword(db: DbName, userId: string, password: string): Promise<{ revokedSessions: number }>;
  editLogin(db: DbName, userId: string, e: LoginEdit): Promise<{ revokedSessions: number }>;
  deactivate(db: DbName, userId: string): Promise<{ revokedSessions: number }>;
  reactivate(db: DbName, userId: string): Promise<void>;
  listDevices(db: DbName): Promise<readonly Device[]>;
  grantShift(db: DbName, n: NewShift): Promise<{ grantId: string; deviceId: string }>;
};

const METHODS = [
  "connections", "setConnection", "select", "listUsers", "listRegions", "listFirms",
  "listCrews", "addCrew", "removeCrew", "reactivateCrew", "listCustomerOrgs",
  "listAccountTree", "addLogin", "resetPassword", "editLogin", "deactivate", "reactivate",
  "listDevices", "grantShift",
] as const satisfies readonly (keyof Api)[];

// Electron wraps a rejected handler as "Error invoking remote method 'x': Error: <message>"; the window shows only <message>.
const REMOTE_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

const call = (method: string) => async (...args: unknown[]): Promise<unknown> => {
  try {
    return await ipcRenderer.invoke(method, ...args);
  } catch (e) {
    throw new Error((e as Error).message.replace(REMOTE_PREFIX, ""));
  }
};

contextBridge.exposeInMainWorld("logins", Object.fromEntries(METHODS.map((m) => [m, call(m)])));
