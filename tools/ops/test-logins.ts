/**
 * THE TEST LOGINS — three internal people, one per level, for checking by hand
 * (and in test/integration/test-logins.test.ts) that a login opens exactly the
 * surfaces its roles admit and reads at exactly the scope its tier binds.
 *
 *   superadmin-test       roles [principal]       org-wide   → S2, S3, S4
 *   dispatcher-test       roles [dispatcher]      one region → S3
 *   service_manager-test  roles [office_manager]  org-wide   → S2
 *
 * "Superadmin" is the top internal role, not a skeleton key: namespaces are
 * walls below the role layer (packages/contracts/src/scope.ts), so no internal
 * login opens S1 (anonymous), S5 (a device shift grant), S6 (customer), S7
 * (vendor) or S8 (subcontractor), whatever its roles.
 *
 * So the customer portal has its own login, in the customer namespace:
 *
 *   customer-test         roles [payer, requester] one customer org, parent tier → S6
 *
 * It is the customer's executive: it sees that org's whole tree and nothing of
 * any other customer's. A customer login belongs to a real customer org, which
 * the operator names at seed time, so it is seeded only when one is named.
 *
 * Pure data — no driver, no clock — so the zero-install guard can test it.
 * `seed-test-logins.ts` writes these rows; `surfaces` is the hand-written
 * expectation the registry is checked against, never derived from it.
 */
import type { Role } from "../../packages/contracts/src/scope.ts";
import type { SurfaceId } from "../../packages/contracts/src/surfaces.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";

/** RFC 2606 reserved: these addresses cannot belong to anyone, and the sign-in forms are `type="email"`. */
export const TEST_LOGIN_DOMAIN = "ac.test";

export type TestLogin = {
  readonly login: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly Role[];
  /** `org`: the internal org, every region. `region`: the one region the login is seeded into. `customer`: a customer org's whole tree. */
  readonly scope: "org" | "region" | "customer";
  /** The enabled surfaces this login must be admitted to — and refused everywhere else. */
  readonly surfaces: readonly SurfaceId[];
};

const login = (name: string, displayName: string, roles: readonly Role[], scope: TestLogin["scope"], surfaces: readonly SurfaceId[]): TestLogin =>
  Object.freeze({ login: name, email: `${name}@${TEST_LOGIN_DOMAIN}`, displayName, roles: Object.freeze([...roles]), scope, surfaces: Object.freeze([...surfaces]) });

export const TEST_LOGINS: readonly TestLogin[] = Object.freeze([
  login("superadmin-test", "Superadmin (test)", ["principal"], "org", ["S2", "S3", "S4"]),
  login("dispatcher-test", "Dispatcher (test)", ["dispatcher"], "region", ["S3"]),
  login("service_manager-test", "Service manager (test)", ["office_manager"], "org", ["S2"]),
]);

export const CUSTOMER_TEST_LOGIN: TestLogin = login("customer-test", "Customer (test)", ["payer", "requester"], "customer", ["S6"]);

/**
 * The `users` row for a test login seeded into `regionId`. Org-wide logins scope to the internal org; a region login to
 * the region; the customer login to `customerOrgId` at parent tier.
 */
export const testLoginRow = (t: TestLogin, regionId: string, customerOrgId?: string) => {
  if (t.scope === "customer") {
    if (!customerOrgId) throw new Error(`${t.login} needs the customer org it belongs to`);
    return {
      org_id: customerOrgId, region_id: regionId, namespace: "customer" as const, email: t.email, display_name: t.displayName,
      roles: t.roles, scope_tier: "parent" as const, scope_id: customerOrgId,
    };
  }
  return {
    org_id: INTERNAL_ORG_ID,
    region_id: regionId,
    namespace: "internal" as const,
    email: t.email,
    display_name: t.displayName,
    roles: t.roles,
    scope_tier: t.scope === "org" ? ("parent" as const) : ("region" as const),
    scope_id: t.scope === "org" ? INTERNAL_ORG_ID : regionId,
  };
};

/** A test login is still a real credential on whatever database it is seeded into. */
export const MIN_TEST_LOGIN_PASSWORD = 12;
