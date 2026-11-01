import type { UnitOfWork } from "../db/unit-of-work.ts";
import { InputRefused, BadInput } from "../http/refusals.ts";
import { createOrganization, createAccount } from "./hierarchy.ts";
import { setContact } from "./site-record.ts";
import { createContract, transitionContract } from "./contracts.ts";
import { authorTermOverride } from "./terms.ts";
import { localDate } from "./jobs.ts";
import { iso } from "../db/sql.ts";
import type { HierarchyContext } from "../http/context.ts";
import { RESIDENTIAL_STANDARD_TERMS } from "../../../../packages/contracts/src/terms.ts";
import type {
  CreateResidentialInput, CreateResidentialOutput, ListLeadsInput, ListLeadsOutput, ConvertLeadInput, ConvertLeadOutput,
  LeadContact, AddressWire,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * RESIDENTIAL CUSTOMERS (scope 2026-10-21, the residential / commercial split).
 *
 * A home is a customer whose tree has one branch: the organization (segment
 * residential — fixed for good, 0019), the region node we serve it from, the
 * household as its location, and the home as its site, both at the address.
 * Nothing about the tier ladder changes, so row security, terms, the SLA
 * derivation, Intake and Open job work on a home exactly as they do on a
 * building. What changes is that the office makes all four in one step, by
 * calling the same handlers the four-step path calls — the same checks, the
 * same events, in one unit of work.
 *
 * And the agreement: a home is put on the standard home agreement
 * (RESIDENTIAL_STANDARD_TERMS) in the same unit of work — created, its terms
 * stated, activated through the same handlers S2 uses. The register now has
 * commercial defaults, so homes explicitly author their own values.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const requireText = (v: unknown, field: string): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new BadInput(`${field} is required`);
  return v.trim();
};
const requireAddress = (a: AddressWire | undefined): AddressWire & { line1: string } => {
  if (!a || typeof a !== "object") throw new BadInput("address is required — a home is somewhere");
  return { ...a, line1: requireText(a.line1, "address.line1") };
};

/**
 * Puts a home's organization on the standard home agreement from today, where
 * the home is. Exported for the one-off backfill of homes made before this
 * existed (tools/ops/backfill-home-agreements.ts) — the same path, not a copy.
 */
export const startStandardHomeAgreement = async (
  uow: UnitOfWork, ctx: HierarchyContext, home: { readonly orgId: string; readonly regionId: string }, now: Date, newId: () => string,
): Promise<string> => {
  const tz = (await uow.tx.query<{ timezone: string | null }>(`SELECT timezone FROM regions WHERE id = $1`, [home.regionId]))[0]?.timezone ?? "UTC";
  const today = localDate(now, tz);
  const { id: contractId } = await createContract(uow, {
    orgId: home.orgId, regionId: home.regionId, scopeTier: "parent", scopeId: home.orgId, kind: "msa", billingPath: "one_time",
    signedAt: today, effectiveFrom: today, diagnosticDataRightsReserved: RESIDENTIAL_STANDARD_TERMS.diagnostic_data_rights_reserved === true,
  }, newId);
  for (const termKey of Object.keys(RESIDENTIAL_STANDARD_TERMS)) {
    await authorTermOverride(uow, ctx, {
      contractId, scopeTier: "parent", scopeId: home.orgId, termKey, termValue: RESIDENTIAL_STANDARD_TERMS[termKey],
      effectiveFrom: today, effectiveTo: null, orgId: home.orgId, regionId: home.regionId,
    });
  }
  await transitionContract(uow, { contractId, to: "active" });
  return contractId;
};

export const createResidential = async (uow: UnitOfWork, ctx: HierarchyContext, input: CreateResidentialInput, newId: () => string, now: Date): Promise<CreateResidentialOutput> => {
  const name = requireText(input.name, "name");
  const address = requireAddress(input.address);
  const org = await createOrganization(uow, {
    name, kind: "customer", segment: "residential",
    ...(input.externalRef ? { externalRef: input.externalRef } : {}),
    firstRegionNode: { regionId: requireUuid(input.regionId, "regionId"), name },
  }, newId);
  const location = await createAccount(uow, { orgId: org.orgId, tier: "location", parentId: org.regionNodeId, name: address.line1, address }, newId);
  const site = await createAccount(uow, { orgId: org.orgId, tier: "site", parentId: location.id, name: "Home", address }, newId);
  // The homeowner, where a crew calling ahead will find them. A contact needs a
  // way to reach them; a name alone is recorded on the organization, not here.
  const c = input.contact;
  if (c && (c.phone || c.email)) {
    await setContact(uow, {
      accountId: location.id, role: "other", name: requireText(c.name, "contact.name"), isPrimary: true, note: "Homeowner",
      ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}),
    }, newId);
  }
  const contractId = await startStandardHomeAgreement(uow, ctx, { orgId: org.orgId, regionId: input.regionId }, now, newId);
  return { orgId: org.orgId, regionNodeId: org.regionNodeId, locationId: location.id, siteId: site.id, contractId, eventId: org.eventId, caveats: location.caveats };
};

type LeadRow = { id: string; source: string; contact: LeadContact; requested_metro: string | null; created_at: string; converted_account_id: string | null };

/** Internal principals only, by 0008's policy; the waiting ones unless asked for all. */
export const listLeads = async (uow: UnitOfWork, input: ListLeadsInput): Promise<ListLeadsOutput> => {
  const include = input.include ?? "waiting";
  if (include !== "waiting" && include !== "all") throw new BadInput("include must be waiting or all");
  const rows = await uow.tx.query<LeadRow>(
    `SELECT id, source, contact, requested_metro, ${iso("created_at")} AS created_at, converted_account_id
       FROM leads WHERE ($1 = 'all' OR converted_account_id IS NULL) ORDER BY created_at DESC LIMIT 500`,
    [include],
  );
  return { leads: rows.map((r) => ({ id: r.id, source: r.source, contact: r.contact, requestedMetro: r.requested_metro, createdAt: r.created_at, convertedAccountId: r.converted_account_id })) };
};

/**
 * Arc 1's second half: the lead S1 captured becomes a home we serve. Locked
 * first, so two people converting the same lead make one customer, and the
 * second is told which home it already became.
 */
export const convertLead = async (uow: UnitOfWork, ctx: HierarchyContext, input: ConvertLeadInput, newId: () => string, now: Date): Promise<ConvertLeadOutput> => {
  const leadId = requireUuid(input.leadId, "leadId");
  const lead = (await uow.tx.query<{ contact: LeadContact; converted_account_id: string | null; org_id: string; region_id: string }>(
    `SELECT contact, converted_account_id, org_id, region_id FROM leads WHERE id = $1 FOR UPDATE`, [leadId],
  ))[0];
  if (!lead) throw new InputRefused(`no lead ${leadId} visible in this scope`, "unknown_lead");
  if (lead.converted_account_id) throw new InputRefused(`this lead was already converted — it is home ${lead.converted_account_id}`, "already_converted");

  const home = await createResidential(uow, ctx, {
    name: input.name?.trim() || lead.contact.name, regionId: input.regionId, address: input.address,
    contact: { name: lead.contact.name, ...(lead.contact.phone ? { phone: lead.contact.phone } : {}), ...(lead.contact.email ? { email: lead.contact.email } : {}) },
  }, newId, now);
  await uow.apply(
    {
      entity: "lead", entityId: leadId, action: "lead.convert", topic: "lead.converted",
      before: { convertedAccountId: null }, after: { convertedAccountId: home.siteId, orgId: home.orgId },
      orgId: lead.org_id, regionId: lead.region_id,
      payload: { leadId, orgId: home.orgId, siteId: home.siteId },
    },
    async (tx) => { await tx.query(`UPDATE leads SET converted_account_id = $1 WHERE id = $2`, [home.siteId, leadId]); },
  );
  return { ...home, leadId };
};
