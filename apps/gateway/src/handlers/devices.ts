import { refuseUnassigned } from "./regions.ts";
import type { UnitOfWork } from "../unit-of-work.ts";
import type { Tx } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";
import { iso } from "../sql.ts";
import type {
  DeviceKind, DeviceWire, ListDevicesInput, ListDevicesOutput, RegisterDeviceInput, RegisterDeviceOutput,
  GrantShiftInput, GrantShiftOutput, GrantWire, ListGrantsInput, ListGrantsOutput,
  ExtendShiftInput, ExtendShiftOutput, RevokeShiftInput, RevokeShiftOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * ITEM 4 — D-2a's PRIMITIVE: this device, this crew, this technician, this
 * window. `devices` and `device_grants` are read by `auth.deviceLogin` BEFORE
 * any principal exists — the same reason `users` and `sessions` carry no row-
 * level security. They join that class deliberately rather than by omission:
 * the only authenticated path that ever touches them is S2 (org-wide by
 * scope binding), so there is no live cross-region exposure today, and if S3
 * or S5 is ever admitted to a devices.* operation this is the file that gets
 * a region-isolation policy added beside it, in a migration, before the admission
 * does.
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
const requireIso = (v: unknown, field: string): Date => {
  if (typeof v !== "string") throw new BadInput(`${field} is required`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadInput(`${field} must be an ISO datetime`);
  return d;
};
const requireOneOf = <T extends string>(v: unknown, field: string, legal: readonly T[]): T => {
  if (typeof v !== "string" || !(legal as readonly string[]).includes(v)) throw new BadInput(`${field} must be one of ${legal.join(", ")}`);
  return v as T;
};

const DEVICE_KINDS: readonly DeviceKind[] = ["android_pilot", "yocto_tablet", "web_fallback"];

/** What the two writes below use of a unit of work. The logins app drives them through its own transaction (tools/logins-app/src/db.ts). */
export type DeviceWriter = Pick<UnitOfWork, "tx" | "apply">;

const activeRegion = async (uow: DeviceWriter, regionId: string): Promise<{ id: string; code: string; name: string }> => {
  refuseUnassigned(regionId);
  const r = (await uow.tx.query<{ id: string; code: string; name: string; active: boolean }>("SELECT id, code, name, active FROM regions WHERE id = $1", [regionId]))[0];
  if (!r) throw new InputRefused(`no service region ${regionId}`, "unknown_region");
  if (!r.active) throw new InputRefused(`service region ${r.name} (${r.code}) is not active`, "unknown_region");
  return r;
};

type DeviceRow = { id: string; hardware_id: string; kind: DeviceKind; firm_id: string | null; active: boolean; org_id: string; region_id: string };
const toWire = (d: DeviceRow): DeviceWire => ({ id: d.id, hardwareId: d.hardware_id, kind: d.kind, firmId: d.firm_id, active: d.active, orgId: d.org_id, regionId: d.region_id });

export const listDevices = async (uow: UnitOfWork, input: ListDevicesInput): Promise<ListDevicesOutput> => {
  const firmId = input.firmId === undefined ? null : requireUuid(input.firmId, "firmId");
  const rows = await uow.tx.query<DeviceRow>(
    `SELECT id, hardware_id, kind, firm_id, active, org_id, region_id FROM devices WHERE ($1::uuid IS NULL OR firm_id = $1) ORDER BY hardware_id`,
    [firmId],
  );
  return { devices: rows.map(toWire) };
};

export const registerDevice = async (uow: DeviceWriter, input: RegisterDeviceInput, newId: () => string): Promise<RegisterDeviceOutput> => {
  const hardwareId = requireText(input.hardwareId, "hardwareId");
  const kind = requireOneOf(input.kind, "kind", DEVICE_KINDS);
  // A web fallback is a browser: there is no device-held key to record, so none is asked for.
  const publicKey = kind === "web_fallback" && (input.publicKey === undefined || input.publicKey === "") ? "" : requireText(input.publicKey, "publicKey");
  const region = await activeRegion(uow, requireUuid(input.regionId, "regionId"));

  let firmId: string | null = null;
  let orgId: string = INTERNAL_ORG_ID;
  if (input.firmId !== undefined) {
    const firmUuid = requireUuid(input.firmId, "firmId");
    const firm = (await uow.tx.query<{ id: string; org_id: string; status: string; legal_name: string }>(
      `SELECT id, org_id, status, legal_name FROM subcontractor_firms WHERE id = $1`, [firmUuid],
    ))[0];
    if (!firm) throw new InputRefused(`no firm ${firmUuid} visible in this scope`, "unknown_firm");
    if (firm.status === "terminated") throw new InputRefused(`firm ${firm.legal_name} is terminated — hardware provisioned under it cannot be credentialed for a shift`, "firm_ended");
    firmId = firm.id;
    orgId = firm.org_id;
  }

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "device", entityId: id, action: "device.register", topic: "device.registered",
      before: null, after: { id, hardwareId, kind, firmId, regionId: region.id },
      orgId, regionId: region.id,
      payload: { hardwareId, kind, firmId, regionCode: region.code },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO devices (id, org_id, region_id, hardware_id, kind, public_key, firm_id, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [id, orgId, region.id, hardwareId, kind, Buffer.from(publicKey, "base64"), firmId],
      );
    },
  );
  return { id, orgId, regionId: region.id, eventId };
};

export const grantDeviceShift = async (uow: DeviceWriter, actorId: string, input: GrantShiftInput, newId: () => string): Promise<GrantShiftOutput> => {
  const deviceId = requireUuid(input.deviceId, "deviceId");
  const crewId = requireUuid(input.crewId, "crewId");
  const windowStart = requireIso(input.windowStart, "windowStart");
  const windowEnd = requireIso(input.windowEnd, "windowEnd");
  if (windowEnd.getTime() <= windowStart.getTime()) throw new InputRefused("windowEnd must be after windowStart — an empty shift grants nothing", "bad_window");

  const device = (await uow.tx.query<{ id: string; active: boolean }>(`SELECT id, active FROM devices WHERE id = $1`, [deviceId]))[0];
  if (!device) throw new InputRefused(`no device ${deviceId} visible in this scope`, "unknown_device");
  if (!device.active) throw new InputRefused(`device ${deviceId} is not active`, "device_inactive");

  const crew = (await uow.tx.query<{ id: string; active: boolean; org_id: string; home_region_id: string }>(
    `SELECT id, active, org_id, home_region_id FROM crews WHERE id = $1`, [crewId],
  ))[0];
  if (!crew) throw new InputRefused(`no crew ${crewId} visible in this scope`, "unknown_crew");
  if (!crew.active) throw new InputRefused(`crew ${crewId} is not active — a shift cannot be granted onto a crew nobody can dispatch`, "crew_inactive_for_grant");

  // No technician named: since 0024 a technician's unit is theirs alone, so
  // the unit's one active login is the person. None, or several on a shared
  // crew made before 0024, and the grant is refused rather than guessed.
  let technicianId: string;
  if (input.technicianId === undefined) {
    const members = await uow.tx.query<{ id: string }>(`SELECT id FROM users WHERE crew_id = $1 AND active`, [crewId]);
    if (members.length !== 1) {
      throw new InputRefused(members.length === 0
        ? `crew ${crewId} has no active technician login — add one before granting a shift`
        : `crew ${crewId} has ${members.length} active technician logins — name the technician`, "not_crew_member");
    }
    technicianId = members[0]!.id;
  } else {
    technicianId = requireUuid(input.technicianId, "technicianId");
  }

  // The technician must actually be on this crew. Checked here, not trusted
  // from the input — a grant is a claim about who is holding the hardware.
  const tech = (await uow.tx.query<{ id: string; crew_id: string | null }>(`SELECT id, crew_id FROM users WHERE id = $1 AND active`, [technicianId]))[0];
  if (!tech || tech.crew_id !== crewId) throw new InputRefused(`technician ${technicianId} is not an active member of crew ${crewId}`, "not_crew_member");

  // Handler-level guard, not a DB constraint (device_grants carries no EXCLUDE
  // constraint — see claude/19_S3_S5_Dispatch_and_Field.md): a device cannot
  // hold two live grants over the same window. Closes the common case; a
  // genuine race between two concurrent grantShift calls for the same device
  // is not closed by this alone, which is why it is named rather than assumed.
  const overlap = await uow.tx.query<{ id: string }>(
    `SELECT id FROM device_grants WHERE device_id = $1 AND revoked_at IS NULL AND service_window && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
    [deviceId, windowStart.toISOString(), windowEnd.toISOString()],
  );
  if (overlap.length > 0) throw new InputRefused(`device ${deviceId} already holds a live grant overlapping this window`, "grant_overlap");

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "device_grant", entityId: id, action: "device.grant_shift", topic: "device.shift_granted",
      before: null, after: { id, deviceId, crewId, technicianId, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() },
      orgId: crew.org_id, regionId: crew.home_region_id,
      payload: { deviceId, crewId, technicianId },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO device_grants (id, org_id, region_id, device_id, crew_id, technician_id, service_window, granted_by)
         VALUES ($1, $2, $3, $4, $5, $6, tstzrange($7::timestamptz, $8::timestamptz, '[)'), $9)`,
        [id, crew.org_id, crew.home_region_id, deviceId, crewId, technicianId, windowStart.toISOString(), windowEnd.toISOString(), actorId],
      );
    },
  );
  return { id, orgId: crew.org_id, regionId: crew.home_region_id, eventId };
};

/**
 * 0038 — a grant moved later, or ended now. Granted by any role S2 admits
 * (devices.grantShift has no writeRoles), so extended and revoked by the same.
 * Both act on a grant still live: one already revoked, or past its end, has
 * nothing left to move or end.
 */
type GrantRow = { id: string; device_id: string; org_id: string; region_id: string; revoked_at: string | null; ends_at: string; ended: boolean };

const liveGrant = async (uow: UnitOfWork, v: unknown): Promise<GrantRow> => {
  const id = requireUuid(v, "grantId");
  const g = (await uow.tx.query<GrantRow>(
    `SELECT id, device_id, org_id, region_id, revoked_at, ${iso("upper(service_window)")} AS ends_at, upper(service_window) <= now() AS ended
       FROM device_grants WHERE id = $1 FOR UPDATE`, [id]))[0];
  if (!g) throw new InputRefused(`no shift grant ${id} visible in this scope`, "unknown_grant");
  if (g.revoked_at) throw new InputRefused(`that shift was already ended at ${g.revoked_at}`, "grant_revoked");
  if (g.ended) throw new InputRefused(`that shift already ended at ${g.ends_at}`, "grant_ended");
  return g;
};

export const listGrants = async (uow: UnitOfWork, input: ListGrantsInput): Promise<ListGrantsOutput> => {
  const deviceId = input.deviceId === undefined || input.deviceId === "" ? null : requireUuid(input.deviceId, "deviceId");
  const rows = await uow.tx.query<{
    id: string; device_id: string; hardware_id: string; crew_id: string; crew_label: string; technician_id: string; technician_name: string;
    window_start: string; window_end: string; revoked_at: string | null; state: GrantWire["state"];
  }>(
    `SELECT g.id, g.device_id, d.hardware_id, g.crew_id, c.label AS crew_label, g.technician_id, u.display_name AS technician_name,
            ${iso("lower(g.service_window)")} AS window_start, ${iso("upper(g.service_window)")} AS window_end, ${iso("g.revoked_at")} AS revoked_at,
            CASE WHEN g.revoked_at IS NOT NULL THEN 'revoked'
                 WHEN upper(g.service_window) <= now() THEN 'ended'
                 WHEN lower(g.service_window) > now() THEN 'upcoming'
                 ELSE 'open' END AS state
       FROM device_grants g
       JOIN devices d ON d.id = g.device_id
       JOIN crews c ON c.id = g.crew_id
       JOIN users u ON u.id = g.technician_id
      WHERE ($1::uuid IS NULL OR g.device_id = $1)
        AND upper(g.service_window) > now() - interval '1 day'
        AND (g.revoked_at IS NULL OR g.revoked_at > now() - interval '1 day')
      ORDER BY lower(g.service_window) DESC
      LIMIT 200`,
    [deviceId],
  );
  return {
    grants: rows.map((r) => ({
      id: r.id, deviceId: r.device_id, hardwareId: r.hardware_id, crewId: r.crew_id, crewLabel: r.crew_label,
      technicianId: r.technician_id, technicianName: r.technician_name, windowStart: r.window_start, windowEnd: r.window_end,
      revokedAt: r.revoked_at, state: r.state,
    })),
  };
};

export const extendShift = async (uow: UnitOfWork, input: ExtendShiftInput): Promise<ExtendShiftOutput> => {
  const g = await liveGrant(uow, input.grantId);
  const windowEnd = requireIso(input.windowEnd, "windowEnd");
  if (windowEnd.getTime() <= new Date(g.ends_at).getTime()) throw new InputRefused(`the new end must be later than the shift's current end, ${g.ends_at}`, "bad_window");
  const overlap = await uow.tx.query(
    `SELECT 1 FROM device_grants WHERE device_id = $1 AND id <> $2 AND revoked_at IS NULL AND service_window && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
    [g.device_id, g.id, g.ends_at, windowEnd.toISOString()],
  );
  if (overlap.length > 0) throw new InputRefused("the device already holds a later grant inside the new end — end it there, or revoke that grant first", "grant_overlap");
  const eventId = await uow.apply(
    {
      entity: "device_grant", entityId: g.id, action: "device.extend_shift", topic: "device.shift_extended",
      before: { windowEnd: g.ends_at }, after: { windowEnd: windowEnd.toISOString() }, orgId: g.org_id, regionId: g.region_id,
      payload: { deviceId: g.device_id },
    },
    async (tx) => {
      await tx.query(`UPDATE device_grants SET service_window = tstzrange(lower(service_window), $2::timestamptz, '[)') WHERE id = $1`, [g.id, windowEnd.toISOString()]);
    },
  );
  return { id: g.id, windowEnd: windowEnd.toISOString(), eventId };
};

export const revokeShift = async (uow: UnitOfWork, input: RevokeShiftInput): Promise<RevokeShiftOutput> => {
  const g = await liveGrant(uow, input.grantId);
  let revokedAt = "";
  let endedSessions = 0;
  const eventId = await uow.apply(
    {
      entity: "device_grant", entityId: g.id, action: "device.revoke_shift", topic: "device.shift_revoked",
      before: { revokedAt: null }, after: { revoked: true }, orgId: g.org_id, regionId: g.region_id,
      payload: { deviceId: g.device_id },
    },
    async (tx) => {
      revokedAt = (await tx.query<{ at: string }>(`UPDATE device_grants SET revoked_at = now() WHERE id = $1 RETURNING ${iso("revoked_at")} AS at`, [g.id]))[0]!.at;
      // The session check already refuses a revoked grant's token; ending its sessions says so in the row.
      endedSessions = (await tx.query(
        `UPDATE sessions SET revoked_at = now() WHERE principal_kind = 'device_grant' AND principal_id = $1 AND revoked_at IS NULL RETURNING id`, [g.id])).length;
    },
  );
  return { id: g.id, revokedAt, endedSessions, eventId };
};

// ---------------------------------------------------------------------------
// auth.deviceLogin's own lookup — pre-authentication, unscoped, the same
// class as `login()`'s read of `users`. Kept beside the writes above because
// it reads the two tables this file owns; it is not a `UnitOfWork` function
// because there is no principal yet to open one for.
// ---------------------------------------------------------------------------
export type ResolvedDeviceLogin = {
  readonly technicianId: string; readonly crewId: string; readonly crewLabel: string;
  readonly orgId: string; readonly regionId: string; readonly deviceId: string; readonly grantId: string;
  /** The service window's upper bound — the token must not outlive the shift. */
  readonly shiftEndsAt: Date;
};

export const resolveDeviceLogin = async (
  tx: Tx, hardwareId: string, technicianId: string, now: Date,
): Promise<ResolvedDeviceLogin | null> => {
  const device = (await tx.query<{ id: string; active: boolean }>(`SELECT id, active FROM devices WHERE hardware_id = $1`, [hardwareId]))[0];
  if (!device || !device.active) return null;
  const grant = (await tx.query<{ id: string; crew_id: string; org_id: string; region_id: string; ends_at: string }>(
    `SELECT id, crew_id, org_id, region_id, ${iso("upper(service_window)")} AS ends_at
       FROM device_grants
      WHERE device_id = $1 AND technician_id = $2 AND revoked_at IS NULL AND service_window @> $3::timestamptz
      ORDER BY created_at DESC LIMIT 1`,
    [device.id, technicianId, now.toISOString()],
  ))[0];
  if (!grant) return null;
  // `crews` is behind row-level security, and the login transaction has no
  // scope bound yet — read unbound, the policy sees no namespace and returns
  // ZERO rows, so every device login was "invalid credentials" against a live
  // database while the scripted unit test passed (found by the wire suite,
  // test/integration/s3-s5.test.ts). The grant is the principal this login is
  // about to mint, so its own tenancy is bound here, before the first scoped
  // read, exactly as the unit of work binds it for every request after this one.
  await tx.setLocal({
    "ac.namespace": "device", "ac.org_id": grant.org_id, "ac.region_id": grant.region_id,
    "ac.scope_tier": "region", "ac.scope_id": grant.region_id,
    "ac.firm_id": "", "ac.device_id": device.id, "ac.actor_id": technicianId, "ac.surface_id": "S5",
  });
  const crew = (await tx.query<{ label: string; active: boolean }>(`SELECT label, active FROM crews WHERE id = $1`, [grant.crew_id]))[0];
  if (!crew || !crew.active) return null;
  return {
    technicianId, crewId: grant.crew_id, crewLabel: crew.label,
    orgId: grant.org_id, regionId: grant.region_id, deviceId: device.id, grantId: grant.id,
    shiftEndsAt: new Date(grant.ends_at),
  };
};
