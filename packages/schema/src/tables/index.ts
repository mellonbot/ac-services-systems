import * as roots from "./roots.ts";
import * as hierarchy from "./hierarchy.ts";
import * as identity from "./identity.ts";
import * as contracts from "./contracts.ts";
import * as network from "./network.ts";
import * as work from "./work.ts";
import * as billing from "./billing.ts";
import * as intake from "./intake.ts";
import * as sync from "./sync.ts";
import * as platform from "./platform.ts";
import type { Table } from "../tenancy.ts";

/**
 * Creation order matters — every REFERENCES points backwards in this list.
 * The emitter writes 0001 in exactly this order.
 */
export const ALL_TABLES: readonly Table[] = Object.freeze([
  // global reference
  platform.currencies,
  platform.part_manufacturers,
  platform.schema_migrations,
  platform.term_registry,
  // tenancy roots
  roots.organizations,
  roots.regions,
  // hierarchy
  hierarchy.accounts,
  hierarchy.equipment,
  // network (crews before users, users before projects)
  network.subcontractor_firms,
  network.crews,
  network.crew_credentials,
  network.rate_cards,
  // identity
  identity.users,
  identity.devices,
  identity.device_grants,
  identity.sessions,
  // contracts
  contracts.contracts,
  contracts.contract_term_overrides,
  // intake
  intake.leads,
  intake.call_records,
  // work
  work.projects,
  work.jobs,
  work.compliance_clearances,
  work.assignments,
  work.job_state_events,
  work.job_media,
  work.time_entries,
  work.checklist_items,
  work.parts_used,
  work.warranty_cases,
  intake.service_requests,
  // money
  billing.invoices,
  billing.invoice_lines,
  billing.working_capital_positions,
  network.settlements,
  network.settlement_lines,
  // sync
  sync.sync_mutations,
  sync.sync_conflicts,
  // platform
  platform.audit_log,
  platform.outbox,
  platform.subscriptions,
  platform.storage_objects,
  platform.brand_themes,
  platform.sla_timers,
]);

export { roots, hierarchy, identity, contracts, network, work, billing, intake, sync, platform };
