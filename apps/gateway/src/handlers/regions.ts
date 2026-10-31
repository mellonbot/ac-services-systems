import { WriteRoleDenied, type UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { requireUuid } from "./jobs.ts";
import { mayManagePeople } from "./people.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../../../packages/schema/src/tenancy.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import type { SurfaceId } from "../../../../packages/contracts/src/surfaces.ts";
import {
  REGION_CODE,
  type CreateRegionInput, type CreateRegionOutput, type UpdateRegionInput, type UpdateRegionOutput,
  type SetRegionActiveInput, type SetRegionActiveOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * 0039 — OUR REGIONS, kept by a principal in S2's People area: the same
 * gate as People (S2 writeRoles region: [principal], checked here first).
 *
 *   - A CODE IS FOR GOOD. It is printed in every job number the region issues
 *     (0030), so a rename changes the name and nothing else.
 *   - UNASSIGNED IS STRUCTURAL. The home of anonymous principals and
 *     pre-account rows: it is never renamed, closed, or offered as a choice,
 *     and every door that takes a region refuses it (`refuseUnassigned`).
 *   - A REGION IS CLOSED EMPTY. Deactivation is refused while anything still
 *     lives in it — a login whose session could no longer resolve its region,
 *     a crew, a customer node, an open job — and the refusal names them.
 */
const NAME_MAX = 80;

/** The one sentence every region-taking door says about Unassigned. */
export const refuseUnassigned = (regionId: string): void => {
  if (regionId === UNASSIGNED_REGION_ID) {
    throw new InputRefused("Unassigned (pre-account) holds anonymous visitors and leads — it is not a region we serve from; choose one of ours", "unassigned_region");
  }
};

const requirePrincipal = (p: Principal, surfaceId: SurfaceId): void => {
  if (!mayManagePeople(p)) throw new WriteRoleDenied(surfaceId, "region", ["principal"], p.roles);
};
const requireName = (v: unknown): string => {
  if (typeof v !== "string") throw new BadInput("name is required");
  const name = v.replace(/\s+/g, " ").trim();
  if (!name) throw new InputRefused("a region's name cannot be blank", "blank_name");
  if (name.length > NAME_MAX) throw new InputRefused(`a region's name is at most ${NAME_MAX} characters`, "too_long");
  return name;
};
const requireTimezone = (v: unknown): string => {
  if (v === undefined) return "America/Chicago";
  if (typeof v !== "string" || !v.trim()) throw new BadInput("timezone must be an IANA zone, e.g. America/Chicago");
  try { new Intl.DateTimeFormat("en-US", { timeZone: v.trim() }); } catch {
    throw new InputRefused(`"${v}" is not a timezone — use an IANA zone such as America/Chicago`, "bad_timezone");
  }
  return v.trim();
};

type Row = { id: string; code: string; name: string; active: boolean };
const load = async (uow: UnitOfWork, v: unknown): Promise<Row> => {
  const id = requireUuid(v, "regionId");
  refuseUnassigned(id);
  const r = (await uow.tx.query<Row>("SELECT id, code, name, active FROM regions WHERE id = $1 FOR UPDATE", [id]))[0];
  if (!r) throw new InputRefused(`no service region ${id}`, "unknown_region");
  return r;
};

export const createRegion = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId, input: CreateRegionInput, newId: () => string): Promise<CreateRegionOutput> => {
  requirePrincipal(p, surfaceId);
  if (typeof input.code !== "string") throw new BadInput("code is required");
  const code = input.code.trim().toUpperCase();
  if (!REGION_CODE.test(code)) throw new InputRefused(`"${input.code}" is not a region code — 2 to 8 capitals and digits, starting with a letter (it goes into every job number)`, "bad_code");
  const name = requireName(input.name);
  const timezone = requireTimezone(input.timezone);
  const taken = (await uow.tx.query<{ name: string }>("SELECT name FROM regions WHERE code = $1", [code]))[0];
  if (taken) throw new InputRefused(`the code ${code} is already ${taken.name}'s`, "code_taken");
  const id = newId();
  const eventId = await uow.apply(
    { entity: "region", entityId: id, action: "region.create", topic: "region.created", before: null, after: { id, code, name, timezone, active: true }, orgId: INTERNAL_ORG_ID, regionId: id },
    async (tx) => { await tx.query("INSERT INTO regions (id, code, name, timezone) VALUES ($1, $2, $3, $4)", [id, code, name, timezone]); },
  );
  return { id, eventId };
};

export const updateRegion = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId, input: UpdateRegionInput): Promise<UpdateRegionOutput> => {
  requirePrincipal(p, surfaceId);
  const cur = await load(uow, input.regionId);
  const name = requireName(input.name);
  if (name === cur.name) throw new InputRefused("nothing changed", "no_change");
  const eventId = await uow.apply(
    { entity: "region", entityId: cur.id, action: "region.rename", topic: "region.updated", before: { name: cur.name }, after: { name }, orgId: INTERNAL_ORG_ID, regionId: cur.id },
    async (tx) => { await tx.query("UPDATE regions SET name = $2 WHERE id = $1", [cur.id, name]); },
  );
  return { id: cur.id, eventId };
};

/** What still lives in a region, by name: the first few of each kind and how many in all. */
const holders = async (uow: UnitOfWork, regionId: string): Promise<string[]> => {
  const kinds = await uow.tx.query<{ kind: string; n: number; names: string[] }>(
    `SELECT 'active login' AS kind, count(*)::int AS n, (array_agg(display_name ORDER BY display_name))[1:3] AS names
       FROM users WHERE region_id = $1 AND active
     UNION ALL
     SELECT 'active crew', count(*)::int, (array_agg(label ORDER BY label))[1:3]
       FROM crews WHERE (region_id = $1 OR home_region_id = $1) AND active
     UNION ALL
     SELECT 'customer', count(DISTINCT a.org_id)::int, (array_agg(DISTINCT o.name))[1:3]
       FROM accounts a JOIN organizations o ON o.id = a.org_id WHERE a.region_id = $1 AND a.active
     UNION ALL
     SELECT 'open job', count(*)::int, (array_agg(job_no ORDER BY job_no))[1:3]
       FROM jobs WHERE region_id = $1 AND state NOT IN ('cancelled', 'invoiced', 'aborted')`,
    [regionId]);
  return kinds.filter((k) => k.n > 0).map((k) => `${k.n} ${k.kind}${k.n === 1 ? "" : "s"} (${k.names.join(", ")}${k.n > k.names.length ? ", …" : ""})`);
};

export const setRegionActive = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId, input: SetRegionActiveInput): Promise<SetRegionActiveOutput> => {
  requirePrincipal(p, surfaceId);
  if (typeof input.active !== "boolean") throw new BadInput("active must be true or false");
  const cur = await load(uow, input.regionId);
  if (cur.active === input.active) throw new InputRefused(`${cur.name} (${cur.code}) is already ${cur.active ? "active" : "closed"}`, "no_change");
  if (!input.active) {
    const still = await holders(uow, cur.id);
    if (still.length > 0) {
      throw new InputRefused(`${cur.name} (${cur.code}) still holds ${still.join("; ")} — move or close them before closing the region`, "region_in_use");
    }
  }
  const eventId = await uow.apply(
    { entity: "region", entityId: cur.id, action: input.active ? "region.reopen" : "region.close", topic: "region.updated", before: { active: cur.active }, after: { active: input.active }, orgId: INTERNAL_ORG_ID, regionId: cur.id },
    async (tx) => { await tx.query("UPDATE regions SET active = $2 WHERE id = $1", [cur.id, input.active]); },
  );
  return { id: cur.id, active: input.active, eventId };
};
