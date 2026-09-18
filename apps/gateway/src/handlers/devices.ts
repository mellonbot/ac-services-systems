import type { UnitOfWork } from "../unit-of-work.ts";
import type { Tx } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";
import type {
  DeviceKind, DeviceWire, ListDevicesInput, ListDevicesOutput, RegisterDeviceInput, RegisterDeviceOutput,
  GrantShiftInput, GrantShiftOutput,
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

const activeRegion = async (uow: UnitOfWork, regionId: string): Promise<{ id: string; code: string; name: string }> => {
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

export const registerDevice = async (uow: UnitOfWork, input: RegisterDeviceInput, newId: () => string): Promise<RegisterDeviceOutput> => {
  const hardwareId = requireText(input.hardwareId, "hardwareId");
  const kind = requireOneOf(input.kind, "kind", DEVICE_KINDS);
  const publicKey = requireText(input.publicKey, "publicKey");
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

export const grantDeviceShift = async (uow: UnitOfWork, actorId: string, input: GrantShiftInput, newId: () => string): Promise<GrantShiftOutput> => {
  const deviceId = requireUuid(input.deviceId, "deviceId");
  const crewId = requireUuid(input.crewId, "crewId");
  const technicianId = requireUuid(input.technicianId, "technicianId");
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
    `SELECT id, crew_id, org_id, region_id, to_char(upper(service_window), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends_at
       FROM device_grants
      WHERE device_id = $1 AND technician_id = $2 AND revoked_at IS NULL AND service_window @> $3::timestamptz
      ORDER BY created_at DESC LIMIT 1`,
    [device.id, technicianId, now.toISOString()],
  ))[0];
  if (!grant) return null;
  const crew = (await tx.query<{ label: string; active: boolean }>(`SELECT label, active FROM crews WHERE id = $1`, [grant.crew_id]))[0];
  if (!crew || !crew.active) return null;
  return {
    technicianId, crewId: grant.crew_id, crewLabel: crew.label,
    orgId: grant.org_id, regionId: grant.region_id, deviceId: device.id, grantId: grant.id,
    shiftEndsAt: new Date(grant.ends_at),
  };
};
