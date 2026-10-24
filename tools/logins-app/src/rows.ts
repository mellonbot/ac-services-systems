import { hashPassword } from "../../../apps/gateway/src/auth.ts";
import { ROLES, CUSTOMER_ROLES, type Role, type CustomerRole } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import { INTERNAL_ORG_ID } from "../../../packages/schema/src/tenancy.ts";
import { MIN_TEST_LOGIN_PASSWORD } from "../../ci/test-logins.ts";
import type { UserRecord } from "./kinds.ts";
import { LoginInputError } from "./errors.ts";

type Base = { readonly email: string; readonly displayName: string; readonly password: string };

export type NewLogin =
  | Base & { readonly kind: "internal"; readonly roles: readonly Role[]; readonly scope: "org" | "region"; readonly regionId: string }
  | Base & { readonly kind: "technician"; readonly crewId: string; readonly crewHomeRegionId: string }
  | Base & {
      readonly kind: "customer"; readonly orgId: string; readonly tier: Tier; readonly nodeId: string; readonly regionId: string;
      /** Who in the household or account pays and who asks (R6). Absent → both: one person on an account is both. */
      readonly roles?: readonly CustomerRole[];
    }
  | Base & { readonly kind: "subcontractor"; readonly firmId: string; readonly regionId: string };

export type UsersRow = {
  readonly org_id: string; readonly region_id: string; readonly namespace: "internal" | "customer" | "subcontractor";
  readonly email: string; readonly display_name: string; readonly roles: readonly string[];
  readonly scope_tier: Tier; readonly scope_id: string; readonly firm_id: string | null; readonly crew_id: string | null;
  readonly password_hash: string;
};

export { LoginInputError };

export const checkPassword = (password: string): void => {
  if (password.length < MIN_TEST_LOGIN_PASSWORD) {
    throw new LoginInputError(`The password must be at least ${MIN_TEST_LOGIN_PASSWORD} characters.`);
  }
};

const EMAIL = /^[^@\s]+@[^@\s]+$/;

type Placement = Pick<UsersRow, "org_id" | "region_id" | "namespace" | "roles" | "scope_tier" | "scope_id" | "firm_id" | "crew_id">;

/**
 * The roles a login of this namespace may hold — checked at runtime, because the window sends them and a type is
 * no guard against what arrives over IPC. Staff hold staff roles, customers customer roles, a firm's login none.
 */
export const checkRoles = (namespace: UsersRow["namespace"], roles: readonly string[]): void => {
  if (namespace === "subcontractor") {
    if (roles.length > 0) throw new LoginInputError("A subcontractor login has no roles — its firm decides what it sees.");
    return;
  }
  if (namespace === "customer") {
    if (roles.length === 0) throw new LoginInputError("A customer login pays the balance, requests service, or both — tick at least one.");
    if (!roles.every((r) => (CUSTOMER_ROLES as readonly string[]).includes(r))) throw new LoginInputError("A customer login can only pay or request service.");
    return;
  }
  if (roles.length === 0) throw new LoginInputError("An internal login needs at least one role.");
  if (!roles.every((r) => (ROLES as readonly string[]).includes(r))) throw new LoginInputError("That is not a staff role.");
};

/** An internal login's scope from org-wide/region: the scope node is never chosen separately from the region. */
export const internalScope = (scope: "org" | "region", regionId: string): Pick<UsersRow, "scope_tier" | "scope_id"> =>
  ({ scope_tier: scope === "org" ? "parent" : "region", scope_id: scope === "org" ? INTERNAL_ORG_ID : regionId });

const placement = (n: NewLogin): Placement => {
  switch (n.kind) {
    case "internal":
      checkRoles("internal", n.roles);
      return {
        org_id: INTERNAL_ORG_ID, region_id: n.regionId, namespace: "internal", roles: n.roles,
        ...internalScope(n.scope, n.regionId), firm_id: null, crew_id: null,
      };
    case "technician":
      return {
        org_id: INTERNAL_ORG_ID, region_id: n.crewHomeRegionId, namespace: "internal", roles: ["technician"],
        scope_tier: "region", scope_id: n.crewHomeRegionId, firm_id: null, crew_id: n.crewId,
      };
    case "customer":
      if (n.roles) checkRoles("customer", n.roles);
      return {
        org_id: n.orgId, region_id: n.regionId, namespace: "customer", roles: n.roles ?? CUSTOMER_ROLES,
        scope_tier: n.tier, scope_id: n.nodeId, firm_id: null, crew_id: null,
      };
    case "subcontractor":
      return {
        org_id: n.firmId, region_id: n.regionId, namespace: "subcontractor", roles: [],
        scope_tier: "parent", scope_id: n.firmId, firm_id: n.firmId, crew_id: null,
      };
  }
};

export const buildUserRow = (n: NewLogin): UsersRow => {
  checkPassword(n.password);
  const email = n.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new LoginInputError("Enter a valid email address.");
  return { ...placement(n), email, display_name: n.displayName, password_hash: hashPassword(n.password) };
};

export type Access = Pick<UserRecord, "roles" | "regionId" | "scopeTier" | "scopeId" | "orgId" | "crewId">;

export const accessChanged = (before: Access, after: Access): boolean =>
  before.regionId !== after.regionId || before.scopeTier !== after.scopeTier || before.scopeId !== after.scopeId ||
  before.orgId !== after.orgId || before.crewId !== after.crewId ||
  [...before.roles].sort().join("\0") !== [...after.roles].sort().join("\0");
