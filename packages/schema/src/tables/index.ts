import * as roots from "./roots.ts";
import * as hierarchy from "./hierarchy.ts";
import * as contracts from "./contracts.ts";
import * as network from "./network.ts";
import * as dispatch from "./dispatch.ts";
import * as billing from "./billing.ts";
import * as intake from "./intake.ts";
import * as platform from "./platform.ts";
import type { Table } from "../tenancy.ts";

export const ALL_TABLES: readonly Table[] = Object.freeze([
  ...Object.values(platform).filter((t) => t.kind === "global_reference"),
  ...Object.values(roots),
  hierarchy.accounts,
  network.subcontractor_firms,
  network.crews,
  network.crew_credentials,
  network.rate_cards,
  contracts.contracts,
  contracts.contract_term_overrides,
  intake.leads,
  intake.call_records,
  dispatch.jobs,
  dispatch.compliance_clearances,
  dispatch.assignments,
  dispatch.job_state_events,
  intake.service_requests,
  billing.invoices,
  billing.invoice_lines,
  billing.working_capital_positions,
  ...Object.values(platform).filter((t) => t.kind === "operational"),
]);

export { roots, hierarchy, contracts, network, dispatch, billing, intake, platform };
