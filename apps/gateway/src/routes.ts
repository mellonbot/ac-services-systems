import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { beginTx, bindSystem, hierarchyReader } from "./pg-tx.ts";
import { AuthError } from "./auth.ts";
import { buildContext, scopeBinding } from "./context.ts";
import { createUnitOfWork } from "./unit-of-work.ts";
import { login, deviceLogin, anonymousSession } from "./auth-routes.ts";
import { assertSessionLive, callerOf, openSelf, openTx, surfaceOf } from "./open-tx.ts";
import { clearedCookie } from "./session.ts";
import { HttpError } from "./http.ts";
import { namedOrg, optionalOrg, withCallerOrg } from "./policy.ts";
import {
  ANONYMOUS_ACTOR, BEHIND_CLOUDFLARE, GEOCODE, IMAGERY, MAP_TILES, SESSION, STORE, pool, signInAllowed, signInFailed,
} from "./env.ts";
import { SSE_STREAMS_PER_SESSION, SSE_SESSION_RECHECK_MS, STREAMING, sseClients, type SseClient } from "./sse.ts";
import { authorTermOverride, resolvedTermsAt } from "./handlers/terms.ts";
import { assignCrew, candidateCrews, releaseAssignment } from "./handlers/assignment.ts";
import { listRegions, listOrganizations, createOrganization, listAccounts, listSites, createAccount, moveAccount, updateAccount } from "./handlers/hierarchy.ts";
import { listContracts, createContract, transitionContract, listTermOverrides, termRegister } from "./handlers/contracts.ts";
import { listTechnicians, recordTechnician, updateTechnician } from "./handlers/technicians.ts";
import { listFirms, createFirm, updateFirm, listCrews, createCrew, updateCrew, listCredentials, recordCredential, verifyCredential, listRateCards, setRateCard, enrollCrew, retireCrew, submitCredential } from "./handlers/network.ts";
import { listSettlements, listSettlementLines, issueSettlement, acknowledgeSettlement, disputeSettlement } from "./handlers/settlements.ts";
import { ingestSync } from "./handlers/sync.ts";
import { setBrandTheme, brandStylesheetFor } from "./handlers/brand.ts";
import { readMyAccount, updateMyAccount, setMyAvatar, changeMyPassword } from "./handlers/account.ts";
import { listColleagues, listPending, listRecent, sendStaffMessage, dismissStaffMessage } from "./handlers/messages.ts";
import { createJob, listJobs, listMyJobs, listMyPunches, transitionJob, addJobNote, setReturnTrip, requireUuid } from "./handlers/jobs.ts";
import { createProject, listProjects } from "./handlers/projects.ts";
import { jobDetail, jobConversation, saveJobUpdate, publishJobUpdate, postJobMessage } from "./handlers/job-detail.ts";
import { listDevices, registerDevice, grantDeviceShift } from "./handlers/devices.ts";
import { createServiceRequest, listServiceRequests, openJobFromRequest } from "./handlers/service-requests.ts";
import { attachPhoto, getMedia } from "./handlers/photos.ts";
import { attachJobMedia, wrapUpJob } from "./handlers/wrap-up.ts";
import { createResidential, listLeads, convertLead } from "./handlers/residential.ts";
import { submitLead, recordCall, listCoverage } from "./handlers/leads.ts";
import { listEquipment, registerEquipment, listContacts, setContact, listInvoices } from "./handlers/site-record.ts";
import { listPayments, recordPayment, returnPayment, voidInvoice, paymentWebhook } from "./handlers/payments.ts";
import { siteImageryRead, siteMapTileRead, locateSiteRead, geocode, locateSiteWrite, runPlan } from "./handlers/imagery.ts";
import { hqMetrics, hqHistory } from "./handlers/hq.ts";
import { managerOverview } from "./handlers/manager.ts";
import {
  listVendors, createVendor, listReceivingPoints, createReceivingPoint, listCatalog, addCatalogItem, proposePrice, withdrawPrice, decidePrice,
  listPurchaseOrders, purchaseOrder, createPurchaseOrder, issuePurchaseOrder, cancelPurchaseOrder, acknowledgePurchaseOrder,
  recordShipment, recordReceipt, submitVendorInvoice, listVendorInvoices, requestReturn, respondToReturn, listReturns,
} from "./handlers/procurement.ts";
import { SURFACES } from "../../../packages/contracts/src/surfaces.ts";
import { seesManagerOverview, type OperationId, type OperationIO } from "../../../packages/contracts/src/operations.ts";
import type { Principal } from "../../../packages/contracts/src/scope.ts";
import { PROSPECT_ORG_ID, UNASSIGNED_REGION_ID } from "../../../packages/schema/src/tenancy.ts";

/**
 * THE ROUTE TABLE. One handler per catalogue id. `tools/ci/schema-guard.ts`
 * reads this object as text, so the keys stay string literals and the binding
 * stays `const handlers`.
 */

type Handler<K extends OperationId> = (req: IncomingMessage, input: OperationIO[K]["input"], res: ServerResponse) => Promise<unknown>;
type Unit = Awaited<ReturnType<typeof createUnitOfWork>>;

/** A shift grant is required. The refusal names the operation, as each route used to. */
const onShift = <K extends OperationId>(
  opId: K,
  mode: "read" | "uow",
  fn: (uow: Unit, p: Principal & { readonly shiftId: string }, input: OperationIO[K]["input"]) => Promise<unknown>,
) => (req: IncomingMessage, input: OperationIO[K]["input"]) => openTx(req, opId, mode, (uow, p) => {
  const shiftId = p.shiftId;
  if (!shiftId) throw new HttpError(403, `${opId} is a device principal's operation`);
  return fn(uow, { ...p, shiftId }, input);
});

/** sync.replay: a device and a shift, and the refusal still says "sync". */
const onDevice = <K extends OperationId>(
  opId: K,
  label: string,
  fn: (uow: Unit, p: Principal & { readonly shiftId: string; readonly deviceId: string }, input: OperationIO[K]["input"]) => Promise<unknown>,
) => (req: IncomingMessage, input: OperationIO[K]["input"]) => openTx(req, opId, "uow", (uow, p) => {
  const deviceId = p.deviceId;
  const shiftId = p.shiftId;
  if (!deviceId || !shiftId) throw new HttpError(403, `${label} is a device principal's operation`);
  return fn(uow, { ...p, deviceId, shiftId }, input);
});

/** serviceRequests.hold is createServiceRequest. The operation id still selects the surface. */
const createOrHold = <K extends "serviceRequests.create" | "serviceRequests.hold">(opId: K): Handler<K> =>
  (req, input) => openTx(req, opId, "uow", (uow, p) => createServiceRequest(uow, p.subjectId, input, randomUUID));


export const handlers: { readonly [K in OperationId]: Handler<K> } = {
  "auth.login": (req, input, res) => login(req, input, res),
  "auth.deviceLogin": (req, input, res) => deviceLogin(req, input, res),

  // Ending a session is the one mutation outside the unit of work: it writes the
  // sessions row, which belongs to the gateway, not to any surface's allowlist.
  "auth.logout": async (req, _input, res) => {
    const caller = callerOf(req);
    surfaceOf(req, "auth.logout", caller);
    const tx = await beginTx(pool, "ac_gateway");
    try {
      await assertSessionLive(tx, caller.principal);
      await tx.query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [caller.principal.sessionId]);
      await tx.commit();
    } catch (e) { await tx.rollback().catch(() => {}); throw e; }
    res.setHeader("set-cookie", clearedCookie(SESSION));
    return { ok: true, sessionId: caller.principal.sessionId };
  },

  "session.me": (req) => openTx(req, "session.me", "read", (uow, p) => buildContext(p, hierarchyReader(uow.tx))),

  // 0032 — the Account button: the caller's own picture, status and password.
  "account.me": (req) => openSelf(req, "account.me", false, readMyAccount),
  "account.update": (req, input) => openSelf(req, "account.update", true, (tx, a) => updateMyAccount(tx, a, input)),
  "account.setAvatar": (req, input) => openSelf(req, "account.setAvatar", true, (tx, a) => setMyAvatar(tx, a, input)),
  "account.changePassword": (req, input) => openSelf(req, "account.changePassword", true, (tx, a) => changeMyPassword(tx, a, input, {
    allowed: (who) => signInAllowed(req, who),
    failed: (who) => signInFailed(req, who),
  })),

  // 0035 — messages between AC Services employees. Not a customer, a vendor, or a firm.
  "messages.directory": (req) => openSelf(req, "messages.directory", false, listColleagues),
  "messages.pending": (req) => openSelf(req, "messages.pending", false, listPending),
  "messages.recent": (req) => openSelf(req, "messages.recent", false, listRecent),
  "messages.send": (req, input) => openSelf(req, "messages.send", true, (tx, a) => sendStaffMessage(tx, a, input)),
  "messages.dismiss": (req, input) => openSelf(req, "messages.dismiss", true, (tx, a) => dismissStaffMessage(tx, a, input)),

  // S2 — author a contract term override. Refusals come back as 422 with the reason.
  "terms.authorOverride": (req, input) => openTx(req, "terms.authorOverride", "uow", async (uow, p) => {
    const ctx = await buildContext(p, hierarchyReader(uow.tx));
    return authorTermOverride(uow, ctx, { ...input, effectiveTo: input.effectiveTo ?? null });
  }),

  // S2/S6 — resolved terms at a node as of a date, with the trace.
  "terms.resolved": (req, input) => openTx(req, "terms.resolved", "read", async (uow, p) => {
    const keys = input.termKeys ? input.termKeys.split(",").map((k) => k.trim()).filter(Boolean) : undefined;
    // A customer resolves its own agreements. RLS (0006) already makes another
    // org's rows absent; naming the org from the token as well means the
    // answer for a customer never depends on what the query string said.
    const orgId = optionalOrg(p.namespace === "internal", input.orgId, p.orgId, requireUuid);
    const r = await resolvedTermsAt(uow, orgId, input.tier ?? "site", input.nodeId ?? "", input.asOf ?? new Date().toISOString().slice(0, 10), keys);
    return { resolved: r.resolved, refused: Object.fromEntries(Object.entries(r.refused).map(([k, e]) => [k, { code: e.code, message: e.message }])) };
  }),

  // C1 — the hierarchy S2 authors. Structure is the trigger's to refuse; inputs are the handler's.
  "regions.list": (req) => openTx(req, "regions.list", "read", (uow) => listRegions(uow)),
  "sites.list": (req) => openTx(req, "sites.list", "read", (uow) => listSites(uow)),
  "organizations.list": (req, input) => openTx(req, "organizations.list", "read", (uow) => listOrganizations(uow, input)),
  "organizations.create": (req, input) => openTx(req, "organizations.create", "uow", (uow) => createOrganization(uow, input, randomUUID)),
  "accounts.list": (req, input) => openTx(req, "accounts.list", "read", (uow, p) => listAccounts(uow, namedOrg(p.namespace === "internal", input.orgId, p.orgId))),
  "accounts.create": (req, input) => openTx(req, "accounts.create", "uow", (uow) => createAccount(uow, input, randomUUID)),
  "accounts.move": (req, input) => openTx(req, "accounts.move", "uow", (uow) => moveAccount(uow, input)),
  "accounts.update": (req, input) => openTx(req, "accounts.update", "uow", (uow) => updateAccount(uow, input)),

  // C2 — the agreements those nodes are served under, and the register the
  // override form is drawn from. The scope's existence at its declared tier is
  // ac_contract_scope_exists's to refuse, in its own words.
  "contracts.list": (req, input) => openTx(req, "contracts.list", "read", (uow, p) => listContracts(uow, withCallerOrg(p.namespace === "internal", input, p.orgId))),
  "contracts.create": (req, input) => openTx(req, "contracts.create", "uow", (uow) => createContract(uow, input, randomUUID)),
  "contracts.transition": (req, input) => openTx(req, "contracts.transition", "uow", (uow) => transitionContract(uow, input)),
  "terms.overrides.list": (req, input) => openTx(req, "terms.overrides.list", "read", (uow) => listTermOverrides(uow, input)),
  // The register is code, not a row. No transaction is opened for it; the read
  // scope exists so the answer is still behind a live session.
  "terms.register": (req) => openTx(req, "terms.register", "read", async () => termRegister()),

  // C4 — the subcontractor network: firm, crew, document, price. Reads are
  // served to S8 too and RLS makes "its own" true; writes are S2's. Whether a
  // verification is S2's and once is ac_credential_verification_is_earned's.
  "firms.list": (req, input) => openTx(req, "firms.list", "read", (uow) => listFirms(uow, input)),
  "firms.create": (req, input) => openTx(req, "firms.create", "uow", (uow) => createFirm(uow, input, randomUUID)),
  "firms.update": (req, input) => openTx(req, "firms.update", "uow", (uow) => updateFirm(uow, input)),
  "crews.list": (req, input) => openTx(req, "crews.list", "read", (uow) => listCrews(uow, input, new Date().toISOString().slice(0, 10))),
  "crews.create": (req, input) => openTx(req, "crews.create", "uow", (uow) => createCrew(uow, input, randomUUID)),
  "crews.update": (req, input) => openTx(req, "crews.update", "uow", (uow) => updateCrew(uow, input)),
  // 0020 — the roster. Whether this principal reads or writes a home address is the handler's (account_owner).
  "technicians.list": (req, input) => openTx(req, "technicians.list", "read", (uow, p) => listTechnicians(uow, input, p)),
  "technicians.record": (req, input) => openTx(req, "technicians.record", "uow", (uow, p) => recordTechnician(uow, input, p, randomUUID)),
  "technicians.update": (req, input) => openTx(req, "technicians.update", "uow", (uow, p) => updateTechnician(uow, input, p)),
  "credentials.list": (req, input) => openTx(req, "credentials.list", "read", (uow) => listCredentials(uow, input)),
  "credentials.record": (req, input) => openTx(req, "credentials.record", "uow", (uow) => recordCredential(uow, input, randomUUID)),
  "credentials.verify": (req, input) => openTx(req, "credentials.verify", "uow", (uow, p) => verifyCredential(uow, input, p.subjectId, new Date())),
  "rateCards.list": (req, input) => openTx(req, "rateCards.list", "read", (uow) => listRateCards(uow, input)),
  "rateCards.set": (req, input) => openTx(req, "rateCards.set", "uow", (uow) => setRateCard(uow, input, randomUUID)),
  // item 7 — the firm's own writes (D12) and the statement. Firm, type and
  // region come from the principal; visibility comes from 0007.
  "credentials.submit": (req, input) => openTx(req, "credentials.submit", "uow", (uow) => submitCredential(uow, input, randomUUID)),
  "crews.enroll": (req, input) => openTx(req, "crews.enroll", "uow", (uow, p) => enrollCrew(uow, input, p.firmId, randomUUID)),
  "crews.retire": (req, input) => openTx(req, "crews.retire", "uow", (uow) => retireCrew(uow, input)),
  "settlements.list": (req, input) => openTx(req, "settlements.list", "read", (uow) => listSettlements(uow, input)),
  "settlements.lines": (req, input) => openTx(req, "settlements.lines", "read", (uow) => listSettlementLines(uow, input)),
  "settlements.issue": (req, input) => openTx(req, "settlements.issue", "uow", (uow) => issueSettlement(uow, input, new Date())),
  "settlements.acknowledge": (req, input) => openTx(req, "settlements.acknowledge", "uow", (uow) => acknowledgeSettlement(uow, input, new Date())),
  "settlements.dispute": (req, input) => openTx(req, "settlements.dispute", "uow", (uow) => disputeSettlement(uow, input, new Date())),

  // Item 10 — S4. Reads of the rollup; there is no S4 write to route.
  "hq.metrics": (req, input) => openTx(req, "hq.metrics", "read", (uow) => hqMetrics(uow, input)),
  "hq.history": (req, input) => openTx(req, "hq.history", "read", (uow) => hqHistory(uow, input)),

  // Item 11 — procurement. The office's side (S2) and the vendor's (S7) over the
  // same rows; what each may see and change is 0011's.
  "vendors.list": (req) => openTx(req, "vendors.list", "read", (uow) => listVendors(uow)),
  "vendors.create": (req, input) => openTx(req, "vendors.create", "uow", (uow) => createVendor(uow, input, randomUUID)),
  "receivingPoints.list": (req) => openTx(req, "receivingPoints.list", "read", (uow) => listReceivingPoints(uow)),
  "receivingPoints.create": (req, input) => openTx(req, "receivingPoints.create", "uow", (uow) => createReceivingPoint(uow, input, randomUUID)),
  "catalog.list": (req, input) => openTx(req, "catalog.list", "read", (uow) => listCatalog(uow, input)),
  "catalog.addItem": (req, input) => openTx(req, "catalog.addItem", "uow", (uow) => addCatalogItem(uow, input, randomUUID)),
  "prices.propose": (req, input) => openTx(req, "prices.propose", "uow", (uow) => proposePrice(uow, input, randomUUID)),
  "prices.withdraw": (req, input) => openTx(req, "prices.withdraw", "uow", (uow) => withdrawPrice(uow, input)),
  "prices.decide": (req, input) => openTx(req, "prices.decide", "uow", (uow, p) => decidePrice(uow, input, p.subjectId, new Date())),
  "pos.list": (req, input) => openTx(req, "pos.list", "read", (uow) => listPurchaseOrders(uow, input)),
  "pos.detail": (req, input) => openTx(req, "pos.detail", "read", (uow) => purchaseOrder(uow, input)),
  "pos.create": (req, input) => openTx(req, "pos.create", "uow", (uow, p) => createPurchaseOrder(uow, input, p.subjectId, randomUUID, new Date())),
  "pos.issue": (req, input) => openTx(req, "pos.issue", "uow", (uow) => issuePurchaseOrder(uow, input, new Date())),
  "pos.cancel": (req, input) => openTx(req, "pos.cancel", "uow", (uow) => cancelPurchaseOrder(uow, input)),
  "pos.acknowledge": (req, input) => openTx(req, "pos.acknowledge", "uow", (uow) => acknowledgePurchaseOrder(uow, input, new Date())),
  "shipments.record": (req, input) => openTx(req, "shipments.record", "uow", (uow) => recordShipment(uow, input, randomUUID)),
  "receipts.record": (req, input) => openTx(req, "receipts.record", "uow", (uow, p) => recordReceipt(uow, input, p.subjectId, randomUUID)),
  "vendorInvoices.submit": (req, input) => openTx(req, "vendorInvoices.submit", "uow", (uow) => submitVendorInvoice(uow, input, randomUUID)),
  "vendorInvoices.list": (req, input) => openTx(req, "vendorInvoices.list", "read", (uow) => listVendorInvoices(uow, input)),
  "rmas.request": (req, input) => openTx(req, "rmas.request", "uow", (uow, p) => requestReturn(uow, input, p.subjectId, randomUUID)),
  "rmas.respond": (req, input) => openTx(req, "rmas.respond", "uow", (uow) => respondToReturn(uow, input, new Date())),
  "rmas.list": (req, input) => openTx(req, "rmas.list", "read", (uow) => listReturns(uow, input)),

  // item 4 — the job itself, created in Office & Dispatch.
  "projects.list": (req, input) => openTx(req, "projects.list", "read", (uow) => listProjects(uow, input)),
  "projects.create": (req, input) => openTx(req, "projects.create", "uow", (uow) => createProject(uow, input, randomUUID)),
  "jobs.create": (req, input) => openTx(req, "jobs.create", "uow", (uow) => createJob(uow, input, randomUUID, new Date())),
  "jobs.list": (req, input) => openTx(req, "jobs.list", "read", (uow) => listJobs(uow, input.state)),

  // item 9 — the site record: the units at a site, the people at a node, the
  // invoices with lines there, and the roof from above. Reads served to S6
  // and S2 alike; 0009 makes "its own" true. Writes are the office's.
  "equipment.list": (req, input) => openTx(req, "equipment.list", "read", (uow) => listEquipment(uow, input)),
  "equipment.register": (req, input) => openTx(req, "equipment.register", "uow", (uow) => registerEquipment(uow, input, randomUUID)),
  "contacts.list": (req, input) => openTx(req, "contacts.list", "read", (uow) => listContacts(uow, input)),
  "contacts.set": (req, input) => openTx(req, "contacts.set", "uow", (uow) => setContact(uow, input, randomUUID)),
  "invoices.list": (req, input) => openTx(req, "invoices.list", "read", (uow) => listInvoices(uow, input)),
  // 0030: what was paid against an invoice. Written by finance and the principals (S2 writeRoles).
  "invoices.void": (req, input) => openTx(req, "invoices.void", "uow", (uow) => voidInvoice(uow, input, new Date())),
  "payments.list": (req, input) => openTx(req, "payments.list", "read", (uow) => listPayments(uow, input)),
  "payments.webhook": (req, input) => openTx(req, "payments.webhook", "uow", (uow) => paymentWebhook(uow, input, randomUUID, new Date())),
  "payments.record": (req, input) => openTx(req, "payments.record", "uow", (uow, p) => recordPayment(uow, p.subjectId, input, randomUUID, new Date())),
  "payments.return": (req, input) => openTx(req, "payments.return", "uow", (uow) => returnPayment(uow, input, new Date())),
  // The provider is asked after the read's transaction is released, never
  // inside it: a slow provider must not hold a pool connection per caller.
  "sites.imagery": async (req, input) => runPlan(await openTx(req, "sites.imagery", "read", (uow) => siteImageryRead(uow, input, IMAGERY)), fetch),
  "sites.mapTile": async (req, input) => runPlan(await openTx(req, "sites.mapTile", "read", (uow) => siteMapTileRead(uow, input, MAP_TILES)), fetch),
  "sites.locate": async (req, input) => {
    const plan = await openTx(req, "sites.locate", "read", (uow) => locateSiteRead(uow, input, GEOCODE));
    if ("answer" in plan) return plan.answer;
    const found = await geocode(plan.query, GEOCODE, fetch);
    return openTx(req, "sites.locate", "uow", (uow) => locateSiteWrite(uow, plan.siteId, plan.query, found));
  },

  // item 6 — S6's first write, and the office's read of it.
  "serviceRequests.create": createOrHold("serviceRequests.create"),
  "serviceRequests.list": (req, input) => openTx(req, "serviceRequests.list", "read", (uow, p) => listServiceRequests(uow, input, new Date(), p.namespace === "internal")),
  "serviceRequests.attachPhoto": (req, input) => openTx(req, "serviceRequests.attachPhoto", "uow", (uow, p) => attachPhoto(uow, p.subjectId, STORE, input, randomUUID)),
  "media.get": (req, input) => openTx(req, "media.get", "read", (uow, p) => getMedia(uow, STORE, input, p.namespace)),
  "customers.createResidential": (req, input) => openTx(req, "customers.createResidential", "uow", async (uow, p) =>
    createResidential(uow, await buildContext(p, hierarchyReader(uow.tx)), input, randomUUID, new Date())),
  "leads.list": (req, input) => openTx(req, "leads.list", "read", (uow) => listLeads(uow, input)),
  "leads.convert": (req, input) => openTx(req, "leads.convert", "uow", async (uow, p) =>
    convertLead(uow, await buildContext(p, hierarchyReader(uow.tx)), input, randomUUID, new Date())),
  "serviceRequests.openJob": (req, input) => openTx(req, "serviceRequests.openJob", "uow", (uow) => openJobFromRequest(uow, input, randomUUID, new Date())),
  "serviceRequests.hold": createOrHold("serviceRequests.hold"),

  // S3 — the one gated door, its dry run, and its release.
  "dispatch.assign": (req, input) => openTx(req, "dispatch.assign", "uow", (uow, p) => assignCrew(uow, p.subjectId, input, new Date())),
  "dispatch.candidates": (req, input) => openTx(req, "dispatch.candidates", "read", (uow) => candidateCrews(uow, input, new Date())),
  "dispatch.release": (req, input) => openTx(req, "dispatch.release", "uow", (uow, p) => releaseAssignment(uow, p.subjectId, input, new Date())),
  "jobs.transition": (req, input) => openTx(req, "jobs.transition", "uow", (uow, p) => transitionJob(uow, p.subjectId, input, new Date())),
  "jobs.addNote": (req, input) => openTx(req, "jobs.addNote", "uow", (uow, p) => addJobNote(uow, p.subjectId, input, randomUUID)),
  "jobs.setReturnTrip": (req, input) => openTx(req, "jobs.setReturnTrip", "uow", (uow) => setReturnTrip(uow, input)),
  "manager.overview": (req) => openTx(req, "manager.overview", "read", (uow, p) => {
    if (!seesManagerOverview(p)) throw new HttpError(403, "The Manager Dashboard is for leadership (principal or ops_leadership) signed in at company scope");
    return managerOverview(uow, p.orgId, new Date());
  }),
  // 0016 — one job as dispatch reads it, and what the customer is told.
  "jobs.detail": (req, input) => openTx(req, "jobs.detail", "read", (uow) => jobDetail(uow, input)),
  "jobs.conversation": (req, input) => openTx(req, "jobs.conversation", "read", (uow) => jobConversation(uow, input)),
  "jobs.saveUpdate": (req, input) => openTx(req, "jobs.saveUpdate", "uow", (uow, p) => saveJobUpdate(uow, p.subjectId, input, randomUUID, new Date())),
  "jobs.publishUpdate": (req, input) => openTx(req, "jobs.publishUpdate", "uow", (uow, p) => publishJobUpdate(uow, p.subjectId, input, new Date())),
  "jobs.postMessage": (req, input) => openTx(req, "jobs.postMessage", "uow", (uow, p) => postJobMessage(uow, p, input, randomUUID)),

  // item 4 — D-2a's primitive: this device, this crew, this window.
  "devices.list": (req, input) => openTx(req, "devices.list", "read", (uow) => listDevices(uow, input)),
  "devices.register": (req, input) => openTx(req, "devices.register", "uow", (uow) => registerDevice(uow, input, randomUUID)),
  "devices.grantShift": (req, input) => openTx(req, "devices.grantShift", "uow", (uow, p) => grantDeviceShift(uow, p.subjectId, input, randomUUID)),

  // S5 — what a technician reads before replaying a sync batch, and the replay itself.
  "jobs.mine": onShift("jobs.mine", "read", (uow, p) => listMyJobs(uow, p.shiftId)),
  "punches.mine": onShift("punches.mine", "read", (uow, p, input) => listMyPunches(uow, p.subjectId, input)),
  "jobs.attachMedia": onShift("jobs.attachMedia", "uow", (uow, p, input) => attachJobMedia(uow, p.subjectId, p.shiftId, STORE, input, randomUUID)),
  "jobs.wrapUp": onShift("jobs.wrapUp", "uow", (uow, p, input) => wrapUpJob(uow, p.subjectId, p.shiftId, input)),
  "sync.replay": onDevice("sync.replay", "sync", async (uow, p, input) => {
    // input.orgId / input.regionId are not read: tenancy is the grant's and the job's, never the body's.
    return { outcomes: await ingestSync(uow, p.subjectId, { deviceId: p.deviceId, grantId: p.shiftId, orgId: p.orgId, regionId: p.regionId, mutations: input.mutations }, new Date()) };
  }),

  // The SSE feed: one LISTEN client on the pool, fan-out per connected principal's region.
  "events.stream": async (req, _input, res) => {
    const caller = callerOf(req);
    const p = caller.principal;
    const surfaceId = surfaceOf(req, "events.stream", caller);
    // The same admission every other operation gets: session live, surface
    // enabled, role admitted, tenancy consistent. Opened and rolled back.
    await openTx(req, "events.stream", "read", async () => {});
    // A stream is a held socket and a place in every fan-out; a session gets a few, not as many as it asks for.
    if ([...sseClients].filter((c) => c.sessionId === p.sessionId).length >= SSE_STREAMS_PER_SESSION)
      throw new HttpError(429, `this session already has ${SSE_STREAMS_PER_SESSION} event streams open — close one first`);
    // A device hears its crew's work: which crew is the shift grant's.
    let crewId: string | null = null;
    if (p.namespace === "device" && p.shiftId) {
      const tx = await beginTx(pool, "ac_gateway");
      try { await bindSystem(tx); crewId = (await tx.query<{ crew_id: string }>("SELECT crew_id FROM device_grants WHERE id = $1", [p.shiftId]))[0]?.crew_id ?? null; }
      finally { await tx.rollback().catch(() => {}); }
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    // Headers are not on the wire until the first byte. A subscriber's fetch()
    // does not resolve — and the shell cannot report "open" — until then.
    res.write(`: connected ${p.regionId}\n\n`);
    const client: SseClient = {
      res, regionId: p.regionId,
      orgScoped: p.namespace === "internal" && p.scopeTier === "parent",
      internal: p.namespace === "internal",
      // A customer or a vendor hears its own org's events and nobody else's.
      orgId: p.namespace === "customer" || p.namespace === "vendor" ? p.orgId : null,
      // A firm hears its own org's events and the work its crews were sent to; a device, its crew's work.
      crew: p.namespace === "subcontractor" ? { orgId: p.orgId, firmId: p.firmId, crewId: null }
        : p.namespace === "device" ? { orgId: null, firmId: null, crewId } : null,
      surfaceId, sessionId: p.sessionId,
    };
    sseClients.add(client);
    // The session is checked at connect and again every minute: a stream must
    // not outlive the logout or the expiry that ended its session. Only a
    // definite answer ends it — a pool that is busy for a moment is not one.
    const recheck = setInterval(() => {
      void (async () => {
        const tx = await beginTx(pool, "ac_gateway");
        try { await assertSessionLive(tx, p); } finally { await tx.rollback().catch(() => {}); }
      })().catch((e) => {
        if (e instanceof AuthError) { res.end(); return; }
        console.warn("gateway: could not recheck an event stream's session; keeping it until the next check —", (e as Error).message);
      });
    }, SSE_SESSION_RECHECK_MS);
    req.on("close", () => { clearInterval(recheck); sseClients.delete(client); });
    return STREAMING;
  },

  // S2 — store a tenant's white-label. Validated against the ink schedule before
  // it is a row; a theme that would break the portal is a 422 with the ratio.
  "brand.setTheme": (req, input) => openTx(req, "brand.setTheme", "uow", (uow, p) => setBrandTheme(uow, p.subjectId, input)),

  /**
   * The one read with no principal behind it, and the reason is the product's:
   * a customer portal is branded on its SIGN-IN screen. There is no token yet,
   * no session to assert live, and no scope to bind — so this opens its own
   * unscoped transaction the way login does, reads one indexed row by host, and
   * rolls back.
   *
   * It is safe to leave open because a theme is public by construction — it
   * is the colours on a page anyone can load. It does say one thing: `tenant`
   * is true for a host that has a theme, so walking hosts finds the portals
   * that are white-labelled. That is the same fact loading each portal's
   * sign-in page tells anyone; it does not distinguish "not a customer" from
   * "a customer with no theme".
   */
  "brand.theme": async (req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // The query wins so a surface can ask on behalf of the host it is served
    // from; the Host header is the fallback for a portal on its own domain.
    // Behind Cloudflare the Worker rewrites Host to the container's and passes
    // the one the browser asked for as x-ac-forwarded-host (set by the Worker,
    // so trusted under the same flag as CF-Connecting-IP and no other time).
    const forwarded = req.headers["x-ac-forwarded-host"];
    const host = url.searchParams.get("host") ?? (BEHIND_CLOUDFLARE ? (typeof forwarded === "string" ? forwarded : undefined) : req.headers.host);
    const tx = await beginTx(pool, "ac_gateway");
    try { await bindSystem(tx); return await brandStylesheetFor(tx, host ?? undefined); } finally { await tx.rollback().catch(() => {}); }
  },

  // ---- item 8: S1's anonymous door ----
  "auth.anonymousSession": (req, _input, res) => anonymousSession(req, res),
  // Throttled per address before the body is read (beforeBody).
  "leads.submit": (req, input) => openTx(req, "leads.submit", "uow", (uow) => submitLead(uow, input, randomUUID)),
  "callRecords.record": (req, input) => openTx(req, "callRecords.record", "uow", (uow) => recordCall(uow, input, randomUUID, () => new Date())),

  /**
   * The coverage map, with no session behind it — the same shape as
   * `brand.theme` above and for the same kind of reason: a marketing page is
   * read before anyone is anybody.
   *
   * Where it differs, deliberately: this transaction is BOUND, as the
   * anonymous principal, before it reads. It does not need to be —
   * `ac_public_coverage()` is SECURITY DEFINER and answers the same two
   * columns either way — and it is bound anyway, because 0007's finding was a
   * week of unbound sweeps reading zero rows and reporting green, and the
   * habit that prevents that is binding every transaction whether or not this
   * one's correctness depends on it.
   */
  "coverage.list": async () => {
    const tx = await beginTx(pool, "ac_gateway");
    try {
      await tx.setLocal(scopeBinding(
        {
          namespace: "anonymous", subjectId: ANONYMOUS_ACTOR, orgId: PROSPECT_ORG_ID, regionId: UNASSIGNED_REGION_ID,
          scopeTier: "parent", scopeId: PROSPECT_ORG_ID, roles: [], firmId: null, deviceId: null, shiftId: null,
          tierClaim: null, sessionId: ANONYMOUS_ACTOR,
        },
        "S1",
      ));
      return await listCoverage(tx);
    } finally {
      await tx.rollback().catch(() => {});
    }
  },

  "system.health": async () => ({ ok: true, surfaces: Object.values(SURFACES).filter((s) => s.enabled).map((s) => s.id) }),
};
