import { TERMS, checkTermValue, type TermPolicy } from "../../packages/contracts/src/terms.ts";
import {
  TECHNICIAN_ROLES, TECHNICIAN_SPECIALTIES,
  type AccountWire, type AddressWire, type BillingPath, type ContractWire, type CredentialKind, type CredentialWire, type CrewKind,
  type CrewWire, type FirmWire, type PersonWire, type RegionWire, type Refusal, type TechnicianRole, type TechnicianSpecialty,
  type TechnicianWire, type TermOverrideWire,
} from "../../packages/contracts/src/index.ts";
import type { ConnectedShell } from "../../packages/shell/src/index.ts";
import type { CsvFile, CsvRow } from "./csv.ts";

/**
 * THE IMPORTER — loads CSV rows through the gateway operations S2's own screens
 * call, as a signed-in principal. No SQL: every row is admitted, audited and
 * row-security checked exactly as if it had been typed into S2.
 *
 *   - ORDER. firms → crews → technicians → credentials → customers →
 *     agreements, whatever order the files are named in: a crew names its
 *     firm, a credential its crew, an agreement its customer; and a location
 *     is admitted against the crews already in its region (D14).
 *   - RE-RUNNABLE. Each row is matched on a natural key (see KEYS in
 *     docs/IMPORT.md) against what the gateway already holds, and is created,
 *     updated where an update is safe, or skipped — never written twice.
 *   - REFUSALS. A row the gateway refuses is reported by file and line in the
 *     gateway's own words. A row is checked locally first (required fields,
 *     values off a list, the names it refers to, a term's value against the
 *     register) so that a row of several writes is refused before its first
 *     one; a refusal part-way is reported with what was already written, and
 *     running the file again completes the row.
 *   - DRY RUN. The same checks and the same matching, reads only. The gateway
 *     may still refuse a row on its merits that no local check can see.
 */
export const FILES = ["firms", "crews", "technicians", "credentials", "customers", "agreements"] as const;
export type FileKind = (typeof FILES)[number];

/** The launch region (owner, 2026-10-31). A blank `region` column means it. */
export const DEFAULT_REGION = "DFW";

/** Parent-scope agreement terms an agreements file may carry as columns, beside the agreement's own fields. */
const TERM_COLUMNS: readonly TermPolicy[] = Object.values(TERMS).filter((t) => t.authoring.includes("parent") && t.combine.kind !== "attach" && t.key !== "diagnostic_data_rights_reserved");

export const HEADERS: Readonly<Record<FileKind, { readonly required: readonly string[]; readonly optional: readonly string[] }>> = {
  firms: { required: ["legal_name", "settlement_terms_days", "diagnostic_data_rights_reserved"], optional: ["region", "msa_signed_at", "external_ref", "status"] },
  crews: { required: ["label", "kind"], optional: ["region", "firm"] },
  technicians: { required: ["name"], optional: ["region", "firm", "role", "crew", "email", "phone", "specialties"] },
  credentials: { required: ["crew", "kind", "identifier", "valid_from", "valid_to"], optional: ["region", "firm", "document_key"] },
  customers: {
    required: ["customer_ref", "customer_name", "address_line1"],
    optional: ["segment", "region", "region_node_name", "location_name", "site_name", "site_ref", "address_line2", "city", "state", "postal", "country", "contact_name", "contact_phone", "contact_email"],
  },
  agreements: {
    required: ["customer_ref", "signed_at", "effective_from", "diagnostic_data_rights_reserved"],
    optional: ["region", "billing_path", "effective_to", "activate", ...TERM_COLUMNS.map((t) => t.key)],
  },
};

export type Outcome = "created" | "updated" | "skipped" | "rejected";
export type RowReport = { readonly file: FileKind; readonly line: number; readonly outcome: Outcome; readonly what: string; readonly message?: string };
export type IssuedPassword = { readonly email: string; readonly name: string; readonly temporaryPassword: string };
export type ImportResult = { readonly rows: readonly RowReport[]; readonly passwords: readonly IssuedPassword[]; readonly fileErrors: readonly string[] };

/** A row refused — locally, or by the gateway in its own words — with what it had already written. */
class RowRefused extends Error {
  readonly written: readonly string[];
  constructor(message: string, written: readonly string[] = []) {
    super(message);
    this.name = "RowRefused";
    this.written = written;
  }
}
/** The gateway is unreachable or the session ended: nothing more can be loaded, so the run stops. */
export class ImportAborted extends Error {}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YES = ["yes", "y", "true", "1"], NO = ["no", "n", "false", "0"];

type Gateway = ConnectedShell["gateway"];
type Ctx = { readonly gateway: Gateway; readonly refusalOf: (e: unknown) => Refusal | null; readonly dry: boolean; readonly verify: boolean };

export const runImport = async (
  shell: Pick<ConnectedShell, "gateway" | "refusalOf">,
  files: ReadonlyMap<FileKind, CsvFile>,
  opts: { readonly dryRun: boolean; readonly verifyCredentials: boolean; readonly onRow?: (r: RowReport) => void },
): Promise<ImportResult> => {
  const ctx: Ctx = { gateway: shell.gateway, refusalOf: shell.refusalOf, dry: opts.dryRun, verify: opts.verifyCredentials };
  const rows: RowReport[] = [];
  const passwords: IssuedPassword[] = [];
  const fileErrors: string[] = [];

  for (const kind of FILES) {
    const f = files.get(kind);
    if (!f) continue;
    const { required, optional } = HEADERS[kind];
    const unknown = f.headers.filter((h) => !required.includes(h) && !optional.includes(h));
    const missing = required.filter((h) => !f.headers.includes(h));
    if (unknown.length || missing.length) {
      fileErrors.push(`${kind}.csv:1: ${[missing.length ? `missing column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}` : "", unknown.length ? `unknown column${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}` : ""].filter(Boolean).join("; ")} — nothing in this file was loaded`);
    }
  }
  if (fileErrors.length) return { rows, passwords, fileErrors };

  const ix = await Index.load(ctx);
  let dryIds = 0;
  const placeholder = () => `dry:${++dryIds}`;
  const env: Env = { ctx, ix, placeholder, passwords };

  for (const kind of FILES) {
    const f = files.get(kind);
    if (!f) continue;
    for (const row of f.rows) {
      let report: RowReport;
      try {
        const r = await HANDLERS[kind](env, new Fields(row));
        report = { file: kind, line: row.line, ...r };
      } catch (e) {
        if (!(e instanceof RowRefused)) throw e;
        const tail = e.written.length ? ` (already written for this row: ${e.written.join(", ")} — run the file again once it is fixed to finish it)` : "";
        report = { file: kind, line: row.line, outcome: "rejected", what: "", message: e.message + tail };
      }
      rows.push(report);
      opts.onRow?.(report);
    }
  }
  return { rows, passwords, fileErrors };
};

// ---------------------------------------------------------------------------
// One row's fields
// ---------------------------------------------------------------------------
class Fields {
  readonly row: CsvRow;
  constructor(row: CsvRow) { this.row = row; }
  opt(k: string): string | undefined { const v = this.row.values[k]; return v === undefined || v === "" ? undefined : v; }
  req(k: string): string { const v = this.opt(k); if (v === undefined) throw new RowRefused(`${k} is blank`); return v; }
  date(k: string, required: true): string;
  date(k: string, required?: false): string | undefined;
  date(k: string, required = false): string | undefined {
    const v = required ? this.req(k) : this.opt(k);
    if (v === undefined) return undefined;
    if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new RowRefused(`${k} "${v}" is not a date — write it YYYY-MM-DD`);
    return v;
  }
  bool(k: string, fallback?: boolean): boolean {
    const v = this.opt(k);
    if (v === undefined) { if (fallback === undefined) throw new RowRefused(`${k} is blank — say yes or no`); return fallback; }
    if (YES.includes(v.toLowerCase())) return true;
    if (NO.includes(v.toLowerCase())) return false;
    throw new RowRefused(`${k} "${v}" is not yes or no`);
  }
  int(k: string): number {
    const v = this.req(k);
    if (!/^\d+$/.test(v)) throw new RowRefused(`${k} "${v}" is not a whole number`);
    return Number(v);
  }
  oneOf<T extends string>(k: string, list: readonly T[], fallback?: T): T {
    const v = this.opt(k);
    if (v === undefined) { if (fallback === undefined) throw new RowRefused(`${k} is blank — one of ${list.join(", ")}`); return fallback; }
    const hit = list.find((x) => x === v.toLowerCase());
    if (!hit) throw new RowRefused(`${k} "${v}" is not one of ${list.join(", ")}`);
    return hit;
  }
}

// ---------------------------------------------------------------------------
// What the gateway already holds, read once and kept current as rows land
// ---------------------------------------------------------------------------
type Org = { id: string; name: string; segment: string | null };
class Index {
  readonly ctx: Ctx;
  regions = new Map<string, RegionWire>();
  orgs = new Map<string, Org>();
  firms: FirmWire[] = [];
  crews: CrewWire[] = [];
  techs: TechnicianWire[] = [];
  people: PersonWire[] = [];
  private accountsBy = new Map<string, AccountWire[]>();
  private contractsBy = new Map<string, ContractWire[]>();
  private overridesBy = new Map<string, TermOverrideWire[]>();
  private credsBy = new Map<string, CredentialWire[]>();
  constructor(ctx: Ctx) { this.ctx = ctx; }

  static async load(ctx: Ctx): Promise<Index> {
    const ix = new Index(ctx);
    const g = ctx.gateway;
    const [regions, orgs, firms, crews, techs, people] = await Promise.all([
      g.listRegions(), g.listOrganizations({ kind: "customer" }), g.listFirms({}), g.listCrews({}), g.listTechnicians({}), g.listPeople(),
    ]).catch((e: unknown) => { throw new ImportAborted(`could not read what the gateway holds: ${ctx.refusalOf(e)?.message ?? String(e)}`); });
    for (const r of regions.regions) ix.regions.set(r.code, r);
    for (const o of orgs.organizations) if (o.externalRef) ix.orgs.set(norm(o.externalRef), { id: o.id, name: o.name, segment: o.segment });
    ix.firms = [...firms.firms];
    ix.crews = [...crews.crews];
    ix.techs = [...techs.technicians];
    ix.people = [...people.people];
    return ix;
  }

  private async lazy<T>(m: Map<string, T[]>, id: string, read: () => Promise<readonly T[]>): Promise<T[]> {
    let v = m.get(id);
    if (!v) { v = id.startsWith("dry:") ? [] : [...await read()]; m.set(id, v); }
    return v;
  }
  accounts(orgId: string) { return this.lazy(this.accountsBy, orgId, async () => (await this.ctx.gateway.listAccounts({ orgId })).nodes); }
  contracts(orgId: string) { return this.lazy(this.contractsBy, orgId, async () => (await this.ctx.gateway.listContracts({ orgId })).contracts); }
  overrides(orgId: string) { return this.lazy(this.overridesBy, orgId, async () => (await this.ctx.gateway.listTermOverrides({ orgId })).overrides); }
  credentials(crewId: string) { return this.lazy(this.credsBy, crewId, async () => (await this.ctx.gateway.listCredentials({ crewId })).credentials); }

  region(f: Fields): RegionWire {
    const code = (f.opt("region") ?? DEFAULT_REGION).toUpperCase();
    const r = this.regions.get(code);
    if (!r || !r.assignable) throw new RowRefused(`region ${code} is not one we serve from — open it in the Service Manager under People › Regions${r && !r.active ? " (it is closed)" : ""}`);
    return r;
  }
  firm(f: Fields): FirmWire | null {
    const name = f.opt("firm");
    if (name === undefined) return null;
    const hit = this.firms.find((x) => norm(x.legalName) === norm(name));
    if (!hit) throw new RowRefused(`no firm "${name}" — list it in firms.csv, or leave firm blank for one of ours`);
    return hit;
  }
  crew(label: string, region: RegionWire, firm: FirmWire | null): CrewWire | undefined {
    return this.crews.find((c) => norm(c.label) === norm(label) && c.homeRegionId === region.id && c.firmId === (firm?.id ?? null));
  }
}

type Env = { readonly ctx: Ctx; readonly ix: Index; readonly placeholder: () => string; readonly passwords: IssuedPassword[] };
type Done = { readonly outcome: Exclude<Outcome, "rejected">; readonly what: string };

/** One gateway write. A refusal becomes the row's, in the gateway's words; a transport or session failure stops the run. */
const write = async <T>(env: Env, written: readonly string[], fn: (g: Gateway) => Promise<T>): Promise<T> => {
  try {
    return await fn(env.ctx.gateway);
  } catch (e) {
    const r = env.ctx.refusalOf(e);
    if (!r || r.kind === "transport" || r.kind === "token") throw new ImportAborted(`the gateway stopped answering: ${r?.message ?? String(e)}`);
    throw new RowRefused(r.message, written);
  }
};

// ---------------------------------------------------------------------------
// The six files
// ---------------------------------------------------------------------------
const FIRM_STATUSES = ["onboarding", "active"] as const;
const CREW_KINDS_IN = ["service", "install"] as const satisfies readonly CrewKind[];
const CREDENTIAL_KINDS = ["license", "background_check", "insurance", "certification"] as const satisfies readonly CredentialKind[];
const SEGMENTS = ["commercial", "residential"] as const;
const BILLING_PATHS = ["enterprise_sla", "one_time", "residential_membership", "project"] as const satisfies readonly BillingPath[];

const firms = async (env: Env, f: Fields): Promise<Done> => {
  const { ix, ctx } = env;
  const legalName = f.req("legal_name");
  const region = ix.region(f);
  const settlementTermsDays = f.int("settlement_terms_days");
  const diagnosticDataRightsReserved = f.bool("diagnostic_data_rights_reserved");
  const msaSignedAt = f.date("msa_signed_at");
  const externalRef = f.opt("external_ref");
  const status = f.oneOf("status", FIRM_STATUSES, "onboarding");
  if (status === "active" && !msaSignedAt) throw new RowRefused("status active needs msa_signed_at — a firm is activated on a signed MSA");

  const have = ix.firms.find((x) => norm(x.legalName) === norm(legalName));
  if (have) {
    if (status === "active" && have.status === "onboarding") {
      if (!ctx.dry) await write(env, [], (g) => g.updateFirm({ firmId: have.id, ...(have.msaSignedAt || !msaSignedAt ? {} : { msaSignedAt }), status: "active" }));
      ix.firms[ix.firms.indexOf(have)] = { ...have, status: "active" };
      return { outcome: "updated", what: `${legalName} — activated` };
    }
    return { outcome: "skipped", what: legalName };
  }
  let id = env.placeholder();
  if (!ctx.dry) {
    id = (await write(env, [], (g) => g.createFirm({ legalName, regionId: region.id, settlementTermsDays, diagnosticDataRightsReserved, ...(msaSignedAt ? { msaSignedAt } : {}), ...(externalRef ? { externalRef } : {}) }))).id;
    if (status === "active") await write(env, [`firm ${legalName} (onboarding)`], (g) => g.updateFirm({ firmId: id, status: "active" }));
  }
  ix.firms.push({ id, legalName, status, regionId: region.id, settlementTermsDays, msaSignedAt: msaSignedAt ?? null, diagnosticDataRightsReserved, w9DocumentKey: null, crewCount: 0, activeCrewCount: 0 });
  return { outcome: "created", what: `${legalName}${status === "active" ? " — active" : " — onboarding"}` };
};

const crews = async (env: Env, f: Fields): Promise<Done> => {
  const { ix, ctx } = env;
  const label = f.req("label");
  const kind = f.oneOf("kind", CREW_KINDS_IN);
  const region = ix.region(f);
  const firm = ix.firm(f);
  const have = ix.crew(label, region, firm);
  if (have) return { outcome: "skipped", what: `${label} (${region.code})` };
  let id = env.placeholder();
  if (!ctx.dry) {
    id = (await write(env, [], (g) => g.createCrew({ label, kind, homeRegionId: region.id, ...(firm ? { employmentType: "subcontracted" as const, firmId: firm.id } : { employmentType: "employed" as const }) }))).id;
  }
  ix.crews.push({ id, label, kind, employmentType: firm ? "subcontracted" : "employed", firmId: firm?.id ?? null, homeRegionId: region.id, active: true, documents: { required: [], satisfied: [], unverified: [], expired: [], missing: [], earliestExpiry: null } });
  return { outcome: "created", what: `${label} (${region.code}, ${firm?.legalName ?? "ours"})` };
};

const technicians = async (env: Env, f: Fields): Promise<Done> => {
  const { ix, ctx } = env;
  const name = f.req("name");
  const region = ix.region(f);
  const firm = ix.firm(f);
  const role: TechnicianRole = f.oneOf("role", TECHNICIAN_ROLES, "technician");
  const email = f.opt("email")?.toLowerCase();
  const crewLabel = f.opt("crew");
  const phone = f.opt("phone");
  const specialties = (f.opt("specialties") ?? "").split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const s of specialties) if (!(TECHNICIAN_SPECIALTIES as readonly string[]).includes(s)) throw new RowRefused(`specialty "${s}" is not one of ${TECHNICIAN_SPECIALTIES.join(", ")}`);
  if (email && role !== "technician") throw new RowRefused(`a login is made for a technician on their own unit — a ${role} works on an install crew; leave email blank`);
  if (email && crewLabel) throw new RowRefused("a technician with a login works from their own unit, made with the login — leave crew blank");

  let crewId: string | null = null;
  const done: string[] = [];
  if (crewLabel) {
    const crew = ix.crew(crewLabel, region, firm);
    if (!crew) throw new RowRefused(`no crew "${crewLabel}" in ${region.code} for ${firm?.legalName ?? "us"} — list it in crews.csv`);
    crewId = crew.id;
  }
  const roster = ix.techs.find((t) => norm(t.name) === norm(name) && t.firmId === (firm?.id ?? null));
  if (email) {
    const person = ix.people.find((p) => p.email === email);
    if (person) {
      if (person.kind !== "technician") throw new RowRefused(`${email} is a staff login, not a technician's`);
      crewId = person.crewId;
    } else {
      let userId = env.placeholder(), unit = env.placeholder();
      if (!ctx.dry) {
        const out = await write(env, [], (g) => g.createTechnicianLogin({ email, displayName: name, homeRegionId: region.id, ...(firm ? { firmId: firm.id } : {}) }));
        userId = out.userId; unit = out.crewId!;
        env.passwords.push({ email, name, temporaryPassword: out.temporaryPassword });
      }
      crewId = unit;
      ix.people.push({ userId, email, displayName: name, kind: "technician", roles: ["technician"], scope: "region", regionId: region.id, regionCode: region.code, crewId: unit, crewLabel: name, firmId: firm?.id ?? null, firmName: firm?.legalName ?? null, active: true, mustChangePassword: true, passwordChangedAt: null });
      ix.crews.push({ id: unit, label: name, kind: "service", employmentType: firm ? "subcontracted" : "employed", firmId: firm?.id ?? null, homeRegionId: region.id, active: true, documents: { required: [], satisfied: [], unverified: [], expired: [], missing: [], earliestExpiry: null } });
      done.push(`login ${email} with their own unit`);
    }
  }
  if (!roster) {
    let id = env.placeholder();
    if (!ctx.dry) {
      id = (await write(env, done, (g) => g.recordTechnician({
        name, role, specialties: specialties as TechnicianSpecialty[], homeRegionId: region.id,
        ...(firm ? { firmId: firm.id } : {}), ...(crewId ? { crewId } : {}), ...(phone ? { phone } : {}),
      }))).id;
    }
    ix.techs.push({ id, firmId: firm?.id ?? null, crewId, name, phone: phone ?? null, homeAddress: null, addressRestricted: false, role, specialties: specialties as TechnicianSpecialty[], homeRegionId: region.id, active: true });
    done.push("roster record");
  }
  return done.length ? { outcome: "created", what: `${name} — ${done.join(", ")}` } : { outcome: "skipped", what: name };
};

const credentials = async (env: Env, f: Fields): Promise<Done> => {
  const { ix, ctx } = env;
  const crewLabel = f.req("crew");
  const region = ix.region(f);
  const firm = ix.firm(f);
  const kind = f.oneOf("kind", CREDENTIAL_KINDS);
  const identifier = f.req("identifier");
  const validFrom = f.date("valid_from", true);
  const validTo = f.date("valid_to", true);
  const documentKey = f.opt("document_key");
  const crew = ix.crew(crewLabel, region, firm);
  if (!crew) throw new RowRefused(`no crew "${crewLabel}" in ${region.code} for ${firm?.legalName ?? "us"} — list it in crews.csv, or give a technician's name for their own unit`);
  const what = `${kind} ${identifier} for ${crew.label}`;

  const held = await ix.credentials(crew.id);
  const have = held.find((c) => c.kind === kind && c.identifier.trim() === identifier);
  if (have) {
    if (have.validFrom !== validFrom || have.validTo !== validTo) {
      throw new RowRefused(`${what} is on file as ${have.validFrom} to ${have.validTo} — a document is not edited; record a renewal under its own identifier`);
    }
    if (ctx.verify && !have.verifiedAt) {
      if (!ctx.dry) await write(env, [], (g) => g.verifyCredential({ credentialId: have.id }));
      held[held.indexOf(have)] = { ...have, verifiedAt: "now" };
      return { outcome: "updated", what: `${what} — verified` };
    }
    return { outcome: "skipped", what };
  }
  let id = env.placeholder();
  if (!ctx.dry) {
    id = (await write(env, [], (g) => g.recordCredential({ crewId: crew.id, kind, identifier, validFrom, validTo, ...(documentKey ? { documentKey } : {}) }))).id;
    if (ctx.verify) await write(env, [`${what} (unverified)`], (g) => g.verifyCredential({ credentialId: id }));
  }
  held.push({ id, crewId: crew.id, kind, identifier, validFrom, validTo, documentKey: documentKey ?? null, verifiedAt: ctx.verify ? "now" : null, verifiedBy: null });
  return { outcome: "created", what: `${what}${ctx.verify ? " — verified" : ""}` };
};

const addressOf = (f: Fields): AddressWire => {
  const a: Record<string, string> = { line1: f.req("address_line1") };
  for (const [col, key] of [["address_line2", "line2"], ["city", "city"], ["state", "state"], ["postal", "postal"], ["country", "country"]] as const) {
    const v = f.opt(col);
    if (v !== undefined) a[key] = v;
  }
  return a;
};

const customers = async (env: Env, f: Fields): Promise<Done> => {
  const { ix, ctx } = env;
  const ref = f.req("customer_ref");
  const name = f.req("customer_name");
  const segment = f.oneOf("segment", SEGMENTS, "commercial");
  const region = ix.region(f);
  const address = addressOf(f);
  const org = ix.orgs.get(norm(ref));
  if (org && org.segment && org.segment !== segment) throw new RowRefused(`customer ${ref} is on file as ${org.segment}, not ${segment} — a customer's segment does not change`);

  if (segment === "residential") {
    if (org) return { outcome: "skipped", what: `${name} (${ref})` };
    const contactName = f.opt("contact_name"), contactPhone = f.opt("contact_phone"), contactEmail = f.opt("contact_email");
    let orgId = env.placeholder();
    if (!ctx.dry) {
      orgId = (await write(env, [], (g) => g.createResidentialCustomer({
        name, regionId: region.id, address, externalRef: ref,
        ...(contactName ? { contact: { name: contactName, ...(contactPhone ? { phone: contactPhone } : {}), ...(contactEmail ? { email: contactEmail } : {}) } } : {}),
      }))).orgId;
    }
    ix.orgs.set(norm(ref), { id: orgId, name, segment });
    return { outcome: "created", what: `${name} (${ref}) — household, site and standard home agreement` };
  }

  const locationName = f.req("location_name");
  const siteName = f.req("site_name");
  const siteRef = f.opt("site_ref");
  const nodeName = f.opt("region_node_name") ?? `${name} — ${region.name}`;
  const written: string[] = [];

  let orgId: string;
  let nodes: AccountWire[];
  if (org) {
    orgId = org.id;
    nodes = await ix.accounts(orgId);
  } else {
    orgId = env.placeholder();
    let nodeId = env.placeholder();
    if (!ctx.dry) {
      const out = await write(env, written, (g) => g.createOrganization({ name, segment: "commercial", externalRef: ref, firstRegionNode: { regionId: region.id, name: nodeName } }));
      orgId = out.orgId; nodeId = out.regionNodeId;
    }
    ix.orgs.set(norm(ref), { id: orgId, name, segment });
    nodes = await ix.accounts(orgId);
    if (!nodes.some((n) => n.id === nodeId)) nodes.push(node(nodeId, "region", nodeName, null, region.id));
    written.push(`customer ${name}`);
  }
  const create = async (tier: "region" | "location" | "site", parent: AccountWire | null, nodeLabel: string, extra: { externalRef?: string; address?: AddressWire } = {}): Promise<AccountWire> => {
    let id = env.placeholder();
    if (!ctx.dry) {
      id = (await write(env, written, (g) => g.createAccount({
        orgId, tier, name: nodeLabel, ...(parent ? { parentId: parent.id } : { regionId: region.id }), ...extra,
      }))).id;
    }
    const n = node(id, tier, nodeLabel, parent?.id ?? null, region.id, extra.externalRef, extra.address);
    nodes.push(n);
    written.push(`${tier} ${nodeLabel}`);
    return n;
  };

  const rnode = nodes.find((n) => n.tier === "region" && n.regionId === region.id && n.active) ?? await create("region", null, nodeName);
  const loc = nodes.find((n) => n.tier === "location" && n.parentId === rnode.id && norm(n.name) === norm(locationName)) ?? await create("location", rnode, locationName);
  const site = siteRef
    ? nodes.find((n) => n.tier === "site" && n.externalRef !== null && norm(n.externalRef) === norm(siteRef))
    : nodes.find((n) => n.tier === "site" && n.parentId === loc.id && norm(n.name) === norm(siteName));
  if (!site) {
    await create("site", loc, siteName, { ...(siteRef ? { externalRef: siteRef } : {}), address });
    return { outcome: "created", what: `${name} (${ref}) — ${written.join(", ")}` };
  }
  if (site.parentId !== loc.id) throw new RowRefused(`site ${siteRef ?? siteName} is filed under another location — move it in the Service Manager, not here`, written);
  const merged = { ...(site.address ?? {}), ...address };
  const changed = (Object.keys(address) as (keyof AddressWire)[]).some((k) => site.address?.[k] !== address[k]);
  if (changed) {
    if (!ctx.dry) await write(env, written, (g) => g.updateAccount({ accountId: site.id, address: merged }));
    nodes[nodes.indexOf(site)] = { ...site, address: merged };
    return { outcome: written.length ? "created" : "updated", what: `${name} (${ref}) — ${[...written, `site ${site.name} address`].join(", ")}` };
  }
  return written.length ? { outcome: "created", what: `${name} (${ref}) — ${written.join(", ")}` } : { outcome: "skipped", what: `${name} (${ref}) — ${site.name}` };
};

const node = (id: string, tier: AccountWire["tier"], name: string, parentId: string | null, regionId: string, externalRef?: string, address?: AddressWire): AccountWire => ({
  id, tier, name, parentId, regionId, customerGroup: null, externalRef: externalRef ?? null, timezone: null, active: true, path: [], address: address ?? null,
});

/** A term column's text, as the register's value kind. Checked by the same function the gateway admits it with. */
const termValue = (p: TermPolicy, raw: string): unknown => {
  let v: unknown = raw;
  if (p.valueKind === "int") {
    if (!/^-?\d+$/.test(raw)) throw new RowRefused(`${p.key} "${raw}" is not a whole number`);
    v = Number(raw);
  } else if (p.valueKind === "money") {
    if (!/^\d+$/.test(raw)) throw new RowRefused(`${p.key} "${raw}" is not an amount in cents (12500 is $125.00)`);
  } else if (p.valueKind === "bool") {
    if (YES.includes(raw.toLowerCase())) v = true;
    else if (NO.includes(raw.toLowerCase())) v = false;
    else throw new RowRefused(`${p.key} "${raw}" is not yes or no`);
  }
  try { checkTermValue(p, v); } catch (e) { throw new RowRefused((e as Error).message); }
  return v;
};

const agreements = async (env: Env, f: Fields): Promise<Done> => {
  const { ix, ctx } = env;
  const ref = f.req("customer_ref");
  const signedAt = f.date("signed_at", true);
  const effectiveFrom = f.date("effective_from", true);
  const effectiveTo = f.date("effective_to");
  const ddr = f.bool("diagnostic_data_rights_reserved");
  const billingPath = f.oneOf("billing_path", BILLING_PATHS, "enterprise_sla");
  const activate = f.bool("activate", true);
  const org = ix.orgs.get(norm(ref));
  if (!org) throw new RowRefused(`no customer ${ref} — list it in customers.csv`);
  if (org.segment === "residential") throw new RowRefused(`${org.name} is a household, on the standard home agreement from the day it was made`);
  const nodes = await ix.accounts(org.id);
  // Administered from the region given, or else the region the customer's first region node is in.
  const firstNode = nodes.find((n) => n.tier === "region" && n.active);
  const region = f.opt("region") !== undefined ? ix.region(f) : [...ix.regions.values()].find((r) => r.id === firstNode?.regionId);
  if (!region?.assignable) throw new RowRefused("the customer has no region node in a region we serve from — give a region");

  const terms: [TermPolicy, unknown][] = [];
  for (const p of TERM_COLUMNS) {
    const raw = f.opt(p.key);
    if (raw !== undefined) terms.push([p, termValue(p, raw)]);
  }
  terms.push([TERMS.diagnostic_data_rights_reserved!, ddr]);

  const what = `MSA for ${org.name} from ${effectiveFrom}`;
  const contracts = await ix.contracts(org.id);
  let c = contracts.find((x) => x.scopeTier === "parent" && x.scopeId === org.id && x.kind === "msa" && x.effectiveFrom === effectiveFrom);
  const overrides = await ix.overrides(org.id);
  const done: string[] = [];
  if (c) {
    if (c.signedAt.slice(0, 10) !== signedAt || c.billingPath !== billingPath) {
      throw new RowRefused(`${what} is on file signed ${c.signedAt.slice(0, 10)}, billed ${c.billingPath} — change it in the Service Manager, not here`);
    }
    // Every term is checked against what is on file before any is written, so a conflict writes nothing.
    for (const [p, v] of terms) {
      const on = overrides.find((o) => o.contractId === c!.id && o.scopeTier === "parent" && o.termKey === p.key);
      if (on && JSON.stringify(on.termValue) !== JSON.stringify(v)) {
        throw new RowRefused(`${what} already says ${p.key} = ${JSON.stringify(on.termValue)} — a signed term is changed by an amendment in the Service Manager, not by import`);
      }
    }
  } else {
    let id = env.placeholder();
    if (!ctx.dry) {
      id = (await write(env, [], (g) => g.createContract({
        orgId: org.id, regionId: region.id, scopeTier: "parent", scopeId: org.id, kind: "msa", billingPath, signedAt, effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}), diagnosticDataRightsReserved: ddr,
      }))).id;
    }
    c = { id, scopeTier: "parent", scopeId: org.id, kind: "msa", parentContractId: null, billingPath, regionId: region.id, signedAt, effectiveFrom, effectiveTo: effectiveTo ?? null, diagnosticDataRightsReserved: ddr, documentKey: null, state: "draft" };
    contracts.push(c);
    done.push("agreement (draft)");
  }
  const contract = c;
  for (const [p, v] of terms) {
    if (overrides.some((o) => o.contractId === contract.id && o.scopeTier === "parent" && o.termKey === p.key)) continue;
    let id = env.placeholder();
    if (!ctx.dry) {
      id = (await write(env, done, (g) => g.authorTermOverride({
        contractId: contract.id, scopeTier: "parent", scopeId: org.id, termKey: p.key, termValue: v,
        effectiveFrom: contract.effectiveFrom, ...(contract.effectiveTo ? { effectiveTo: contract.effectiveTo } : {}), orgId: org.id, regionId: contract.regionId,
      }))).id;
    }
    overrides.push({ id, contractId: contract.id, scopeTier: "parent", scopeId: org.id, termKey: p.key, termValue: v, effectiveFrom: contract.effectiveFrom, effectiveTo: contract.effectiveTo });
    done.push(p.key);
  }
  if (activate && contract.state === "draft") {
    if (!ctx.dry) await write(env, done, (g) => g.transitionContract({ contractId: contract.id, to: "active" }));
    contracts[contracts.indexOf(contract)] = { ...contract, state: "active" };
    done.push("activated");
  }
  if (!done.length) return { outcome: "skipped", what };
  return { outcome: done[0] === "agreement (draft)" ? "created" : "updated", what: `${what} — ${done.join(", ")}` };
};

const HANDLERS: Readonly<Record<FileKind, (env: Env, f: Fields) => Promise<Done>>> = { firms, crews, technicians, credentials, customers, agreements };
