import { oneTime } from "./paths/one_time/index.ts";
import { residentialMembership } from "./paths/residential_membership/index.ts";
import { enterpriseSla } from "./paths/enterprise_sla/index.ts";
import { project } from "./paths/project/index.ts";
import type { BillingPath } from "./path.ts";

/**
 * The ONLY place the four paths appear together. This file may import them;
 * they may never import each other. tools/eslint-plugin-ac/rules/no-cross-
 * billing-import.ts enforces that, including the `../enterprise_sla/` spelling
 * an IDE refactor produces on its own.
 */
export const BILLING_PATHS: Readonly<Record<BillingPath["key"], BillingPath>> = Object.freeze({
  one_time: oneTime,
  residential_membership: residentialMembership,
  enterprise_sla: enterpriseSla,
  project,
});

export * from "./path.ts";
