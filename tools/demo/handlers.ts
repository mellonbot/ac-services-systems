/**
 * Demo operation handlers. Load fails if a catalogue id is neither implemented
 * nor named in UNIMPLEMENTED_DEMO_OPS, or if an implemented id is still listed.
 * A listed id stays the quiet 404 handle() already returned — a throwing stub
 * would show up in the activity log, and that answer would have changed.
 */
import {
  OFFICE_JOB_TRANSITIONS,
  FIELD_CLOSED_STATES,
  serviceOf,
  EMERGENCY_MULTIPLIER_DEFAULT,
  multiplierBp,
  multiplierOf,
  WORK_DONE_STATES,
  PHOTO_MAX_BYTES,
  PHOTOS_PER_REQUEST,
  sniffPhoto,
  AVATAR_MAX_BYTES,
  ACCOUNT_PASSWORD_MIN,
  STATUS_NOTE_MAX,
  STAFF_MESSAGE_MAX,
  STAFF_EVERYONE_GAP_SECONDS,
  mayReadTechnicianAddress,
  type OperationId,
  OPERATION_IDS,
} from "../../packages/contracts/src/operations.ts";
import type * as W from "../../packages/contracts/src/operations.ts";
import {
  SURFACES,
  type SurfaceId,
} from "../../packages/contracts/src/surfaces.ts";
import {
  type Principal,
} from "../../packages/contracts/src/scope.ts";
import {
  ANONYMOUS_PRINCIPAL_IDS,
} from "../../packages/contracts/src/scope.ts";
import {
  TERMS,
  TERM_KEYS,
} from "../../packages/contracts/src/terms.ts";
import {
  resolveAll,
} from "../../packages/domain/src/inheritance/resolve.ts";
import {
  admitOverride,
} from "../../packages/domain/src/inheritance/admit.ts";
import {
  evaluate,
  isRefusal,
} from "../../packages/domain/src/compliance/gate.ts";
import {
  ratedAmount,
} from "../../packages/domain/src/money/allocate.ts";
import {
  threeWayMatch,
} from "../../packages/domain/src/procurement/match.ts";
import {
  buildContext,
} from "../../services/gateway/src/context.ts";
import {
  INTERNAL_ORG_ID,
} from "../../packages/schema/src/tenancy.ts";
import {
  HQ_METRIC_KEYS,
  HQ_REFRESH_MINUTES,
  isHqMetricKey,
} from "../../packages/contracts/src/hq.ts";
import {
  REGION_SOUTH,
} from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import {
  DAY,
  day,
  today,
  uid,
  Refused,
  input422,
  type Assignment,
  type User,
  REGIONS,
  orgs,
  accounts,
  contracts,
  foremen,
  projects,
  overrides,
  firms,
  crews,
  technicians,
  techWire,
  credentials,
  rateCards,
  jobs,
  assignments,
  settlements,
  settlementLines,
  equipment,
  contacts,
  invoices,
  payments,
  serviceRequests,
  photoData,
  leads,
  callRecords,
  users,
  type Session,
  profileOf,
  accountOf,
  employee,
  type StaffRow,
  staffMessages,
  lastEveryone,
  staffWire,
  reader,
  publish,
  descendantsOf,
  ancestorsOf,
  visibleAccounts,
  siteVisibleToCustomer,
  visibleJobs,
  visibleCrews,
  liveAssignment,
  jobWire,
  crewWire,
  firmWire,
  accountWire,
  settlementWire,
  pathOf,
  need,
  bad,
  hqRegions,
  hqFigures,
  pastValue,
  vendorRows,
  receivingPointRows,
  itemRows,
  priceRows,
  type Po,
  poRows,
  shipmentRows,
  receiptRows,
  vinvRows,
  rmaRows,
  accepted,
  amount,
  vendorOf,
  seesPo,
  poWire,
  lineStats,
  findPo,
  digits,
} from "./model.ts";
import { replaySync } from "./sync.ts";

export type Ctx = { surface: SurfaceId; p: Principal; session: Session | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each handler names its own wire input type
type Handler = (input: any, ctx: Ctx) => unknown | Promise<unknown>;

const H: Partial<Record<OperationId, Handler>> = {
  // ---- S4: the HQ rollup, computed from this gateway's own rows at the moment of the read ----
  "hq.metrics": () => {
    const asOf = new Date().toISOString();
    const values: W.HqValueWire[] = [];
    for (const r of hqRegions()) { const f = hqFigures(r.id, Date.now()); for (const k of HQ_METRIC_KEYS) values.push({ regionId: r.id, metric: k, value: String(f[k]) }); }
    return { day: asOf.slice(0, 10), asOf, refreshMinutes: HQ_REFRESH_MINUTES, regions: hqRegions(), values };
  },
  "hq.history": (i: W.HqHistoryInput) => {
    if (!i.metric || !isHqMetricKey(i.metric)) throw bad("metric must be a key in the HQ register (packages/contracts/src/hq.ts)");
    const days = i.days === undefined ? 30 : Number(i.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw bad("days must be a whole number from 1 to 90");
    const points: W.HqHistoryPointWire[] = [];
    for (const r of hqRegions()) {
      const today = hqFigures(r.id, Date.now())[i.metric];
      for (let d = days - 1; d >= 0; d--) points.push({ day: day(-d), regionId: r.id, value: String(d === 0 ? today : pastValue(i.metric, r.id, today, d)) });
    }
    return { metric: i.metric, days, points };
  },
  "system.health": () => ({ ok: true, surfaces: Object.values(SURFACES).filter((s) => s.enabled).map((s) => s.id) }),
  // The demo's store is in memory, so it is always as ready as it is live.
  "system.ready": () => ({ ok: true, database: "reachable", storage: "not_configured" }),
  "session.me": async (_i, { p }) => buildContext(p, reader),
  // 0032 — the Account button, on the signed-in demo user's own record.
  "account.me": (_i, { session }) => accountOf(session!.user),
  "account.update": (i: W.UpdateMyAccountInput, { session }) => {
    const u = session!.user, a = profileOf(u);
    if (i.displayName !== undefined) { const n = i.displayName.replace(/\s+/g, " ").trim(); need(n, "your name cannot be blank", "blank_name"); u.name = n; }
    if (i.presence !== undefined) a.presence = i.presence;
    if (i.statusNote !== undefined) { need((i.statusNote ?? "").length <= STATUS_NOTE_MAX, `your status is at most ${STATUS_NOTE_MAX} characters`, "too_long"); a.statusNote = i.statusNote?.trim() || null; }
    return accountOf(u);
  },
  "account.setAvatar": (i: W.SetAvatarInput, { session }) => {
    const a = profileOf(session!.user);
    if (i.dataBase64 === null) a.avatar = null;
    else {
      const bytes = new Uint8Array(Buffer.from(i.dataBase64, "base64"));
      need(bytes.length <= AVATAR_MAX_BYTES, `a picture is at most ${AVATAR_MAX_BYTES / 1024} KB`, "avatar_too_large");
      const type = sniffPhoto(bytes);
      need(type === "image/jpeg" || type === "image/png", "that file is not a JPEG or PNG picture", "not_a_photo");
      a.avatar = { contentType: type as W.AvatarContentType, image: i.dataBase64 };
    }
    return accountOf(session!.user);
  },
  "account.changePassword": (i: W.ChangePasswordInput, { session }) => {
    const u = session!.user;
    need(i.currentPassword === u.password, "your current password is not right", "wrong_password");
    need(i.newPassword.length >= ACCOUNT_PASSWORD_MIN, `a new password is at least ${ACCOUNT_PASSWORD_MIN} characters`, "password_too_short");
    need(i.newPassword !== i.currentPassword, "the new password is the same as the current one", "password_unchanged");
    u.password = i.newPassword;
    profileOf(u).passwordChangedAt = new Date().toISOString();
    return { ok: true, passwordChangedAt: profileOf(u).passwordChangedAt!, endedSessions: 0 };
  },
  // 0035 — employees only. A customer, a vendor and a firm coordinator have no route here in the product either.
  "messages.directory": (_i, { session }) => {
    const me = session!.user;
    need(employee(me), "this sign-in is not an AC Services employee", "not_staff");
    return { people: users.filter((u) => employee(u) && u.id !== me.id).map((u) => ({ userId: u.id, displayName: u.name, presence: profileOf(u).presence, roles: u.principal.roles })) };
  },
  "messages.pending": (_i, { session }) => {
    const me = session!.user;
    need(employee(me), "this sign-in is not an AC Services employee", "not_staff");
    return { messages: staffMessages.filter((m) => m.recipients.has(me.id) && !m.dismissed.has(me.id)).map((m) => staffWire(m, me.id)) };
  },
  "messages.recent": (_i, { session }) => {
    const me = session!.user;
    need(employee(me), "this sign-in is not an AC Services employee", "not_staff");
    return { messages: staffMessages.filter((m) => m.senderId === me.id || m.recipients.has(me.id)).slice(-40).reverse().map((m) => staffWire(m, me.id)) };
  },
  "messages.send": (i: W.SendStaffMessageInput, { session }) => {
    const me = session!.user;
    need(employee(me), "this sign-in is not an AC Services employee", "not_staff");
    const body = String(i.body ?? "").trim();
    need(body.length > 0, "the message is empty", "blank_message");
    need(body.length <= STAFF_MESSAGE_MAX, `a message is at most ${STAFF_MESSAGE_MAX} characters`, "too_long");
    const everyone = i.everyone === true;
    const to = typeof i.toUserId === "string" && i.toUserId ? i.toUserId : "";
    if (everyone && to) throw bad("name one person, or everyone, not both");
    if (!everyone && !to) throw bad("name one person, or everyone");
    let recipients: User[];
    if (everyone) {
      const now = Date.now();
      need(now - (lastEveryone.get(me.id) ?? 0) >= STAFF_EVERYONE_GAP_SECONDS * 1000, "wait a moment before sending to everyone again", "everyone_too_soon");
      lastEveryone.set(me.id, now);
      recipients = users.filter((u) => employee(u) && u.id !== me.id);
    } else {
      need(to !== me.id, "you cannot message yourself", "not_yourself");
      const person = users.find((u) => u.id === to && employee(u));
      need(person, "that person is not an AC Services employee", "not_a_colleague");
      recipients = [person!];
    }
    const row: StaffRow = { id: uid("m"), senderId: me.id, audience: everyone ? "everyone" : "direct", recipientId: everyone ? null : recipients[0]!.id, body, at: new Date().toISOString(), recipients: new Set(recipients.map((u) => u.id)), dismissed: new Set() };
    staffMessages.push(row);
    return { messageId: row.id, sentAt: row.at, recipients: recipients.length };
  },
  "messages.dismiss": (i: W.DismissStaffMessageInput, { session }) => {
    const me = session!.user;
    need(employee(me), "this sign-in is not an AC Services employee", "not_staff");
    const row = staffMessages.find((m) => m.id === i.messageId && m.recipients.has(me.id));
    need(row, "that message was not sent to you", "not_yours");
    row!.dismissed.add(me.id);
    return { ok: true };
  },
  "brand.theme": () => ({ tenant: false, css: "", admission: null }),

  // ---- S1 ----
  "coverage.list": () => ({ metros: REGIONS.filter((r) => r.active).map((r) => ({ code: r.code, name: r.name })) }),
  "leads.submit": (i: W.SubmitLeadInput, { surface }) => {
    const name = (i.contact?.name ?? "").trim();
    need(name, "name is empty", "empty_name");
    const dup = leads.find((l) => l.submissionId === i.submissionId);
    if (dup) throw new Refused(422, "DuplicateRefused", "duplicate key value violates unique constraint \"leads_submission_id_key\"", "leads_submission_id_key");
    const id = uid("L");
    leads.push({ id, submissionId: i.submissionId, name, metro: i.requestedMetro ?? null, source: i.source, at: new Date().toISOString() });
    return { id, eventId: publish(surface, "lead.captured", "lead", id, ANONYMOUS_PRINCIPAL_IDS.org, ANONYMOUS_PRINCIPAL_IDS.region) };
  },
  "callRecords.record": (i: W.RecordCallInput, { surface }) => {
    const id = uid("R");
    callRecords.push({ id, leadId: i.leadId ?? null, at: i.occurredAt });
    return { id, eventId: publish(surface, "call_record.logged", "call_record", id, ANONYMOUS_PRINCIPAL_IDS.org, ANONYMOUS_PRINCIPAL_IDS.region) };
  },

  // ---- hierarchy ----
  "regions.list": () => ({ regions: REGIONS }),
  "organizations.list": (i: W.ListOrganizationsInput) => ({
    organizations: orgs.filter((o) => o.kind !== "internal" && (!i.kind || o.kind === i.kind)).map((o) => ({
      id: o.id, name: o.name, kind: o.kind as W.OrganizationKind, externalRef: o.externalRef, active: o.active,
      regionNodeCount: accounts.filter((a) => a.orgId === o.id && a.tier === "region").length,
    })),
  }),
  "organizations.create": (i: W.CreateOrganizationInput, { surface }) => {
    need(i.name?.trim(), "name is empty", "empty_name");
    need(REGIONS.some((r) => r.id === i.firstRegionNode?.regionId), `no service region ${i.firstRegionNode?.regionId}`, "unknown_region");
    const orgId = uid("o"), regionNodeId = uid("a");
    orgs.push({ id: orgId, name: i.name.trim(), kind: i.kind ?? "customer", externalRef: i.externalRef ?? null, active: true, createdAt: new Date().toISOString() });
    accounts.push({ id: regionNodeId, orgId, tier: "region", name: i.firstRegionNode.name, parentId: null, regionId: i.firstRegionNode.regionId, customerGroup: null, externalRef: null, timezone: null, active: true, address: null });
    return { orgId, regionNodeId, eventId: publish(surface, "account.created", "account", regionNodeId, orgId, i.firstRegionNode.regionId) };
  },
  "accounts.list": (i: W.ListAccountsInput, { p }) => {
    const orgId = p.namespace === "internal" ? i.orgId : p.orgId;
    return { nodes: visibleAccounts(p).filter((a) => a.orgId === orgId).map(accountWire) };
  },
  "accounts.create": (i: W.CreateAccountInput, { surface }) => {
    need(i.name?.trim(), "name is empty", "empty_name");
    let regionId: string;
    const caveats: string[] = [];
    if (i.tier === "region") {
      need(i.regionId && REGIONS.some((r) => r.id === i.regionId), "a region node binds to one of our regions — regionId is required", "unknown_region");
      regionId = i.regionId!;
    } else {
      const parent = accounts.find((a) => a.id === i.parentId && a.orgId === i.orgId);
      need(parent, `no parent node ${i.parentId} in this organization`, "unknown_parent");
      if (i.regionId) throw new Refused(422, "TriggerRefused", `region_id derives from the parent edge below a region node; "${i.regionId}" was supplied as an input`, "ac_accounts_derive_region");
      const legal: Record<string, string> = { location: "region", site: "location" };
      if (legal[i.tier] !== parent!.tier) throw new Refused(422, "TriggerRefused", `a ${i.tier} sits under a ${legal[i.tier]}, not a ${parent!.tier}`, "ac_accounts_tier_edge");
      regionId = parent!.regionId;
      if (i.tier === "location") {
        const r = REGIONS.find((x) => x.id === regionId)!;
        const have = crews.filter((c) => c.homeRegionId === regionId && c.active).length;
        if (have < r.minCrewDensity) caveats.push(`D14: ${r.name} fields ${have} active crews against a density rule of ${r.minCrewDensity}.`);
      }
    }
    const id = uid("a");
    accounts.push({ id, orgId: i.orgId, tier: i.tier, name: i.name.trim(), parentId: i.tier === "region" ? null : i.parentId!, regionId, customerGroup: i.customerGroup ?? null, externalRef: i.externalRef ?? null, timezone: i.timezone ?? null, active: true, address: (i.address as W.AddressWire | undefined) ?? null });
    return { id, regionId, eventId: publish(surface, "account.created", "account", id, i.orgId, regionId), caveats };
  },
  "accounts.move": (i: W.MoveAccountInput, { surface }) => {
    const node = accounts.find((a) => a.id === i.accountId);
    const parent = accounts.find((a) => a.id === i.newParentId);
    need(node && parent, "no such node", "unknown_node");
    need(parent!.orgId === node!.orgId, "a node moves within its own organization", "cross_org_move");
    need(!descendantsOf(node!.id).has(parent!.id), "a node cannot move under its own descendant", "cycle");
    const legal: Record<string, string> = { location: "region", site: "location" };
    if (legal[node!.tier] !== parent!.tier) throw new Refused(422, "TriggerRefused", `a ${node!.tier} sits under a ${legal[node!.tier]}, not a ${parent!.tier}`, "ac_accounts_tier_edge");
    node!.parentId = parent!.id;
    const moved = descendantsOf(node!.id);
    for (const a of accounts) if (moved.has(a.id)) a.regionId = parent!.regionId;
    return { id: node!.id, regionId: parent!.regionId, movedDescendants: moved.size - 1, eventId: publish(surface, "account.updated", "account", node!.id, node!.orgId, parent!.regionId) };
  },
  "accounts.update": (i: W.UpdateAccountInput, { surface }) => {
    const node = accounts.find((a) => a.id === i.accountId);
    need(node, `no node ${i.accountId}`, "unknown_node");
    Object.assign(node!, Object.fromEntries(Object.entries(i).filter(([k, v]) => k !== "accountId" && v !== undefined)));
    return { id: node!.id, eventId: publish(surface, "account.updated", "account", node!.id, node!.orgId, node!.regionId) };
  },

  // ---- site record (item 9) ----
  "equipment.list": (i: W.ListEquipmentInput, { p }) => {
    if (!visibleAccounts(p).some((a) => a.id === i.siteId)) return { equipment: [] };
    return {
      equipment: equipment.filter((e) => e.siteId === i.siteId).map((e) => {
        const done = jobs.filter((j) => j.equipmentIds.includes(e.id) && WORK_DONE_STATES.includes(j.state)).sort((a, b) => a.serviceWindowEnd.localeCompare(b.serviceWindowEnd)).at(-1);
        return { ...e, lastServicedAt: done?.serviceWindowEnd ?? null, lastServicedJobId: done?.id ?? null, lastServicedServiceCode: done?.serviceCode ?? null, jobCount: jobs.filter((j) => j.equipmentIds.includes(e.id)).length };
      }),
    };
  },
  "contacts.list": (i: W.ListContactsInput, { p }) => {
    const vis = new Set(visibleAccounts(p).map((a) => a.id));
    const up = ancestorsOf(i.accountId);
    return { contacts: contacts.filter((c) => up.has(c.accountId) && vis.has(c.accountId)) };
  },
  "payments.list": (i: W.ListPaymentsInput) => ({ payments: payments.filter((x) => x.invoiceId === i.invoiceId) }),
  "invoices.list": (i: W.ListInvoicesInput, { p }) => {
    // The office, asking for no node, reads every invoice — as the gateway's RLS lets it.
    if (!i.siteId && !i.locationId && p.namespace === "internal") return { invoices };
    const node = i.siteId ?? i.locationId ?? "";
    if (!visibleAccounts(p).some((a) => a.id === node)) return { invoices: [] };
    const nodeAcc = accounts.find((a) => a.id === node)!;
    const locationId = nodeAcc.tier === "site" ? nodeAcc.parentId : nodeAcc.id;
    const siteJobs = new Set(jobs.filter((j) => j.siteId === node).map((j) => j.id));
    return {
      invoices: invoices.map((inv) => {
        const lines = inv.lines.filter((l) => l.locationId === locationId && (nodeAcc.tier !== "site" || (l.jobId !== null && siteJobs.has(l.jobId))));
        return { ...inv, lines, subtotalMinor: String(lines.reduce((s, l) => s + Number(l.amountMinor), 0)) };
      }).filter((inv) => inv.lines.length > 0),
    };
  },
  "sites.imagery": (i: W.SiteImageryInput) => {
    const a = accounts.find((x) => x.id === i.siteId);
    return { siteId: i.siteId, lat: a?.address?.lat ?? null, lng: a?.address?.lng ?? null, image: null, attribution: null, unavailable: a?.address?.lat !== undefined ? "not_configured" : "no_coordinates" };
  },
  "sites.locate": (i: W.LocateSiteInput) => {
    const a = accounts.find((x) => x.id === i.siteId);
    const lat = a?.address?.lat, lng = a?.address?.lng;
    return lat !== undefined && lng !== undefined
      ? { siteId: i.siteId, lat, lng, outcome: "recorded" as const, eventId: null }
      : { siteId: i.siteId, lat: null, lng: null, outcome: "not_configured" as const, eventId: null };
  },
  "sites.mapTile": (i: W.SiteMapTileInput) => {
    const a = accounts.find((x) => x.id === i.siteId);
    return { z: Number(i.z), x: Number(i.x), y: Number(i.y), image: null, attribution: null, unavailable: a?.address?.lat !== undefined ? "not_configured" : "no_coordinates" };
  },

  // ---- 0024: projects ----
  "projects.list": (i: W.ListProjectsInput, { p }) => {
    need(p.namespace === "internal", "projects are the office's", "namespace");
    return { projects: projects.filter((x) => !i.orgId || x.orgId === i.orgId), foremen };
  },
  "projects.create": (i: W.CreateProjectInput, { surface }) => {
    const c = contracts.find((x) => x.id === i.contractId);
    need(c, `no agreement ${i.contractId} visible in this scope`, "unknown_contract");
    if (c!.state !== "active") throw input422(`agreement ${c!.id} is ${c!.state} — nothing is sold under an agreement that is not in force`, "contract_not_in_force");
    const f = foremen.find((x) => x.id === i.foremanId);
    need(f, "a project is sold by a foreman, and they stay on it as the person who sold it", "not_a_foreman");
    need(i.name?.trim(), "name is required", "empty_name");
    const id = uid("p");
    projects.unshift({ id, orgId: c!.orgId, regionId: c!.regionId, contractId: c!.id, customer: orgs.find((o) => o.id === c!.orgId)?.name ?? "", name: i.name.trim(),
      foremanId: f!.id, foremanName: f!.name, serviceWindowStart: i.serviceWindowStart, serviceWindowEnd: i.serviceWindowEnd, state: "planned", installJobs: 0 });
    return { id, orgId: c!.orgId, regionId: c!.regionId, eventId: publish(surface, "project.created", "project", id, c!.orgId, c!.regionId) };
  },

  // ---- agreements & terms ----
  "contracts.list": (i: W.ListContractsInput, { p }) => {
    const orgId = p.namespace === "internal" ? i.orgId : p.orgId;
    if (p.namespace !== "internal" && p.namespace !== "customer") return { contracts: [] };
    return { contracts: contracts.filter((c) => c.orgId === orgId && (!i.scopeId || c.scopeId === i.scopeId)).map((c) => { const { orgId, ...wire } = c; void orgId; return wire; }) };
  },
  "contracts.create": (i: W.CreateContractInput, { surface }) => {
    if (typeof i.diagnosticDataRightsReserved !== "boolean") throw bad("diagnosticDataRightsReserved is required — OQ5 has no default; state a position");
    if (i.kind === "amendment") {
      need(i.parentContractId, "an amendment names the MSA it amends", "amendment_needs_parent");
      const parent = contracts.find((c) => c.id === i.parentContractId);
      need(parent && parent.state !== "expired" && parent.state !== "terminated", "the named agreement has already ended", "amendment_parent_ended");
    }
    let regionId = i.regionId;
    if (i.scopeTier !== "parent") {
      const node = accounts.find((a) => a.id === i.scopeId && a.orgId === i.orgId);
      if (!node || node.tier !== i.scopeTier) throw new Refused(422, "TriggerRefused", `no ${i.scopeTier} ${i.scopeId} in this organization — an agreement is signed against a node that exists at the tier it names`, "ac_contract_scope_exists");
      regionId = node.regionId;
    }
    need(regionId, "a parent-scope agreement names the region that administers it", "region_required");
    const id = uid("c");
    contracts.push({ id, orgId: i.orgId, scopeTier: i.scopeTier, scopeId: i.scopeId, kind: i.kind, parentContractId: i.parentContractId ?? null, billingPath: i.billingPath, regionId: regionId!, signedAt: i.signedAt, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo ?? null, diagnosticDataRightsReserved: i.diagnosticDataRightsReserved, documentKey: i.documentKey ?? null, state: "draft" });
    return { id, regionId: regionId!, eventId: publish(surface, "contract.created", "contract", id, i.orgId, regionId!) };
  },
  "contracts.transition": (i: W.TransitionContractInput, { surface }) => {
    const c = contracts.find((x) => x.id === i.contractId);
    need(c, `no agreement ${i.contractId}`, "unknown_contract");
    const ladder: Record<string, string[]> = { draft: ["active"], active: ["expired", "terminated"] };
    need((ladder[c!.state] ?? []).includes(i.to), `${c!.state} → ${i.to} is not a step on the ladder (draft → active → expired | terminated)`, "off_ladder");
    c!.state = i.to;
    return { id: c!.id, state: c!.state, eventId: publish(surface, i.to === "active" ? "contract.amended" : "contract.expired", "contract", c!.id, c!.orgId, c!.regionId) };
  },
  "terms.register": () => ({ terms: Object.values(TERMS) }),
  "terms.overrides.list": (i: W.ListTermOverridesInput) => ({
    overrides: overrides.filter((o) => o.orgId === i.orgId && (!i.termKey || o.termKey === i.termKey) && (!i.contractId || o.contractId === i.contractId))
      .map((o) => ({ id: o.id, contractId: o.contractId, scopeTier: o.scopeTier, scopeId: o.scopeId, termKey: o.termKey, termValue: o.termValue, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo })),
  }),
  "terms.resolved": (i: W.ResolvedTermsInput, { p }) => {
    const orgId = p.namespace === "internal" ? (i.orgId ?? p.orgId) : p.orgId;
    const keys = i.termKeys ? i.termKeys.split(",").map((k) => k.trim()).filter(Boolean) : TERM_KEYS;
    for (const k of keys) need((TERM_KEYS as readonly string[]).includes(k), `"${k}" is not a registered term`, "unknown_term");
    const r = resolveAll(overrides.filter((o) => o.orgId === orgId), pathOf(orgId)(i.tier ?? "site", i.nodeId ?? ""), i.asOf ?? today(), keys);
    return { resolved: r.resolved, refused: Object.fromEntries(Object.entries(r.refused).map(([k, e]) => [k, { code: e.code, message: e.message }])) };
  },
  "terms.authorOverride": (i: W.AuthorOverrideInput, { surface }) => {
    const existing = overrides.filter((o) => o.orgId === i.orgId && o.termKey === i.termKey);
    admitOverride({ contractId: i.contractId, scopeTier: i.scopeTier, scopeId: i.scopeId, termKey: i.termKey, termValue: i.termValue, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo ?? null }, existing, pathOf(i.orgId));
    const id = uid("o");
    overrides.push({ id, contractId: i.contractId, scopeTier: i.scopeTier, scopeId: i.scopeId, termKey: i.termKey, termValue: i.termValue, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo ?? null, orgId: i.orgId, regionId: i.regionId });
    return { id, eventId: publish(surface, "contract.term_overridden", "contract", i.contractId, i.orgId, i.regionId) };
  },

  // ---- network ----
  "firms.list": (i: W.ListFirmsInput, { p }) => ({
    firms: firms.filter((f) => (p.namespace === "internal" || f.id === p.firmId) && (!i.status || f.status === i.status)).map(firmWire),
  }),
  "firms.create": (i: W.CreateFirmInput, { surface }) => {
    need(i.legalName?.trim(), "legal name is empty", "empty_legal_name");
    if (typeof i.diagnosticDataRightsReserved !== "boolean") throw bad("diagnosticDataRightsReserved is required — OQ5 has no default; state a position");
    need(REGIONS.some((r) => r.id === i.regionId), `no service region ${i.regionId}`, "unknown_region");
    const id = uid("f");
    orgs.push({ id, name: i.legalName.trim(), kind: "subcontractor", externalRef: i.externalRef ?? null, active: true });
    firms.push({ id, legalName: i.legalName.trim(), status: "onboarding", regionId: i.regionId, settlementTermsDays: i.settlementTermsDays, msaSignedAt: i.msaSignedAt ?? null, diagnosticDataRightsReserved: i.diagnosticDataRightsReserved, w9DocumentKey: i.w9DocumentKey ?? null });
    return { id, regionId: i.regionId, eventId: publish(surface, "firm.created", "subcontractor_firm", id, id, i.regionId) };
  },
  "firms.update": (i: W.UpdateFirmInput, { surface }) => {
    const f = firms.find((x) => x.id === i.firmId);
    need(f, `no firm ${i.firmId} visible in this scope`, "unknown_firm");
    if (i.legalName !== undefined) f!.legalName = i.legalName;
    if (i.settlementTermsDays !== undefined) f!.settlementTermsDays = i.settlementTermsDays;
    if (i.msaSignedAt !== undefined) f!.msaSignedAt = i.msaSignedAt;
    if (i.w9DocumentKey !== undefined) f!.w9DocumentKey = i.w9DocumentKey;
    if (i.status) {
      const ladder: Record<string, string[]> = { onboarding: ["active", "terminated"], active: ["suspended", "terminated"], suspended: ["active", "terminated"] };
      if (f!.status === "terminated") throw input422(`firm ${f!.legalName} is terminated — a terminated firm is not reinstated`, "firm_ended");
      need((ladder[f!.status] ?? []).includes(i.status), `${f!.status} → ${i.status} is not a step on the ladder`, "off_ladder");
      if (i.status === "active" && !f!.msaSignedAt) throw new Refused(422, "TriggerRefused", `firm ${f!.legalName} has no signed MSA — activation needs one`, "msa_unsigned");
      f!.status = i.status;
    }
    return { id: f!.id, status: f!.status, eventId: publish(surface, i.status ? "firm.status_changed" : "firm.updated", "subcontractor_firm", f!.id, f!.id, f!.regionId) };
  },
  "crews.list": (i: W.ListCrewsInput, { p }) => ({
    crews: visibleCrews(p).filter((c) => (!i.firmId || c.firmId === i.firmId) && (!i.regionId || c.homeRegionId === i.regionId)).map(crewWire),
  }),
  "crews.create": (i: W.CreateCrewInput, { surface }) => {
    need(i.label?.trim(), "label is empty", "empty_label");
    if (i.employmentType === "employed" && i.firmId) throw input422(`an employed crew is ours and names no firm — "${i.label}" declares firmId. Record it as subcontracted, or drop the firm.`, "firm_not_an_input");
    if (i.employmentType === "subcontracted" && !i.firmId) throw input422(`a subcontracted crew belongs to a firm — "${i.label}" names none. A crew with no employer is a crew nobody settles with.`, "firm_required");
    const firm = i.firmId ? firms.find((f) => f.id === i.firmId) : null;
    if (firm?.status === "terminated") throw input422(`firm ${firm.legalName} is terminated — a crew rostered under it is a crew nobody can dispatch`, "firm_ended");
    const id = uid("e");
    crews.push({ id, label: i.label.trim(), employmentType: i.employmentType, kind: i.kind ?? "service", firmId: i.firmId ?? null, homeRegionId: i.homeRegionId, active: true });
    return { id, regionId: i.homeRegionId, eventId: publish(surface, "crew.created", "crew", id, i.firmId ?? INTERNAL_ORG_ID, i.homeRegionId) };
  },
  "technicians.list": (i: W.ListTechniciansInput, { p }) => {
    need(p.namespace === "internal", "the technician roster is the office's", "namespace");
    return { technicians: technicians.filter((t) => !i.firmId || t.firmId === i.firmId).map((t) => techWire(t, p)) };
  },
  "technicians.record": (i: W.RecordTechnicianInput, { surface, p }) => {
    need(i.name?.trim(), "name is required", "empty_name");
    if (i.homeAddress && !mayReadTechnicianAddress(p.roles)) throw input422("home addresses are recorded and read by account owners and principals only — leave the address for one of them to enter", "address_restricted");
    const firm = i.firmId ? firms.find((f) => f.id === i.firmId) : null;
    if (i.firmId) need(firm, `no firm ${i.firmId} visible in this scope`, "unknown_firm");
    if (firm?.status === "terminated") throw input422(`firm ${firm.legalName} is terminated — it fields no technicians for us`, "firm_ended");
    if (i.crewId) need(crews.find((c) => c.id === i.crewId)?.firmId === (i.firmId ?? null), "put a technician on a crew of the employer they work for", "crew_employer_mismatch");
    const id = uid("t");
    technicians.push({ id, firmId: i.firmId ?? null, crewId: i.crewId ?? null, name: i.name.trim(), phone: i.phone?.trim() || null, homeAddress: i.homeAddress ?? null, role: i.role ?? "technician", specialties: [...new Set(i.specialties)], homeRegionId: i.homeRegionId, active: true });
    return { id, regionId: i.homeRegionId, eventId: publish(surface, "technician.recorded", "technician", id, i.firmId ?? INTERNAL_ORG_ID, i.homeRegionId) };
  },
  "technicians.update": (i: W.UpdateTechnicianInput, { surface, p }) => {
    const t = technicians.find((x) => x.id === i.technicianId);
    need(t, `no technician ${i.technicianId} visible in this scope`, "unknown_technician");
    if (i.homeAddress !== undefined && !mayReadTechnicianAddress(p.roles)) throw input422("home addresses are recorded and read by account owners and principals only", "address_restricted");
    if (i.crewId) need(crews.find((c) => c.id === i.crewId)?.firmId === t!.firmId, "put a technician on a crew of the employer they work for", "crew_employer_mismatch");
    Object.assign(t!, {
      ...(i.name !== undefined ? { name: i.name.trim() } : {}), ...(i.phone !== undefined ? { phone: i.phone.trim() || null } : {}),
      ...(i.specialties !== undefined ? { specialties: [...new Set(i.specialties)] } : {}), ...(i.crewId !== undefined ? { crewId: i.crewId } : {}),
      ...(i.role !== undefined ? { role: i.role } : {}),
      ...(i.active !== undefined ? { active: i.active } : {}), ...(i.homeAddress !== undefined ? { homeAddress: i.homeAddress } : {}),
    });
    return { id: t!.id, eventId: publish(surface, "technician.updated", "technician", t!.id, t!.firmId ?? INTERNAL_ORG_ID, t!.homeRegionId) };
  },
  "credentials.list": (i: W.ListCredentialsInput, { p }) => {
    const vis = new Set(visibleCrews(p).map((c) => c.id));
    const firmCrews = i.firmId ? new Set(crews.filter((c) => c.firmId === i.firmId).map((c) => c.id)) : null;
    return { credentials: credentials.filter((c) => vis.has(c.crewId) && (!i.crewId || c.crewId === i.crewId) && (!firmCrews || firmCrews.has(c.crewId))) };
  },
  "credentials.record": (i: W.RecordCredentialInput, { surface }) => recordCredential(i, surface),
  "credentials.submit": (i: W.SubmitCredentialInput, { surface, p }) => {
    const crew = crews.find((c) => c.id === i.crewId && c.firmId === p.firmId);
    need(crew, `no crew ${i.crewId} visible in this scope`, "unknown_crew");
    const out = recordCredential(i, surface);
    return { id: out.id, crewId: i.crewId, eventId: out.eventId };
  },
  "credentials.verify": (i: W.VerifyCredentialInput, { surface, p }) => {
    const c = credentials.find((x) => x.id === i.credentialId);
    need(c, `no credential ${i.credentialId} visible in this scope`, "unknown_credential");
    if (c!.verifiedAt) throw new Refused(422, "TriggerRefused", `${c!.kind} ${c!.identifier} was verified at ${c!.verifiedAt} — a verified document is immutable; a correction is a new document`, "ac_credential_verified_once");
    c!.verifiedAt = new Date().toISOString(); c!.verifiedBy = p.subjectId;
    const crew = crews.find((x) => x.id === c!.crewId)!;
    return { id: c!.id, verifiedAt: c!.verifiedAt, verifiedBy: c!.verifiedBy, eventId: publish(surface, "credential.verified", "crew_credential", c!.id, crew.firmId ?? INTERNAL_ORG_ID, crew.homeRegionId) };
  },
  "rateCards.list": (i: W.ListRateCardsInput, { p }) => {
    if (p.namespace === "subcontractor" && i.firmId !== p.firmId) return { rateCards: [] };
    return { rateCards: rateCards.filter((r) => r.firmId === i.firmId && (!i.serviceCode || r.serviceCode === i.serviceCode)) };
  },
  "rateCards.set": (i: W.SetRateCardInput, { surface }) => {
    need(/^\d+$/.test(i.rateMinor ?? ""), "rateMinor is integer minor units as a string of digits", "bad_money");
    need(serviceOf(i.serviceCode), `"${i.serviceCode}" is not a service we open jobs for`, "unknown_service_code");
    const firm = firms.find((f) => f.id === i.firmId);
    need(firm, `no firm ${i.firmId} visible in this scope`, "unknown_firm");
    const open = rateCards.find((r) => r.firmId === i.firmId && r.serviceCode === i.serviceCode && r.effectiveFrom <= i.effectiveFrom && (r.effectiveTo === null || r.effectiveTo > i.effectiveFrom));
    const later = rateCards.find((r) => r.firmId === i.firmId && r.serviceCode === i.serviceCode && r.effectiveFrom > i.effectiveFrom);
    if (later || (open && open.effectiveFrom === i.effectiveFrom)) throw new Refused(422, "OverlapRefused", `conflicting key value violates exclusion constraint "rate_cards_no_overlap" — ${i.serviceCode} already has a rate from ${(later ?? open)!.effectiveFrom}`, "rate_cards_no_overlap");
    if (open) open.effectiveTo = i.effectiveFrom;
    const id = uid("r");
    const bp = multiplierBp(i.emergencyMultiplier ?? EMERGENCY_MULTIPLIER_DEFAULT);
    need(bp !== null, "emergencyMultiplier is a decimal of at least 1 with at most two places", "bad_multiplier");
    rateCards.push({ id, firmId: i.firmId, serviceCode: i.serviceCode, rateMinor: i.rateMinor, currency: i.currency, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo ?? null,
      emergencyMultiplier: multiplierOf(bp!), emergencyRateMinor: ratedAmount(1000n, BigInt(i.rateMinor), BigInt(bp!)).toString() });
    return { id, closedId: open?.id ?? null, eventId: publish(surface, "rate_card.changed", "rate_card", id, i.firmId, firm!.regionId) };
  },

  // ---- S8, the firm's own writes ----
  "crews.enroll": (i: W.EnrollCrewInput, { surface, p }) => {
    need(i.label?.trim(), "label is empty", "empty_label");
    const firm = firms.find((f) => f.id === p.firmId)!;
    if (firm.status === "suspended" || firm.status === "terminated") throw input422(`firm ${firm.legalName} is ${firm.status} — a crew rostered under it is a crew nobody can dispatch.`, "firm_ended");
    const id = uid("e");
    crews.push({ id, label: i.label.trim(), employmentType: "subcontracted", kind: i.kind ?? "service", firmId: firm.id, homeRegionId: firm.regionId, active: true });
    return { id, firmId: firm.id, regionId: firm.regionId, eventId: publish(surface, "crew.created", "crew", id, firm.id, firm.regionId) };
  },
  "crews.retire": (i: W.RetireCrewInput, { surface, p }) => {
    const crew = crews.find((c) => c.id === i.crewId && c.firmId === p.firmId);
    need(crew, `no crew ${i.crewId} visible in this scope`, "unknown_crew");
    if (i.active === false) {
      const live = assignments.filter((a) => a.crewId === crew!.id && a.releasedAt === null && ["assigned", "en_route", "on_site", "in_progress"].includes(jobs.find((j) => j.id === a.jobId)?.state ?? ""));
      if (live.length) throw input422(`crew ${crew!.label} holds ${live.length} live assignment${live.length === 1 ? "" : "s"} — ask the office to release the work before retiring the crew`, "crew_assigned");
      crew!.active = false;
    }
    if (i.label) crew!.label = i.label;
    return { id: crew!.id, eventId: publish(surface, "crew.updated", "crew", crew!.id, crew!.firmId!, crew!.homeRegionId) };
  },
  "settlements.list": (i: W.ListSettlementsInput, { p }) => ({
    settlements: settlements.filter((s) => (p.namespace === "internal" || (s.firmId === p.firmId && s.state !== "draft")) && (!i.firmId || s.firmId === i.firmId) && (!i.state || s.state === i.state)).map(settlementWire),
  }),
  "settlements.lines": (i: W.ListSettlementLinesInput, { p }) => {
    const s = settlements.find((x) => x.id === i.settlementId && (p.namespace === "internal" || (x.firmId === p.firmId && x.state !== "draft")));
    need(s, `no statement ${i.settlementId} visible in this scope`, "unknown_settlement");
    return { settlementId: s!.id, lines: settlementLines.filter((l) => l.settlementId === s!.id) };
  },
  "settlements.acknowledge": (i: W.AcknowledgeSettlementInput, { surface, p }) => {
    const s = settlements.find((x) => x.id === i.settlementId && x.firmId === p.firmId && x.state !== "draft");
    need(s, `no statement ${i.settlementId} visible in this scope`, "unknown_settlement");
    if (s!.state === "acknowledged") throw input422(`statement for ${s!.periodFrom} → ${s!.periodTo} was acknowledged at ${s!.acknowledgedAt}`, "already_acknowledged");
    need(s!.state === "issued", `statement for ${s!.periodFrom} → ${s!.periodTo} is ${s!.state}; only an issued statement is acknowledged`, "not_issued");
    s!.state = "acknowledged"; s!.acknowledgedAt = new Date().toISOString();
    return { id: s!.id, state: "acknowledged", acknowledgedAt: s!.acknowledgedAt, eventId: publish(surface, "settlement.acknowledged", "settlement", s!.id, s!.firmId, s!.regionId) };
  },
  "settlements.dispute": (i: W.DisputeSettlementInput, { surface, p }) => {
    const s = settlements.find((x) => x.id === i.settlementId && x.firmId === p.firmId && x.state !== "draft");
    need(s, `no statement ${i.settlementId} visible in this scope`, "unknown_settlement");
    need((i.reason ?? "").trim(), "a dispute says why — reason is empty. Name the line, the rate or the quantity that is wrong.", "empty_reason");
    if (s!.state === "disputed") throw input422(`statement for ${s!.periodFrom} → ${s!.periodTo} is already in dispute since ${s!.disputedAt}: "${s!.disputeReason}". The office answers a dispute; a second one adds nothing.`, "already_disputed");
    need(s!.state === "issued" || s!.state === "acknowledged", `statement for ${s!.periodFrom} → ${s!.periodTo} is ${s!.state}; a firm disputes an issued or acknowledged statement`, "not_issued");
    s!.state = "disputed"; s!.disputedAt = new Date().toISOString(); s!.disputeReason = i.reason.trim();
    return { id: s!.id, state: "disputed", disputedAt: s!.disputedAt, eventId: publish(surface, "settlement.disputed", "settlement", s!.id, s!.firmId, s!.regionId) };
  },

  // ---- work ----
  "jobs.list": (i: W.ListJobsInput, { p, surface }) => ({ jobs: visibleJobs(p, surface).filter((j) => !i.state || j.state === i.state).map((j) => jobWire(j, p)) }),
  "serviceRequests.list": (i: W.ListServiceRequestsInput, { p, surface }) => ({
    requests: serviceRequests.filter((r) => {
      if (i.siteId && r.siteId !== i.siteId) return false;
      if (p.namespace === "customer") return siteVisibleToCustomer(p, r.siteId);
      if (surface === "S3") return r.regionId === p.regionId;
      return true;
    }).map((r) => ({ ...r, jobState: r.jobId ? jobs.find((j) => j.id === r.jobId)?.state ?? null : null })),
  }),
  "serviceRequests.create": (i: W.CreateServiceRequestInput, { p, session, surface }) => {
    const description = (i.description ?? "").trim();
    need(description, "a request says what is wrong — the description is empty", "empty_description");
    need(siteVisibleToCustomer(p, i.siteId), `no node ${i.siteId} visible in this scope`, "unknown_site");
    const site = accounts.find((a) => a.id === i.siteId)!;
    need(site.tier === "site", `"${i.siteId}" is a ${site.tier}, not a site — service is requested at a site, the tier equipment lives at`, "not_a_site");
    const id = uid("q");
    serviceRequests.unshift({ id, siteId: site.id, siteName: site.name, priority: i.priority ?? "routine", description, requestedBy: session?.user.name ?? "customer", createdAt: new Date().toISOString(), jobId: null, jobState: null, orgId: site.orgId, regionId: site.regionId, customerSegment: "commercial", photos: [], waitingOnTerm: null });
    return { id, orgId: site.orgId, regionId: site.regionId, eventId: publish(surface, "service_request.created", "service_request", id, site.orgId, site.regionId) };
  },
  // Photos live in this tab's memory as data: URLs — the demo has no bucket, and needs none.
  "serviceRequests.attachPhoto": (i: W.AttachPhotoInput, { p, session, surface }) => {
    const r = serviceRequests.find((x) => x.id === i.requestId && p.namespace === "customer" && siteVisibleToCustomer(p, x.siteId));
    need(r, `no request ${i.requestId} visible in this scope`, "unknown_request");
    need(r!.requestedBy === (session?.user.name ?? "customer"), "photos are added by the person who made the request", "not_your_request");
    need(!r!.jobId, "a job is open against this request — send further photos in the job's conversation", "job_open");
    need(r!.photos.length < PHOTOS_PER_REQUEST, `a request carries at most ${PHOTOS_PER_REQUEST} photos`, "too_many_photos");
    const bytes = Uint8Array.from(atob(i.dataBase64 ?? ""), (c) => c.charCodeAt(0));
    need(bytes.length <= PHOTO_MAX_BYTES, `a photo is at most ${PHOTO_MAX_BYTES / 1024 / 1024} MB`, "photo_too_large");
    const contentType = sniffPhoto(bytes);
    need(contentType, "that file is not a JPEG, PNG or HEIC photo", "not_a_photo");
    const id = uid("m");
    photoData.set(id, { contentType: contentType!, image: `data:${contentType};base64,${i.dataBase64}`, requestId: r!.id });
    r!.photos = [...r!.photos, { id, contentType: contentType!, bytes: bytes.length }];
    return { id, requestId: r!.id, contentType: contentType!, bytes: bytes.length, eventId: publish(surface, "service_request.photo_attached", "photo", id, r!.orgId, r!.regionId) };
  },
  "media.get": (i: W.GetMediaInput, { p }) => {
    const m = photoData.get(i.id);
    const r = m ? serviceRequests.find((x) => x.id === m.requestId) : undefined;
    need(m && r && (p.namespace !== "customer" || siteVisibleToCustomer(p, r.siteId)), `no photo ${i.id} visible in this scope`, "unknown_photo");
    return { id: i.id, contentType: m!.contentType, image: m!.image };
  },

  // ---- S3 ----
  "dispatch.candidates": (i: W.CandidateCrewsInput, { p }) => {
    const j = jobs.find((x) => x.id === i.jobId && x.regionId === p.regionId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const window = { start: Date.parse(j!.serviceWindowStart), end: Date.parse(j!.serviceWindowEnd) };
    return {
      jobId: j!.id,
      // Every demo job is service work (0024): only technicians' units are candidates.
      candidates: crews.filter((c) => c.homeRegionId === j!.regionId && c.active && c.kind === "service").map((c) => {
        const r = evaluate(c, credentials.filter((x) => x.crewId === c.id).map((x) => ({ id: x.id, kind: x.kind, validFrom: Date.parse(x.validFrom), validTo: Date.parse(x.validTo) + DAY - 1, verifiedAt: x.verifiedAt ? Date.parse(x.verifiedAt) : null })), window, Date.now());
        return { crewId: c.id, label: c.label, employmentType: c.employmentType, cleared: !isRefusal(r), refusal: isRefusal(r) ? { reason: r.reason, credentialKind: r.credentialKind, detail: r.detail.replace(c.id, c.label) } : null };
      }),
    };
  },
  "dispatch.assign": (i: W.AssignInput, { p, surface }) => {
    const j = jobs.find((x) => x.id === i.jobId && x.regionId === p.regionId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const c = crews.find((x) => x.id === i.crewId && x.homeRegionId === j!.regionId);
    need(c, `crew ${i.crewId} not found in scope`, "unknown_crew");
    if (c!.kind !== "service") throw input422(`job ${j!.id} is service work and ${c!.label} is an install crew — install work goes to an install crew; service and commissioning go to a technician`, "crew_kind_mismatch");
    const window = { start: Date.parse(j!.serviceWindowStart), end: Date.parse(j!.serviceWindowEnd) };
    const r = evaluate(c!, credentials.filter((x) => x.crewId === c!.id).map((x) => ({ id: x.id, kind: x.kind, validFrom: Date.parse(x.validFrom), validTo: Date.parse(x.validTo) + DAY - 1, verifiedAt: x.verifiedAt ? Date.parse(x.verifiedAt) : null })), window, Date.now());
    if (isRefusal(r)) {
      const eventId = publish(surface, "crew.compliance_refused", "job", j!.id, j!.orgId, j!.regionId);
      return { ok: false, refusal: { ok: false, reason: r.reason, credentialKind: r.credentialKind, detail: r.detail.replace(c!.id, c!.label) }, eventId };
    }
    const prev = liveAssignment(j!.id);
    if (prev) prev.releasedAt = new Date().toISOString();
    const a: Assignment = { id: uid("x"), jobId: j!.id, crewId: c!.id, assignedAt: new Date().toISOString(), releasedAt: null };
    assignments.push(a);
    j!.state = prev ? "reassigned" : "assigned"; j!.version++; j!.stateChangedAt = new Date().toISOString();
    if (j!.slaSatisfiedAt === null && j!.slaDueAt) j!.slaSatisfiedAt = new Date().toISOString();
    const req = serviceRequests.find((s) => s.jobId === j!.id);
    if (req) req.jobState = j!.state;
    return { ok: true, assignmentId: a.id, clearanceId: uid("cl"), eventId: publish(surface, "job.assigned", "job", j!.id, j!.orgId, j!.regionId) };
  },
  "dispatch.release": (i: W.ReleaseAssignmentInput, { surface }) => {
    const a = assignments.find((x) => x.id === i.assignmentId);
    need(a, `assignment ${i.assignmentId} not found in scope`, "unknown_assignment");
    if (a!.releasedAt) throw input422(`assignment ${i.assignmentId} was already released at ${a!.releasedAt}`, "already_released");
    const j = jobs.find((x) => x.id === a!.jobId)!;
    if (j.state !== "assigned" && j.state !== "reassigned") throw new Refused(422, "TriggerRefused", `job is ${j.state.replace("_", " ")} — field execution has begun; this is a cancellation or a reassignment, not a release`, "ac_release_before_start");
    a!.releasedAt = new Date().toISOString();
    j.state = "created"; j.version++; j.stateChangedAt = new Date().toISOString();
    return { jobId: j.id, eventId: publish(surface, "job.reassigned", "job", j.id, j.orgId, j.regionId) };
  },

  "jobs.transition": (i: W.TransitionJobInput, { surface }) => {
    const j = jobs.find((x) => x.id === i.jobId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const legal = OFFICE_JOB_TRANSITIONS[j!.state] ?? [];
    if (!legal.includes(i.to)) throw input422(`job ${i.jobId} is "${j!.state}" — the office may move it to ${legal.length ? legal.map((s) => `"${s}"`).join(" or ") : "nothing from here"}, not "${String(i.to)}"`, "illegal_transition");
    const crewOn = i.to === "cancelled" ? liveAssignment(j!.id) : null;
    if (crewOn) crewOn.releasedAt = new Date().toISOString();
    j!.state = i.to; j!.version++; j!.stateChangedAt = new Date().toISOString();
    return { jobId: j!.id, state: j!.state, version: j!.version, eventId: publish(surface, crewOn ? "job.cancelled" : "job.transitioned", "job", j!.id, j!.orgId, j!.regionId) };
  },

  "jobs.addNote": (i: W.AddJobNoteInput, { surface, session }) => {
    const j = jobs.find((x) => x.id === i.jobId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const body = String(i.body ?? "").trim();
    need(body && body.length <= 2000, "a note is 1 to 2000 characters", "bad_input");
    const id = uid("n");
    j!.notes.push({ id, body, kind: i.kind === "standing" ? "standing" : "note", at: new Date().toISOString(), authorName: session?.user.name ?? null });
    return { id, jobId: j!.id, eventId: publish(surface, "job.annotated", "job", j!.id, j!.orgId, j!.regionId) };
  },
  // 0016 — the job as dispatch reads it, and what the customer is told. A customer reads published updates only.
  "jobs.detail": (i: W.JobDetailInput, { p, surface }) => {
    const j = visibleJobs(p, surface).find((x) => x.id === i.jobId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const up = [...ancestorsOf(j!.siteId)];
    const contact = contacts.filter((c) => up.includes(c.accountId) && c.active)
      .sort((a, b) => up.indexOf(a.accountId) - up.indexOf(b.accountId) || Number(b.isPrimary) - Number(a.isPrimary))[0];
    return {
      job: jobWire(j!, p),
      contact: contact ? { name: contact.name, phone: contact.phone, email: contact.email } : null,
      visits: assignments.filter((a) => a.jobId === j!.id).map((a) => ({ id: a.id, crewId: a.crewId, crewLabel: crews.find((c) => c.id === a.crewId)?.label ?? null, assignedAt: a.assignedAt, releasedAt: a.releasedAt, workStart: null, workEnd: null })),
      media: [], notes: j!.notes, updates: j!.updates, messages: j!.messages,
    };
  },
  "jobs.conversation": (i: W.JobConversationInput, { p, surface }) => {
    const j = visibleJobs(p, surface).find((x) => x.id === i.jobId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    return { jobId: j!.id, updates: j!.updates.filter((u) => u.state === "published"), messages: j!.messages.map((m) => (m.authorKind === "office" ? { ...m, authorName: null } : m)) };
  },
  "jobs.saveUpdate": (i: W.SaveJobUpdateInput, { surface }) => {
    const j = jobs.find((x) => x.id === i.jobId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const body = String(i.body ?? "").trim();
    need(body && body.length <= 2000, "an update is 1 to 2000 characters", "bad_input");
    const now = new Date().toISOString();
    let u = i.updateId ? j!.updates.find((x) => x.id === i.updateId) : undefined;
    if (i.updateId) {
      need(u, `update ${i.updateId} is not a draft on job ${i.jobId}`, "unknown_update");
      need(u!.state === "draft", `update ${i.updateId} is already published to the customer`, "already_published");
      u!.body = body; u!.updatedAt = now;
    } else {
      u = { id: uid("u"), sourceNoteId: i.sourceNoteId ?? null, body, state: "draft", updatedAt: now, publishedAt: null, publishedByName: null };
      j!.updates.push(u);
    }
    return { id: u!.id, state: "draft", eventId: publish(surface, "job.annotated", "job", j!.id, j!.orgId, j!.regionId) };
  },
  "jobs.publishUpdate": (i: W.PublishJobUpdateInput, { surface, session }) => {
    const j = jobs.find((x) => x.updates.some((u) => u.id === i.updateId));
    need(j, `update ${i.updateId} not found in scope`, "unknown_update");
    const u = j!.updates.find((x) => x.id === i.updateId)!;
    need(u.state === "draft", `update ${i.updateId} is already published to the customer`, "already_published");
    u.state = "published"; u.publishedAt = new Date().toISOString(); u.updatedAt = u.publishedAt; u.publishedByName = session?.user.name ?? null;
    return { id: u.id, publishedAt: u.publishedAt, eventId: publish(surface, "job.update_published", "job", j!.id, j!.orgId, j!.regionId) };
  },
  "jobs.postMessage": (i: W.PostJobMessageInput, { p, surface, session }) => {
    const j = visibleJobs(p, surface).find((x) => x.id === i.jobId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const body = String(i.body ?? "").trim();
    need(body && body.length <= 2000, "a message is 1 to 2000 characters", "bad_input");
    const authorKind = p.namespace === "customer" ? "customer" : "office";
    const id = uid("m");
    j!.messages.push({ id, authorKind, authorName: session?.user.name ?? null, body, at: new Date().toISOString() });
    return { id, authorKind, eventId: publish(surface, "job.message_posted", "job", j!.id, j!.orgId, j!.regionId) };
  },
  "jobs.setReturnTrip": (i: W.SetReturnTripInput, { surface }) => {
    const j = jobs.find((x) => x.id === i.jobId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    j!.returnTrip = i.returnTrip === true;
    return { jobId: j!.id, returnTrip: j!.returnTrip, eventId: publish(surface, "job.annotated", "job", j!.id, j!.orgId, j!.regionId) };
  },

  // ---- S5 ----
  "jobs.mine": (_i, { session }) => {
    const crewId = session?.user.crewId;
    return {
      jobs: jobs.filter((j) => liveAssignment(j.id)?.crewId === crewId && !FIELD_CLOSED_STATES.includes(j.state))
        .map((j) => ({ id: j.id, siteId: j.siteId, serviceCode: j.serviceCode, priority: j.priority, state: j.state, serviceWindowStart: j.serviceWindowStart, serviceWindowEnd: j.serviceWindowEnd, version: j.version })),
    };
  },
  "sync.replay": (i: W.SyncReplayInput, { surface }) => ({ outcomes: replaySync(i.mutations, surface) }),
};

const proc: Partial<Record<OperationId, Handler>> = {
  "vendors.list": (_i, { p }) => ({ vendors: vendorRows.filter((v) => p.namespace === "internal" || v.id === vendorOf(p)) }),
  "vendors.create": (i: W.CreateVendorInput, { surface }) => {
    need((i.legalName ?? "").trim(), "legalName is required", "empty_legal_name");
    const id = uid("v"); const regionId = i.regionId;
    vendorRows.push({ id, legalName: i.legalName.trim(), status: "active", regionId, paymentTermsDays: i.paymentTermsDays ?? 30, contactEmail: i.contactEmail ?? null });
    orgs.push({ id, name: i.legalName.trim(), kind: "vendor", externalRef: null, active: true });
    return { id, eventId: publish(surface, "vendor.created", "vendor", id, id, regionId) };
  },
  "receivingPoints.list": (_i, { p }) => ({ receivingPoints: receivingPointRows.filter((r) => p.namespace === "internal" || poRows.some((po) => po.receivingPointId === r.id && seesPo(p, po))) }),
  "receivingPoints.create": (i: W.CreateReceivingPointInput, { surface }) => {
    need((i.code ?? "").trim(), "code is required", "empty_code");
    need(!receivingPointRows.some((r) => r.code === i.code.trim().toUpperCase()), `receiving point ${i.code} already exists`, "receiving_points_code_key");
    const id = uid("w"); receivingPointRows.push({ id, code: i.code.trim().toUpperCase(), tier: i.tier, regionId: i.regionId, address: i.address, active: true });
    return { id, eventId: publish(surface, "receiving_point.set", "receiving_point", id, INTERNAL_ORG_ID, i.regionId) };
  },
  "catalog.list": (i: W.ListCatalogInput, { p }) => ({
    items: itemRows.filter((it) => (p.namespace === "internal" || it.vendorId === vendorOf(p)) && (!i.vendorId || it.vendorId === i.vendorId)).map((it) => ({
      ...it, current: accepted(it.id) ?? null, proposals: priceRows.filter((x) => x.itemId === it.id && x.state === "proposed"),
    })),
  }),
  "catalog.addItem": (i: W.AddCatalogItemInput, { surface }) => {
    need((i.vendorSku ?? "").trim() && (i.description ?? "").trim(), "vendorSku and description are required", "empty_item");
    const id = uid("ci"); itemRows.push({ id, vendorId: i.vendorId, vendorSku: i.vendorSku.trim(), description: i.description.trim(), uom: i.uom ?? "each", active: true });
    return { id, eventId: publish(surface, "catalog_item.set", "part", id, i.vendorId, REGION_SOUTH) };
  },
  "prices.propose": (i: W.ProposePriceInput, { p, surface }) => {
    const it = itemRows.find((x) => x.id === i.itemId && x.vendorId === vendorOf(p)); need(it, `no catalogue item ${i.itemId} visible in this scope`, "unknown_item");
    const price = digits(i.priceMinor, "priceMinor");
    need(i.effectiveFrom >= day(0), `a price is proposed from today or later; ${i.effectiveFrom} has passed`, "backdated_price");
    const id = uid("cp"); priceRows.push({ id, itemId: it!.id, vendorId: it!.vendorId, priceMinor: price.toString(), currency: "USD", effectiveFrom: i.effectiveFrom, effectiveTo: null, state: "proposed", proposedAt: new Date().toISOString(), decidedAt: null, decisionNote: null });
    return { id, eventId: publish(surface, "vendor_price.proposed", "catalog_price", id, it!.vendorId, REGION_SOUTH) };
  },
  "prices.withdraw": (i: W.WithdrawPriceInput, { p, surface }) => {
    const x = priceRows.find((r) => r.id === i.priceId && r.vendorId === vendorOf(p)); need(x, `no price ${i.priceId} visible in this scope`, "unknown_price");
    need(x!.state === "proposed", `this price is ${x!.state}; only a proposal waiting on the office is withdrawn`, "not_proposed");
    x!.state = "withdrawn";
    return { id: x!.id, eventId: publish(surface, "vendor_price.withdrawn", "catalog_price", x!.id, x!.vendorId, REGION_SOUTH) };
  },
  "prices.decide": (i: W.DecidePriceInput, { surface }) => {
    const x = priceRows.find((r) => r.id === i.priceId); need(x, `no price ${i.priceId} visible in this scope`, "unknown_price");
    need(x!.state === "proposed", `this price is ${x!.state}; the office decides a proposal once`, "not_proposed");
    let closedId: string | null = null;
    if (i.decision === "accepted") {
      const open = priceRows.find((r) => r.itemId === x!.itemId && r.state === "accepted" && r.effectiveFrom <= x!.effectiveFrom && (r.effectiveTo === null || r.effectiveTo > x!.effectiveFrom));
      need(!open || open.effectiveFrom !== x!.effectiveFrom, `an accepted price already starts on ${x!.effectiveFrom}`, "price_same_day");
      if (open) { open.effectiveTo = x!.effectiveFrom; closedId = open.id; }
    }
    x!.state = i.decision; x!.decidedAt = new Date().toISOString(); x!.decisionNote = i.note ?? null;
    return { id: x!.id, state: x!.state, closedId, eventId: publish(surface, "vendor_price.decided", "price_decision", x!.id, x!.vendorId, REGION_SOUTH) };
  },
  "pos.list": (i: W.ListPurchaseOrdersInput, { p }) => ({ orders: poRows.filter((po) => seesPo(p, po) && (!i.state || po.state === i.state)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(poWire) }),
  "pos.detail": (i: W.PurchaseOrderDetailInput, { p }) => {
    const po = findPo(p, i.poId);
    return {
      order: poWire(po), receivingPoint: receivingPointRows.find((r) => r.id === po.receivingPointId) ?? null, lines: lineStats(po),
      shipments: shipmentRows.filter((s) => s.poId === po.id).map(({ poId: _p, ...s }) => { void _p; return s; }),
      receipts: receiptRows.filter((r) => r.poId === po.id).map(({ poId: _p, ...r }) => { void _p; return r; }),
      invoices: vinvRows.filter((v) => v.poId === po.id), returns: rmaRows.filter((r) => r.poId === po.id),
    };
  },
  "pos.create": (i: W.CreatePurchaseOrderInput, { surface }) => {
    const v = vendorRows.find((x) => x.id === i.vendorId); need(v, `no vendor ${i.vendorId}`, "unknown_vendor");
    const rp = receivingPointRows.find((r) => r.id === i.receivingPointId); need(rp, `no receiving point ${i.receivingPointId}`, "unknown_receiving_point");
    need(Array.isArray(i.lines) && i.lines.length > 0, "lines needs at least one line", "no_lines");
    const lines = i.lines.map((l, n) => {
      const it = itemRows.find((x) => x.id === l.itemId); need(it && it.vendorId === v!.id, `item ${l.itemId} is another vendor's — an order goes to one vendor`, "item_not_vendors");
      const price = accepted(it!.id); need(price, `${it!.vendorSku} has no accepted price today — accept the vendor's proposal first`, "no_accepted_price");
      return { id: uid("pl"), lineNo: n + 1, itemId: it!.id, quantityMilli: digits(l.quantityMilli, "quantityMilli", true).toString(), unitPriceMinor: price!.priceMinor };
    });
    const id = uid("po"); const total = lines.reduce((t, l) => t + amount(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor)), 0n);
    const po: Po = { id, number: `PO-${day(0).replace(/-/g, "")}-${4100 + poRows.length}`, vendorId: v!.id, receivingPointId: rp!.id, regionId: rp!.regionId, state: "draft", currency: "USD", totalMinor: total.toString(), issuedAt: null, acknowledgedAt: null, promisedShipOn: null, createdAt: new Date().toISOString(), lines };
    poRows.push(po);
    return { id, number: po.number, totalMinor: po.totalMinor, eventId: publish(surface, "po.created", "purchase_order", id, v!.id, rp!.regionId) };
  },
  "pos.issue": (i: W.PoIdInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(po.state === "draft", `order ${po.number} is ${po.state}; only a draft is issued`, "not_draft");
    po.state = "issued"; po.issuedAt = new Date().toISOString();
    return { id: po.id, state: po.state, eventId: publish(surface, "po.issued", "purchase_order", po.id, po.vendorId, po.regionId) };
  },
  "pos.cancel": (i: W.CancelPurchaseOrderInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(["draft", "issued", "acknowledged"].includes(po.state), `order ${po.number} is ${po.state} and cannot be cancelled`, "not_cancellable");
    need(!shipmentRows.some((s) => s.poId === po.id), `order ${po.number} has shipments recorded; receive it and return what is not wanted`, "already_shipped");
    po.state = "cancelled";
    return { id: po.id, state: po.state, eventId: publish(surface, "po.cancelled", "purchase_order", po.id, po.vendorId, po.regionId) };
  },
  "pos.acknowledge": (i: W.AcknowledgePurchaseOrderInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(po.state === "issued", `order ${po.number} is ${po.state}; an issued order is acknowledged, once`, "not_issued");
    need(i.promisedShipOn >= day(0), `a promised ship date is today or later; ${i.promisedShipOn} has passed`, "ship_date_passed");
    po.state = "acknowledged"; po.acknowledgedAt = new Date().toISOString(); po.promisedShipOn = i.promisedShipOn;
    return { id: po.id, state: po.state, eventId: publish(surface, "po.acknowledged", "po_ack", po.id, po.vendorId, po.regionId) };
  },
  "shipments.record": (i: W.RecordShipmentInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(po.state === "acknowledged", `order ${po.number} is ${po.state}; a shipment is recorded against an acknowledged order`, "not_acknowledged");
    need((i.carrier ?? "").trim(), "carrier is required", "empty_carrier");
    const stats = lineStats(po);
    for (const l of i.lines) {
      const st = stats.find((x) => x.id === l.poLineId); need(st, `line ${l.poLineId} is not on this purchase order`, "unknown_line");
      need(BigInt(st!.shippedMilli) + digits(l.quantityMilli, "quantityMilli", true) <= BigInt(st!.quantityMilli), `line ${st!.lineNo}: that would ship more than the ${st!.quantityMilli.slice(0, -3) || "0"} ordered`, "shipment_lines_within_order");
    }
    const id = uid("sh"); shipmentRows.push({ id, poId: po.id, shippedOn: i.shippedOn, carrier: i.carrier.trim(), tracking: i.tracking ?? null, lines: i.lines.map((l) => ({ poLineId: l.poLineId, quantityMilli: l.quantityMilli })) });
    return { id, eventId: publish(surface, "po.shipped", "ship_date", id, po.vendorId, po.regionId) };
  },
  "receipts.record": (i: W.RecordReceiptInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(po.state === "acknowledged", `order ${po.number} is ${po.state}; goods are received against an acknowledged order`, "not_acknowledged");
    const stats = lineStats(po); const ids: string[] = [];
    for (const l of i.lines) {
      const st = stats.find((x) => x.id === l.poLineId); need(st, `line ${l.poLineId} is not on this purchase order`, "unknown_line");
      need(BigInt(st!.receivedMilli) + digits(l.quantityMilli, "quantityMilli", true) <= BigInt(st!.quantityMilli), `line ${st!.lineNo}: that would receive more than was ordered`, "po_receipts_within_order");
    }
    for (const l of i.lines) { const id = uid("rc"); ids.push(id); receiptRows.push({ id, poId: po.id, poLineId: l.poLineId, quantityMilli: l.quantityMilli, receivedAt: new Date().toISOString() }); }
    if (lineStats(po).every((l) => BigInt(l.receivedMilli) >= BigInt(l.quantityMilli))) po.state = "received";
    return { ids, state: po.state, eventId: publish(surface, "po.received", "po_receipt", po.id, po.vendorId, po.regionId) };
  },
  "vendorInvoices.submit": (i: W.SubmitVendorInvoiceInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(["acknowledged", "received"].includes(po.state), `order ${po.number} is ${po.state}; an invoice is submitted against an acknowledged or received order`, "not_invoiceable");
    need((i.invoiceNumber ?? "").trim(), "invoiceNumber is required", "empty_invoice_number");
    need(!vinvRows.some((v) => v.vendorId === po.vendorId && v.invoiceNumber === i.invoiceNumber.trim()), `invoice ${i.invoiceNumber} was already submitted`, "vendor_invoices_vendor_id_invoice_number_key");
    const stats = lineStats(po);
    const lines = i.lines.map((l) => ({ poLineId: l.poLineId, quantityMilli: digits(l.quantityMilli, "quantityMilli", true), unitPriceMinor: digits(l.unitPriceMinor, "unitPriceMinor") }));
    for (const l of lines) need(stats.some((s) => s.id === l.poLineId), `line ${l.poLineId} is not on order ${po.number}`, "unknown_line");
    const verdict = threeWayMatch(stats.map((s) => ({ poLineId: s.id, lineNo: s.lineNo, unitPriceMinor: BigInt(s.unitPriceMinor), receivedMilli: BigInt(s.receivedMilli), invoicedMilli: BigInt(s.invoicedMilli) })), lines);
    const wl = lines.map((l) => ({ poLineId: l.poLineId, quantityMilli: l.quantityMilli.toString(), unitPriceMinor: l.unitPriceMinor.toString(), amountMinor: amount(l.quantityMilli, l.unitPriceMinor).toString() }));
    const total = wl.reduce((t, l) => t + BigInt(l.amountMinor), 0n).toString();
    const id = uid("vi");
    vinvRows.unshift({ id, poId: po.id, poNumber: po.number, vendorId: po.vendorId, invoiceNumber: i.invoiceNumber.trim(), invoiceDate: i.invoiceDate, totalMinor: total, currency: "USD", matchState: verdict.state, matchNotes: [...verdict.notes], createdAt: new Date().toISOString(), lines: wl });
    return { id, matchState: verdict.state, matchNotes: verdict.notes, totalMinor: total, eventId: publish(surface, "vendor_invoice.submitted", "vendor_invoice", id, po.vendorId, po.regionId) };
  },
  "vendorInvoices.list": (i: W.ListVendorInvoicesInput, { p }) => ({ invoices: vinvRows.filter((v) => (p.namespace === "internal" || v.vendorId === vendorOf(p)) && (!i.poId || v.poId === i.poId)) }),
  "rmas.request": (i: W.RequestReturnInput, { p, surface }) => {
    const po = findPo(p, i.poId); const st = lineStats(po).find((l) => l.id === i.poLineId); need(st, `line ${i.poLineId} is not on order ${po.number}`, "unknown_line");
    need((i.reason ?? "").trim(), "reason is required", "empty_reason");
    need(BigInt(st!.returnedMilli) + digits(i.quantityMilli, "quantityMilli", true) <= BigInt(st!.receivedMilli), `line ${st!.lineNo}: more than was received`, "rmas_within_order");
    const id = uid("rm"); rmaRows.unshift({ id, poId: po.id, poNumber: po.number, poLineId: i.poLineId, vendorId: po.vendorId, quantityMilli: i.quantityMilli, reason: i.reason.trim(), state: "requested", rmaNumber: null, vendorNote: null, createdAt: new Date().toISOString(), respondedAt: null });
    return { id, eventId: publish(surface, "rma.requested", "rma_request", id, po.vendorId, po.regionId) };
  },
  "rmas.respond": (i: W.RespondToReturnInput, { p, surface }) => {
    const r = rmaRows.find((x) => x.id === i.rmaId && x.vendorId === vendorOf(p)); need(r, `no return ${i.rmaId} visible in this scope`, "unknown_rma");
    need(r!.state === "requested", `this return is already ${r!.state}; a vendor answers a request once`, "already_answered");
    if (i.decision === "authorized") need((i.rmaNumber ?? "").trim(), "an authorized return carries your RMA number", "rma_number_required");
    else need((i.note ?? "").trim(), "a rejected return says why", "note_required");
    r!.state = i.decision; r!.rmaNumber = i.decision === "authorized" ? i.rmaNumber!.trim() : null; r!.vendorNote = i.note?.trim() || null; r!.respondedAt = new Date().toISOString();
    return { id: r!.id, state: r!.state, eventId: publish(surface, "rma.responded", "rma", r!.id, r!.vendorId, REGION_SOUTH) };
  },
  "rmas.list": (i: W.ListReturnsInput, { p }) => ({ returns: rmaRows.filter((r) => (p.namespace === "internal" || r.vendorId === vendorOf(p)) && (!i.poId || r.poId === i.poId)) }),
};
Object.assign(H, proc);

const recordCredential = (i: W.RecordCredentialInput, surface: SurfaceId) => {
  need((i.identifier ?? "").trim(), "identifier is empty", "empty_identifier");
  need(i.validFrom && i.validTo && i.validFrom <= i.validTo, `${i.kind} ${i.identifier} is valid from ${i.validFrom} to ${i.validTo} — a window that ends before it starts covers no day at all`, "empty_window");
  const crew = crews.find((c) => c.id === i.crewId);
  need(crew, `no crew ${i.crewId} visible in this scope`, "unknown_crew");
  const id = uid("d");
  credentials.push({ id, crewId: i.crewId, kind: i.kind, identifier: i.identifier.trim(), validFrom: i.validFrom, validTo: i.validTo, documentKey: i.documentKey ?? null, verifiedAt: null, verifiedBy: null });
  return { id, eventId: publish(surface, "credential.recorded", "crew_credential", id, crew!.firmId ?? INTERNAL_ORG_ID, crew!.homeRegionId) };
};

/**
 * Ids the demo does not imitate. A catalogue id must be here or in the table above.
 * Listed ids stay a quiet 404 from handle() — the same answer as before the split.
 */
const UNIMPLEMENTED_DEMO_OPS = [
  "customers.createResidential",
  "leads.list",
  "leads.convert",
  "equipment.register",
  "contacts.set",
  "invoices.void",
  "payments.record",
  "payments.webhook",
  "payments.return",
  "crews.update",
  "settlements.issue",
  "jobs.create",
  "sites.list",
  "serviceRequests.openJob",
  "serviceRequests.hold",
  "manager.overview",
  "devices.list",
  "devices.register",
  "devices.grantShift",
  "punches.mine",
  "jobs.attachMedia",
  "jobs.wrapUp",
  "events.stream",
  "brand.setTheme",
] as const satisfies readonly OperationId[];

/** auth.* is answered in gateway.ts handle(), before this table is consulted. */
const WIRE_HANDLED = ["auth.login", "auth.logout", "auth.deviceLogin", "auth.anonymousSession"] as const satisfies readonly OperationId[];

{
  const table = new Set(Object.keys(H));
  const allowed = new Set<string>(UNIMPLEMENTED_DEMO_OPS);
  const catalogue = new Set<string>(OPERATION_IDS);
  for (const id of WIRE_HANDLED) {
    if (table.has(id)) throw new Error(`demo gateway: ${id} is both a table handler and a wire special case`);
  }
  const implemented = new Set([...table, ...WIRE_HANDLED]);
  for (const id of implemented) {
    if (!catalogue.has(id)) throw new Error(`demo gateway: handler "${id}" is not a catalogue operation`);
    if (allowed.has(id)) throw new Error(`demo gateway: ${id} is implemented and still listed as unimplemented`);
  }
  for (const id of OPERATION_IDS) {
    if (!implemented.has(id) && !allowed.has(id)) throw new Error(`demo gateway: ${id} has no handler and is not on the unimplemented allowlist`);
  }
}

export { H as handlers };

