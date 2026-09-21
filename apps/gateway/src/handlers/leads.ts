import type { UnitOfWork } from "../unit-of-work.ts";
import type { Tx } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { PROSPECT_ORG_ID, UNASSIGNED_REGION_ID } from "../../../../packages/schema/src/tenancy.ts";
import {
  LEAD_SOURCES,
  type LeadSource, type SubmitLeadInput, type SubmitLeadOutput,
  type RecordCallInput, type RecordCallOutput, type CoverageOutput, type CoverageMetro,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * ITEM 8 — S1's TWO WRITES AND ONE READ. The only handler in the gateway
 * whose caller is nobody.
 *
 * The division of labour is the one C1 set and 0006 and 0007 kept: this file
 * decides INPUTS — a source from the list, a contact we could actually answer,
 * lengths a form can produce and a paste cannot — and migration 0008 decides
 * where the row may land and what may be read back. Neither half is a
 * substitute for the other, and the reason is specific to this surface: the
 * handler is the half a bad actor is not obliged to go through.
 *
 * TENANCY IS NOT AN INPUT. A lead lands in PROSPECT/UNASSIGNED because that is
 * where a pre-account row lives (schema: intake.ts — "the awkward case, with a
 * home"), and both ids are constants here, in 0008's INSERT policy, and in the
 * claims validator. Three places say the same thing and none of them reads a
 * request body.
 *
 * WHAT IS NOT HERE, and is the most important sentence in the file: there is
 * no read. No `leads.list`, no `leads.get`, no "check the status of your
 * enquiry". The catalogue serves S1 one query and it is the coverage map. A
 * surface with no login that can read what it wrote is an enumeration
 * endpoint with a friendly name, and the shortest distance between this file
 * and that one is a single well-meaning row in the operation catalogue.
 */

/** Long enough for the longest real name; short enough that a payload is refused rather than stored. */
const NAME_MAX = 120;
/** RFC 5321's limit on a path. Not a validation of the address — that is what sending to it is for. */
const EMAIL_MAX = 254;
const PHONE_MAX = 40;
const METRO_MAX = 80;
/** A paragraph about a broken rooftop unit. A pasted maintenance log is refused. */
export const NOTE_MAX = 2000;

const text = (v: unknown, field: string, max: number, required: boolean): string => {
  if (v === undefined || v === null) {
    if (required) throw new BadInput(`${field} is required`);
    return "";
  }
  if (typeof v !== "string") throw new BadInput(`${field} must be a string`);
  const t = v.trim();
  if (required && t.length === 0) throw new InputRefused(`${field} is empty`, `empty_${field.toLowerCase()}`);
  if (t.length > max) {
    throw new InputRefused(`${field} is ${t.length} characters; ${max} is the most a lead carries`, `${field.toLowerCase()}_too_long`);
  }
  return t;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stranger asks us to call them.
 *
 * The one judgement this handler makes that is not a length: a lead with
 * neither an email nor a phone number is refused. It is not a validation
 * nicety — a row we cannot answer occupies the intake queue and the funnel
 * count, and reports a lead we do not have. 0008's trigger says the same
 * thing at the table, because the handler is not the only way in.
 */
export const submitLead = async (
  uow: UnitOfWork, input: SubmitLeadInput, newId: () => string,
): Promise<SubmitLeadOutput> => {
  const submissionId = input?.submissionId;
  if (typeof submissionId !== "string" || !UUID.test(submissionId)) throw new BadInput("submissionId must be a uuid");
  const source = input?.source as LeadSource;
  if (!LEAD_SOURCES.includes(source)) {
    throw new BadInput(`source must be one of ${LEAD_SOURCES.join(", ")}`);
  }
  if (!input.contact || typeof input.contact !== "object") throw new BadInput("contact is required");

  const name = text(input.contact.name, "name", NAME_MAX, true);
  const email = text(input.contact.email, "email", EMAIL_MAX, false);
  const phone = text(input.contact.phone, "phone", PHONE_MAX, false);
  const note = text(input.contact.note, "note", NOTE_MAX, false);
  const requestedMetro = text(input.requestedMetro, "requestedMetro", METRO_MAX, false);

  if (email === "" && phone === "") {
    throw new InputRefused(
      "a lead we cannot answer is not a lead: leave an email address or a phone number",
      "no_way_to_answer",
    );
  }

  // The stranger's own words, and only the fields we asked for. An unknown key
  // in the body does not become a column in the jsonb: a contact blob is a
  // thing a human reads later, and what is in it should be what the form has.
  const contact: Record<string, string> = { name };
  if (email) contact.email = email;
  if (phone) contact.phone = phone;
  if (note) contact.note = note;

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "lead", entityId: id, action: "lead.submit", topic: "lead.captured",
      before: null,
      // The audit row carries the lead as submitted. It is the record of what a
      // stranger actually typed, which is the only version of it that exists
      // before someone works it.
      after: { id, submissionId, source, contact, requestedMetro: requestedMetro || null },
      orgId: PROSPECT_ORG_ID, regionId: UNASSIGNED_REGION_ID,
      // The envelope carries no contact details. An event envelope crosses
      // NOTIFY to every OFC subscriber; the name and phone number of a member
      // of the public are not something to broadcast on a bus, and a
      // subscriber that needs them fetches the row as us.
      payload: { source, requestedMetro: requestedMetro || null },
    },
    async (tx: Tx) => {
      await tx.query(
        `INSERT INTO leads (id, org_id, region_id, source, contact, requested_metro, submission_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [id, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, source, JSON.stringify(contact), requestedMetro || null, submissionId],
      );
    },
  );
  return { id, eventId };
};

/**
 * A visitor used the call button.
 *
 * `leadId` is optional and stays optional: someone who calls the number on the
 * page without filling anything in is the commonest case on a marketing site,
 * and a call record with no lead behind it is a real fact, not a broken row.
 * `direction` is an input rather than a constant because the same table takes
 * our outbound calls back; 0008 is what holds an anonymous principal to
 * `inbound`, since a surface saying "we called them" is the surface asserting
 * something about us.
 */
export const recordCall = async (
  uow: UnitOfWork, input: RecordCallInput, newId: () => string, now: () => Date,
): Promise<RecordCallOutput> => {
  const direction = input?.direction;
  if (direction !== "inbound" && direction !== "outbound") throw new BadInput("direction must be inbound or outbound");
  const leadId = input.leadId === undefined || input.leadId === null ? null : input.leadId;
  if (leadId !== null && (typeof leadId !== "string" || !UUID.test(leadId))) throw new BadInput("leadId must be a uuid");

  // The clock is the gateway's. A browser's `occurredAt` is a claim about when
  // something happened made by the machine with the most reason to be wrong
  // about it, and nothing downstream needs it to be the visitor's clock.
  const occurredAt = now();
  if (input.occurredAt !== undefined && typeof input.occurredAt !== "string") throw new BadInput("occurredAt must be a string");

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "call_record", entityId: id, action: "call_record.log", topic: "call_record.logged",
      before: null, after: { id, leadId, direction, occurredAt: occurredAt.toISOString() },
      orgId: PROSPECT_ORG_ID, regionId: UNASSIGNED_REGION_ID,
      payload: { leadId, direction },
    },
    async (tx: Tx) => {
      await tx.query(
        `INSERT INTO call_records (id, org_id, region_id, lead_id, direction, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, leadId, direction, occurredAt.toISOString()],
      );
    },
  );
  return { id, eventId };
};

/**
 * THE COVERAGE MAP, read from the hierarchy (05 §S1).
 *
 * One call to `ac_public_coverage()`, which is where the claim is defined.
 * There is no WHERE clause here and no shaping: if this function ever grows
 * one, the claim has two definitions and the one on this side is the one
 * nobody reviews.
 */
export const listCoverage = async (tx: Pick<Tx, "query">): Promise<CoverageOutput> => {
  const rows = await tx.query<{ code: string; name: string }>(`SELECT code, name FROM ac_public_coverage()`);
  const metros: CoverageMetro[] = rows.map((r) => ({ code: r.code, name: r.name }));
  return { metros };
};
