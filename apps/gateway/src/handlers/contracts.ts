import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { TERMS } from "../../../../packages/contracts/src/terms.ts";
import type { Tier } from "../../../../packages/contracts/src/tiers.ts";
import type {
  ContractWire, ContractKind, ContractState, BillingPath,
  ListContractsInput, ListContractsOutput, CreateContractInput, CreateContractOutput,
  TransitionContractInput, TransitionContractOutput,
  ListTermOverridesInput, ListTermOverridesOutput, TermOverrideWire, TermRegisterOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * C2 — THE AGREEMENTS S2 AUTHORS, and the register the override form is drawn
 * from. A contract row is the signed document a term override belongs to: the
 * thing resolution walks is the override, but the thing a customer signed is
 * this, and the audit answer to "who agreed to this and when" is this row.
 *
 * What these handlers decide, and what they leave below:
 *
 *   - INPUTS. `regionId` is an input for a PARENT-scope agreement and for
 *     nothing else — the one scope with no edge to derive it from, because an
 *     organization meets several of our regions. Below that, the region is the
 *     scope node's, because a location agreement is administered from the
 *     region its location is dispatched from and nothing else. Naming it there
 *     is refused (`region_not_an_input`) — the same rule C1 applies to a node.
 *   - The AGREEMENT'S OWN SHAPE: an amendment names its MSA; a child of an
 *     ended agreement is refused; a window that ends on or before it starts is
 *     refused here rather than by Postgres, which raises 22000 for an inverted
 *     daterange and 22000 is not a refusal code — it would reach the surface
 *     as a 500 and flip the surface degraded (09 §3.7).
 *   - The STATE LADDER: draft → active → expired | terminated.
 *
 *   - Whether the SCOPE EXISTS at the declared tier is NOT decided here.
 *     `ac_contract_scope_exists` says so in its own words and covers every
 *     path into the table, not just this one. The handler reads the node only
 *     to take its region; a node that exists at a different tier than declared
 *     passes through and the trigger refuses it.
 *
 * OQ5 is three lines that say the same thing: `diagnostic_data_rights_reserved`
 * is NOT NULL in the schema, the form's control has a third state that will not
 * submit, and the check below. Absent or non-boolean is a **400**, not a 422 —
 * nothing was refused on its merits, because no position was stated.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const requireDate = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !ISO_DATE.test(v)) throw new BadInput(`${field} must be an ISO date (YYYY-MM-DD)`);
  return v;
};
const requireOneOf = <T extends string>(v: unknown, field: string, legal: readonly T[]): T => {
  if (typeof v !== "string" || !(legal as readonly string[]).includes(v)) {
    throw new BadInput(`${field} must be one of ${legal.join(", ")}`);
  }
  return v as T;
};

const SCOPE_TIERS: readonly Tier[] = ["parent", "region", "location", "site"];
const KINDS: readonly ContractKind[] = ["msa", "amendment", "location_agreement", "project_sow", "residential_membership", "one_time"];
const BILLING_PATHS: readonly BillingPath[] = ["one_time", "residential_membership", "enterprise_sla", "project"];

/**
 * THE STATE LADDER, as data. `draft` is the only start; `active` is the only
 * middle; both endings are terminal. A step that is not an edge here is
 * `illegal_transition` by name — the surface says which step was attempted
 * rather than "invalid state".
 */
const NEXT_STATES: Readonly<Record<ContractState, readonly ContractState[]>> = Object.freeze({
  draft: ["active"],
  active: ["expired", "terminated"],
  expired: [],
  terminated: [],
});

/**
 * Ending an agreement emits ONE topic with the ending in the payload.
 * `contract.expired` for both endings is deliberate: no subscriber acts
 * differently on "the term ran out" than on "somebody ended it", and a topic
 * list widened for a distinction nobody consumes is a topic list that drifts.
 */
const TOPIC_FOR: Readonly<Record<ContractState, "contract.amended" | "contract.expired">> = Object.freeze({
  draft: "contract.amended",
  active: "contract.amended",
  expired: "contract.expired",
  terminated: "contract.expired",
});

type ContractRow = {
  id: string; org_id: string; region_id: string; scope_tier: Tier; scope_id: string; kind: ContractKind;
  parent_contract_id: string | null; billing_path: BillingPath; signed_at: string;
  eff_from: string; eff_to: string | null; diagnostic_data_rights_reserved: boolean;
  document_key: string | null; state: ContractState;
};

const CONTRACT_COLUMNS = `id, org_id, region_id, scope_tier, scope_id, kind, parent_contract_id, billing_path,
        to_char(signed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS signed_at,
        to_char(lower(effective), 'YYYY-MM-DD') AS eff_from,
        CASE WHEN upper_inf(effective) THEN NULL ELSE to_char(upper(effective), 'YYYY-MM-DD') END AS eff_to,
        diagnostic_data_rights_reserved, document_key, state`;

const toWire = (c: ContractRow): ContractWire => ({
  id: c.id, scopeTier: c.scope_tier, scopeId: c.scope_id, kind: c.kind,
  parentContractId: c.parent_contract_id, billingPath: c.billing_path, regionId: c.region_id,
  signedAt: c.signed_at, effectiveFrom: c.eff_from, effectiveTo: c.eff_to,
  diagnosticDataRightsReserved: c.diagnostic_data_rights_reserved, documentKey: c.document_key, state: c.state,
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export const listContracts = async (uow: UnitOfWork, input: ListContractsInput): Promise<ListContractsOutput> => {
  const orgId = requireUuid(input.orgId, "orgId");
  const scopeId = input.scopeId === undefined ? null : requireUuid(input.scopeId, "scopeId");
  const rows = await uow.tx.query<ContractRow>(
    `SELECT ${CONTRACT_COLUMNS}
       FROM contracts
      WHERE org_id = $1 AND ($2::uuid IS NULL OR scope_id = $2)
      ORDER BY signed_at DESC, id`,
    [orgId, scopeId],
  );
  return { contracts: rows.map(toWire) };
};

export const listTermOverrides = async (uow: UnitOfWork, input: ListTermOverridesInput): Promise<ListTermOverridesOutput> => {
  const orgId = requireUuid(input.orgId, "orgId");
  const termKey = input.termKey ?? null;
  if (termKey !== null && !Object.hasOwn(TERMS, termKey)) throw new InputRefused(`"${termKey}" is not a registered term`, "unknown_term");
  const contractId = input.contractId === undefined ? null : requireUuid(input.contractId, "contractId");
  const rows = await uow.tx.query<{ id: string; contract_id: string; scope_tier: Tier; scope_id: string; term_key: string; term_value: unknown; eff_from: string; eff_to: string | null }>(
    `SELECT id, contract_id, scope_tier, scope_id, term_key, term_value,
            to_char(lower(effective), 'YYYY-MM-DD') AS eff_from,
            CASE WHEN upper_inf(effective) THEN NULL ELSE to_char(upper(effective), 'YYYY-MM-DD') END AS eff_to
       FROM contract_term_overrides
      WHERE org_id = $1 AND ($2::text IS NULL OR term_key = $2) AND ($3::uuid IS NULL OR contract_id = $3)
      ORDER BY term_key, scope_tier, eff_from`,
    [orgId, termKey, contractId],
  );
  const overrides: TermOverrideWire[] = rows.map((r) => ({
    id: r.id, contractId: r.contract_id, scopeTier: r.scope_tier, scopeId: r.scope_id,
    termKey: r.term_key, termValue: r.term_value, effectiveFrom: r.eff_from, effectiveTo: r.eff_to,
  }));
  return { overrides };
};

/**
 * The register, over the wire. It is code (packages/contracts/src/terms.ts) and
 * this hands it over unchanged so S2 renders eleven inputs it never had to
 * name. Nothing is read from the database: the `term_registry` table is the
 * MIRROR the admission trigger reads, not a second source.
 */
export const termRegister = (): TermRegisterOutput => ({ terms: Object.values(TERMS) });

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
const loadContract = async (uow: UnitOfWork, id: string): Promise<ContractRow> => {
  const row = (await uow.tx.query<ContractRow>(`SELECT ${CONTRACT_COLUMNS} FROM contracts WHERE id = $1`, [id]))[0];
  if (!row) throw new InputRefused(`no agreement ${id} visible in this scope`, "unknown_contract");
  return row;
};

export const createContract = async (uow: UnitOfWork, input: CreateContractInput, newId: () => string): Promise<CreateContractOutput> => {
  const orgId = requireUuid(input.orgId, "orgId");
  const scopeTier = requireOneOf(input.scopeTier, "scopeTier", SCOPE_TIERS);
  const scopeId = requireUuid(input.scopeId, "scopeId");
  const kind = requireOneOf(input.kind, "kind", KINDS);
  const billingPath = requireOneOf(input.billingPath, "billingPath", BILLING_PATHS);
  const signedAt = requireDate(input.signedAt, "signedAt");
  const effectiveFrom = requireDate(input.effectiveFrom, "effectiveFrom");
  const effectiveTo = input.effectiveTo === undefined || input.effectiveTo === null ? null : requireDate(input.effectiveTo, "effectiveTo");

  // OQ5. A 400, not a 422: nothing was judged, because no position was stated.
  if (typeof input.diagnosticDataRightsReserved !== "boolean") {
    throw new BadInput(
      "diagnosticDataRightsReserved must be stated as true or false — OQ5 is answered at signature, per record, and there is no default to fall back to",
    );
  }

  // The window. Postgres would raise 22000 for an inverted daterange, which is
  // not a refusal code; the handler says it first so the surface gets a 422.
  if (effectiveTo !== null && effectiveTo <= effectiveFrom) {
    throw new InputRefused(
      `the agreement is effective from ${effectiveFrom} to ${effectiveTo} — a window that ends on or before it starts covers no day at all`,
      "empty_window",
    );
  }

  if (kind === "amendment") {
    if (input.parentContractId === undefined) {
      throw new InputRefused("an amendment amends something — name the agreement it belongs to", "amendment_needs_parent");
    }
  }
  let parentContractId: string | null = null;
  if (input.parentContractId !== undefined) {
    parentContractId = requireUuid(input.parentContractId, "parentContractId");
    const parent = await loadContract(uow, parentContractId);
    if (parent.org_id !== orgId) throw new InputRefused(`agreement ${parentContractId} belongs to another organization`, "tenancy_mismatch");
    if (parent.state === "expired" || parent.state === "terminated") {
      throw new InputRefused(
        `agreement ${parentContractId} is ${parent.state} — a child of an agreement that has ended is a row nobody is bound by`,
        "parent_contract_ended",
      );
    }
  }

  // The region: an input at parent scope, the node's edge below it.
  let regionId: string;
  if (scopeTier === "parent") {
    if (input.regionId === undefined) {
      throw new BadInput("regionId is required for a parent-scope agreement — an organization meets several of our regions and the agreement is administered from one of them");
    }
    regionId = requireUuid(input.regionId, "regionId");
  } else {
    if (input.regionId !== undefined) {
      throw new InputRefused(
        `a ${scopeTier}-scope agreement declares regionId, but it is administered from the region its ${scopeTier} is dispatched from and nothing else. Name the scope; the region follows.`,
        "region_not_an_input",
      );
    }
    // Read by id alone. Whether the node is AT the declared tier is
    // ac_contract_scope_exists's to say, in its own words.
    const node = (await uow.tx.query<{ id: string; region_id: string; org_id: string }>("SELECT id, region_id, org_id FROM accounts WHERE id = $1", [scopeId]))[0];
    if (!node) throw new InputRefused(`no node ${scopeId} visible in this scope`, "unknown_scope");
    if (node.org_id !== orgId) throw new InputRefused(`node ${scopeId} belongs to another organization`, "tenancy_mismatch");
    regionId = node.region_id;
  }

  const id = newId();
  const after = {
    id, scopeTier, scopeId, kind, parentContractId, billingPath, regionId, signedAt,
    effectiveFrom, effectiveTo, diagnosticDataRightsReserved: input.diagnosticDataRightsReserved,
    documentKey: input.documentKey ?? null, state: "draft" as const,
  };
  const eventId = await uow.apply(
    {
      entity: "contract", entityId: id, action: "contract.create", topic: "contract.created",
      before: null, after, orgId, regionId,
      payload: { kind, scopeTier, scopeId, billingPath, effectiveFrom, effectiveTo, diagnosticDataRightsReserved: input.diagnosticDataRightsReserved },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, parent_contract_id, billing_path, signed_at, effective, diagnostic_data_rights_reserved, document_key, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, daterange($10::date, $11::date, '[)'), $12, $13, 'draft')`,
        [id, orgId, regionId, scopeTier, scopeId, kind, parentContractId, billingPath, signedAt, effectiveFrom, effectiveTo, input.diagnosticDataRightsReserved, input.documentKey ?? null],
      );
    },
  );
  return { id, regionId, eventId };
};

export const transitionContract = async (uow: UnitOfWork, input: TransitionContractInput): Promise<TransitionContractOutput> => {
  const contractId = requireUuid(input.contractId, "contractId");
  const to = requireOneOf(input.to, "to", ["active", "expired", "terminated"] as const);
  const current = await loadContract(uow, contractId);
  const legal = NEXT_STATES[current.state];
  if (!legal.includes(to)) {
    throw new InputRefused(
      legal.length === 0
        ? `agreement ${contractId} is ${current.state}; an agreement that has ended does not move again`
        : `agreement ${contractId} is ${current.state} and can only become ${legal.join(" or ")}, not ${to}`,
      "illegal_transition",
    );
  }

  const eventId = await uow.apply(
    {
      entity: "contract", entityId: contractId, action: `contract.${to}`, topic: TOPIC_FOR[to],
      before: { state: current.state }, after: { state: to },
      orgId: current.org_id, regionId: current.region_id,
      payload: { from: current.state, to, kind: current.kind, scopeTier: current.scope_tier, scopeId: current.scope_id },
    },
    async (tx) => { await tx.query("UPDATE contracts SET state = $2 WHERE id = $1", [contractId, to]); },
  );
  return { id: contractId, state: to, eventId };
};
