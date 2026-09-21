import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type {
  SettlementWire, SettlementState, ListSettlementsInput, ListSettlementsOutput,
  ListSettlementLinesInput, ListSettlementLinesOutput,
  AcknowledgeSettlementInput, AcknowledgeSettlementOutput, DisputeSettlementInput, DisputeSettlementOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * ITEM 7 — THE STATEMENT, AS THE FIRM READS IT AND AS THE FIRM ANSWERS IT.
 *
 * A settlement is a statement we issue to a firm for a period's work: lines
 * citing the job, the rate applied and the quantity, and a total. Issuing one
 * is WS-E's (the money workstream, D13) and has no operation yet; the rows
 * this file reads are written by that work, or by a test. What S8 gets is
 * D12's "settlement visibility" — the statement and its lines — and the two
 * writes that make visibility worth something: the firm says the statement
 * is right (acknowledge) or says it is wrong and why (dispute).
 *
 *   - VISIBILITY IS THE TABLE'S. `listSettlements` has no firm filter for a
 *     firm principal: 0007's `settlements_read` returns the firm's own rows,
 *     once issued, and `settlement_lines_read` follows the statement. An
 *     S2 principal reads every firm's and may name one.
 *   - THE POSITION IS THE FIRM'S; THE ROW IS OURS. The handler decides the
 *     inputs (a statement it can see; a reason that says something) and names
 *     the two refusals a click can produce — `not_issued`, `already_...` —
 *     so they arrive with a name. Whether ANY path can change anything else
 *     on the row, or take a step the ladder does not have, is the trigger's:
 *     0007 `ac_settlement_position_is_the_firms`.
 *
 * Money is a string of integer minor units on the wire.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const STATES: readonly SettlementState[] = ["draft", "issued", "acknowledged", "disputed", "paid"];

type Row = {
  id: string; firm_id: string; region_id: string; period_from: string; period_to: string; total_minor: string; currency: string;
  state: SettlementState; issued_at: string | null; acknowledged_at: string | null; disputed_at: string | null; dispute_reason: string | null; line_count: string;
  org_id: string;
};
const COLUMNS = `s.id, s.firm_id, s.region_id, s.org_id,
  to_char(lower(s.period), 'YYYY-MM-DD') AS period_from,
  to_char(upper(s.period) - 1, 'YYYY-MM-DD') AS period_to,
  s.total_minor::text AS total_minor, s.currency, s.state,
  to_char(s.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at,
  to_char(s.acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS acknowledged_at,
  to_char(s.disputed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS disputed_at,
  s.dispute_reason,
  (SELECT count(*) FROM settlement_lines l WHERE l.settlement_id = s.id)::text AS line_count`;

const toWire = (r: Row): SettlementWire => ({
  id: r.id, firmId: r.firm_id, regionId: r.region_id, periodFrom: r.period_from, periodTo: r.period_to,
  totalMinor: r.total_minor, currency: r.currency, state: r.state, issuedAt: r.issued_at,
  acknowledgedAt: r.acknowledged_at, disputedAt: r.disputed_at, disputeReason: r.dispute_reason, lineCount: Number(r.line_count),
});

export const listSettlements = async (uow: UnitOfWork, input: ListSettlementsInput): Promise<ListSettlementsOutput> => {
  const firmId = input.firmId === undefined ? null : requireUuid(input.firmId, "firmId");
  let state: SettlementState | null = null;
  if (input.state !== undefined) {
    if (!STATES.includes(input.state)) throw new BadInput(`state must be one of ${STATES.join(", ")}`);
    state = input.state;
  }
  const rows = await uow.tx.query<Row>(
    `SELECT ${COLUMNS} FROM settlements s
      WHERE ($1::uuid IS NULL OR s.firm_id = $1) AND ($2::text IS NULL OR s.state = $2)
      ORDER BY lower(s.period) DESC, s.created_at DESC`,
    [firmId, state],
  );
  return { settlements: rows.map(toWire) };
};

type LineRow = { id: string; settlement_id: string; job_id: string; service_code: string | null; site_name: string | null; rate_card_id: string; rate_minor: string | null; quantity_milli: string; amount_minor: string };

export const listSettlementLines = async (uow: UnitOfWork, input: ListSettlementLinesInput): Promise<ListSettlementLinesOutput> => {
  const settlementId = requireUuid(input.settlementId, "settlementId");
  // The statement first: a statement the principal cannot see is unknown, not
  // forbidden, and a firm learns nothing from the shape of the refusal.
  const head = (await uow.tx.query<{ id: string }>("SELECT id FROM settlements WHERE id = $1", [settlementId]))[0];
  if (!head) throw new InputRefused(`no statement ${settlementId} visible in this scope`, "unknown_settlement");
  // LEFT JOINs: the job and the rate are visible to the firm by 0007 (its own
  // work, its own price), and to us; a row the policy hides leaves a null, not
  // a missing line — the amount is on the line itself.
  const rows = await uow.tx.query<LineRow>(
    `SELECT l.id, l.settlement_id, l.job_id, j.service_code, a.name AS site_name, l.rate_card_id,
            r.rate_minor::text AS rate_minor, l.quantity_milli::text AS quantity_milli, l.amount_minor::text AS amount_minor
       FROM settlement_lines l
       LEFT JOIN jobs j ON j.id = l.job_id
       LEFT JOIN accounts a ON a.id = j.site_id
       LEFT JOIN rate_cards r ON r.id = l.rate_card_id
      WHERE l.settlement_id = $1
      ORDER BY l.created_at, l.id`,
    [settlementId],
  );
  return {
    settlementId,
    lines: rows.map((l) => ({
      id: l.id, settlementId: l.settlement_id, jobId: l.job_id, serviceCode: l.service_code, siteName: l.site_name,
      rateCardId: l.rate_card_id, rateMinor: l.rate_minor, quantityMilli: l.quantity_milli, amountMinor: l.amount_minor,
    })),
  };
};

const loadForPosition = async (uow: UnitOfWork, id: string): Promise<Row> => {
  const row = (await uow.tx.query<Row>(`SELECT ${COLUMNS} FROM settlements s WHERE s.id = $1`, [id]))[0];
  if (!row) throw new InputRefused(`no statement ${id} visible in this scope`, "unknown_settlement");
  return row;
};

export const acknowledgeSettlement = async (uow: UnitOfWork, input: AcknowledgeSettlementInput, now: Date): Promise<AcknowledgeSettlementOutput> => {
  const id = requireUuid(input.settlementId, "settlementId");
  const s = await loadForPosition(uow, id);
  if (s.state === "acknowledged") throw new InputRefused(`statement for ${s.period_from} → ${s.period_to} was acknowledged at ${s.acknowledged_at}`, "already_acknowledged");
  if (s.state !== "issued") {
    throw new InputRefused(`statement for ${s.period_from} → ${s.period_to} is ${s.state}; only an issued statement is acknowledged${s.state === "disputed" ? " — it is in dispute, and the office answers that" : ""}`, "not_issued");
  }
  const acknowledgedAt = now.toISOString();
  const eventId = await uow.apply(
    {
      entity: "settlement_ack", entityId: id, action: "settlement.acknowledge", topic: "settlement.acknowledged",
      before: { state: s.state, acknowledgedAt: null }, after: { state: "acknowledged", acknowledgedAt },
      orgId: s.org_id, regionId: s.region_id,
      payload: { firmId: s.firm_id, periodFrom: s.period_from, periodTo: s.period_to, totalMinor: s.total_minor, currency: s.currency },
    },
    async (tx) => {
      await tx.query("UPDATE settlements SET state = 'acknowledged', acknowledged_at = $2::timestamptz WHERE id = $1", [id, acknowledgedAt]);
    },
  );
  return { id, state: "acknowledged", acknowledgedAt, eventId };
};

export const disputeSettlement = async (uow: UnitOfWork, input: DisputeSettlementInput, now: Date): Promise<DisputeSettlementOutput> => {
  const id = requireUuid(input.settlementId, "settlementId");
  if (typeof input.reason !== "string" || input.reason.trim() === "") {
    throw new InputRefused("a dispute says why — reason is empty. Name the line, the rate or the quantity that is wrong.", "empty_reason");
  }
  const reason = input.reason.trim();
  const s = await loadForPosition(uow, id);
  if (s.state === "disputed") throw new InputRefused(`statement for ${s.period_from} → ${s.period_to} is already in dispute since ${s.disputed_at}: "${s.dispute_reason}". The office answers a dispute; a second reason is a message to them, not a second dispute.`, "already_disputed");
  if (s.state !== "issued" && s.state !== "acknowledged") {
    throw new InputRefused(`statement for ${s.period_from} → ${s.period_to} is ${s.state}; a firm disputes an issued or acknowledged statement`, "not_issued");
  }
  const disputedAt = now.toISOString();
  const eventId = await uow.apply(
    {
      entity: "dispute", entityId: id, action: "settlement.dispute", topic: "settlement.disputed",
      before: { state: s.state, disputedAt: null, disputeReason: null }, after: { state: "disputed", disputedAt, disputeReason: reason },
      orgId: s.org_id, regionId: s.region_id,
      payload: { firmId: s.firm_id, periodFrom: s.period_from, periodTo: s.period_to, totalMinor: s.total_minor, currency: s.currency, reason, from: s.state },
    },
    async (tx) => {
      await tx.query("UPDATE settlements SET state = 'disputed', disputed_at = $2::timestamptz, dispute_reason = $3 WHERE id = $1", [id, disputedAt, reason]);
    },
  );
  return { id, state: "disputed", disputedAt, eventId };
};
