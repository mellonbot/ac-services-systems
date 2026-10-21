import { contextBridge, ipcRenderer } from "electron";
import type { DbName } from "./connections.ts";
import type { UserRecord } from "./kinds.ts";
import type { NewLogin } from "./rows.ts";
import type { Region, Crew, Firm, Company, CustomerOrg, AccountNode, LoginEdit } from "./db.ts";
import type { NewCompany } from "./companies.ts";

export type Api = {
  /** Which connections are configured — never the strings. `localIsDefault`: Local is LOCAL_DEFAULT. `selected`: the database the main process opened. `error`: connections.json could not be read. */
  connections(): Promise<{ production: boolean; local: boolean; localIsDefault: boolean; selected: DbName; error: string | null }>;
  setConnection(db: DbName, url: string): Promise<void>;
  select(db: DbName): Promise<void>;
  listUsers(db: DbName, includeInactive: boolean): Promise<readonly UserRecord[]>;
  listRegions(db: DbName): Promise<readonly Region[]>;
  listCrews(db: DbName): Promise<readonly Crew[]>;
  listFirms(db: DbName): Promise<readonly Firm[]>;
  listCompanies(db: DbName, includeInactive: boolean): Promise<readonly Company[]>;
  addCompany(db: DbName, n: NewCompany): Promise<{ id: string; firmId: string | null }>;
  removeCompany(db: DbName, id: string): Promise<void>;
  reactivateCompany(db: DbName, id: string): Promise<void>;
  listCustomerOrgs(db: DbName): Promise<readonly CustomerOrg[]>;
  listAccountTree(db: DbName, orgId: string): Promise<readonly AccountNode[]>;
  addLogin(db: DbName, n: NewLogin): Promise<{ id: string }>;
  resetPassword(db: DbName, userId: string, password: string): Promise<{ revokedSessions: number }>;
  editLogin(db: DbName, userId: string, e: LoginEdit): Promise<{ revokedSessions: number }>;
  deactivate(db: DbName, userId: string): Promise<{ revokedSessions: number }>;
  reactivate(db: DbName, userId: string): Promise<void>;
};

const METHODS = [
  "connections", "setConnection", "select", "listUsers", "listRegions", "listCrews", "listFirms",
  "listCompanies", "addCompany", "removeCompany", "reactivateCompany", "listCustomerOrgs",
  "listAccountTree", "addLogin", "resetPassword", "editLogin", "deactivate", "reactivate",
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
