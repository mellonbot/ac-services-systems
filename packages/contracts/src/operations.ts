import { WHITE_LABEL_SURFACES, type SurfaceId } from "./surfaces.ts";
import type { Tier } from "./tiers.ts";
import type { TermPolicy } from "./terms.ts";
import type { HierarchyContext } from "./context.ts";

/**
 * THE OPERATION CATALOGUE.
 *
 * Every request a surface may make of the gateway, as data. The gateway's
 * route table is built from this constant and nothing else; the SDK client is
 * generated from it (tools/ci/emit-sdk.ts); the guard fails the build if the
 * two disagree or the generated client has drifted.
 *
 * That is the whole mechanism behind master plan non-negotiable #14 — "no
 * surface writes its own fetch call". Before this file existed the sentence
 * was enforced by nothing: `packages/sdk` was a type with a header promising a
 * generator that did not exist. A surface could invent a request the gateway
 * never agreed to serve, and a surface could be pointed at a second origin.
 * Now a request that is not a row here has no method on the client and no
 * route at the gateway — the same move the term register made for terms and
 * the surface registry made for writes.
 *
 * What a row declares:
 *   - `method` + `path`: the wire. Paths are literal; no path parameters, so
 *     the gateway's lookup is a Map hit and a typo is a 404 in the smoke test.
 *   - `kind`: `query` opens a read-only transaction; `mutation` opens a unit of
 *     work; `stream` is the SSE feed; `login` and `system` run unscoped.
 *   - `auth`: `bearer` requires a verified token; `none` does not.
 *   - `surfaces`: which surfaces may call it. The client sends `x-ac-surface`;
 *     the gateway refuses a surface not on the list (403) and then opens the
 *     unit of work FOR THAT SURFACE, so the write allowlist and role admission
 *     in SURFACES apply. The header selects; the token authorizes. A surface
 *     that lies about its id gains a surface whose roles its token lacks.
 *   - `carrier`: where the input travels — JSON body, query string, or nowhere.
 *   - `sdkMethod`: the generated client's method name. Stable; renaming one is
 *     a breaking change for every surface, which is the point of naming it here.
 */
export type OperationKind = "login" | "query" | "mutation" | "stream" | "system";
export type OperationAuth = "none" | "bearer";
export type InputCarrier = "body" | "query" | "none";

type OperationSpec = {
  readonly id: string;
  readonly method: "GET" | "POST";
  readonly path: `/${string}`;
  readonly kind: OperationKind;
  readonly auth: OperationAuth;
  readonly surfaces: readonly SurfaceId[];
  readonly carrier: InputCarrier;
  readonly sdkMethod: string;
  readonly summary: string;
};

const AUTHENTICATED: readonly SurfaceId[] = ["S2", "S3", "S4", "S5", "S6", "S7", "S8"];
/**
 * Surfaces whose principals hold a password at OUR gateway. Devices carry a
 * shift grant; S1 is anonymous.
 *
 * S6 joined this list with item 6 (2026-09-17) as the PHASE 1 DOOR. The
 * registry says "customer IdP + tier claim", and that stays the destination:
 * federation replaces the credential check inside `auth.login` and nothing
 * else — the claims it mints (namespace, org, scope tier, scope node) are the
 * same either way, and everything downstream of the token (RLS, the context
 * walk, the tier scoping the acceptance test measures) is proven against those
 * claims, not against how the password was checked. Building the federation
 * needs a customer's IdP to test against, which is a conversation with
 * Amped's IT, not a diff here; docs/OPEN_DECISIONS.md carries it as OPEN-S6-IDP.
 */
const PASSWORD_LOGIN: readonly SurfaceId[] = ["S2", "S3", "S4", "S6", "S7", "S8"];

export const OPERATIONS = {
  "auth.login": {
    id: "auth.login", method: "POST", path: "/auth/login", kind: "login", auth: "none",
    surfaces: PASSWORD_LOGIN, carrier: "body", sdkMethod: "login",
    summary: "Mint a token and resolve the hierarchy context once. The surface named in the body must serve the user's namespace.",
  },
  "auth.logout": {
    id: "auth.logout", method: "POST", path: "/auth/logout", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "logout",
    summary: "Revoke the session behind this token and clear the session cookie. The next request with either is 401 revoked.",
  },
  "auth.deviceLogin": {
    id: "auth.deviceLogin", method: "POST", path: "/auth/device-login", kind: "login", auth: "none",
    surfaces: ["S5"], carrier: "body", sdkMethod: "deviceLogin",
    summary: "A technician's own credential PLUS the hardware they are holding. Mints a device-namespace token bound to the one active shift grant for (device, technician) — the token expires with the shift, never later.",
  },
  "session.me": {
    id: "session.me", method: "GET", path: "/me", kind: "query", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "me",
    summary: "The principal and its hierarchy context, re-resolved. What the shell reads at boot.",
  },
  // ---- 0032: the Account button — the caller's own row, on every signed-in surface ----
  "account.me": {
    id: "account.me", method: "GET", path: "/account", kind: "query", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "myAccount",
    summary: "The caller's own name, email, picture, status and when they last set their password. A device principal reads the technician behind the shift.",
  },
  "account.update": {
    id: "account.update", method: "POST", path: "/account", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "body", sdkMethod: "updateMyAccount",
    summary: "Set the caller's own display name, presence and one-line status. Fields left out are left as they are.",
  },
  "account.setAvatar": {
    id: "account.setAvatar", method: "POST", path: "/account/avatar", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "body", sdkMethod: "setAccountAvatar",
    summary: "Set or clear the caller's own picture: a JPEG or PNG by its own bytes, at most AVATAR_MAX_BYTES, as base64 in the body. Null clears it.",
  },
  "account.changePassword": {
    id: "account.changePassword", method: "POST", path: "/account/password", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "body", sdkMethod: "changePassword",
    summary: "Change the caller's own password, given the current one. Wrong guesses count against sign-in's throttle. Ends every other session the person holds; this one stays.",
  },
  "terms.authorOverride": {
    id: "terms.authorOverride", method: "POST", path: "/s2/terms/override", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "authorTermOverride",
    summary: "Author a contract term override. Admitted or refused at insert against the register; a refusal is a 422 with the reason and its axis.",
  },
  "terms.resolved": {
    id: "terms.resolved", method: "GET", path: "/terms/resolved", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "resolvedTerms",
    summary: "Every term at a node as of a date, with the trace naming every rung.",
  },
  // ---- C1: the hierarchy S2 authors (09 §3.6) ----
  "regions.list": {
    id: "regions.list", method: "GET", path: "/regions", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3"], carrier: "none", sdkMethod: "listRegions",
    summary: "OUR service regions — the shard boundary. What a region node binds to; what D14's density rule is set on.",
  },
  "organizations.list": {
    id: "organizations.list", method: "GET", path: "/s2/organizations", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listOrganizations",
    summary: "Customer and subcontractor organizations — the parent tier — with how many of our regions each one meets.",
  },
  "organizations.create": {
    id: "organizations.create", method: "POST", path: "/s2/organizations", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createOrganization",
    summary: "Create a customer parent WITH its first region node in one unit of work. No orphan parent: a parent never exists without a place we serve it from.",
  },
  "customers.createResidential": {
    id: "customers.createResidential", method: "POST", path: "/s2/customers/residential", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createResidentialCustomer",
    summary: "A home as a customer, in one unit of work: the organization (segment residential, fixed for good), the region node we serve it from, the household as its location and the home as its site, both at the address, and the homeowner as the primary contact when given. The tier ladder is unchanged — a home is a one-branch tree.",
  },
  "leads.list": {
    id: "leads.list", method: "GET", path: "/s2/leads", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listLeads",
    summary: "Leads S1 captured, newest first — waiting ones by default — with the contact the visitor gave and, once converted, the home it became.",
  },
  "leads.convert": {
    id: "leads.convert", method: "POST", path: "/s2/leads/convert", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "convertLead",
    summary: "A lead becomes a residential customer: customers.createResidential with the lead's name and contact, and the lead records the home it became — once; a second conversion is refused, naming the home.",
  },
  "accounts.list": {
    id: "accounts.list", method: "GET", path: "/s2/accounts", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listAccounts",
    summary: "Every node in an organization's tree the caller may see. S6 sees its own subtree by RLS; same operation.",
  },
  "accounts.create": {
    id: "accounts.create", method: "POST", path: "/s2/accounts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createAccount",
    summary: "Author a region node, location or site. region_id is an input for a region node only; below that it derives from the parent edge. D14 is checked for a location.",
  },
  "accounts.move": {
    id: "accounts.move", method: "POST", path: "/s2/accounts/move", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "moveAccount",
    summary: "Re-parent a node. The shard key follows the edge by trigger; the output says how many descendants moved with it.",
  },
  "accounts.update": {
    id: "accounts.update", method: "POST", path: "/s2/accounts/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateAccount",
    summary: "Attributes of a node — name, the customer's own grouping, external ref, address, timezone, active. Never parent_id or region_id; those are accounts.move.",
  },
  // ---- item 9: the site record — what a site IS, not only what is happening there (S6 site card) ----
  "equipment.list": {
    id: "equipment.list", method: "GET", path: "/equipment", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listEquipment",
    summary: "The units at a site this principal may see — kind, label, make and model, serial, tonnage, installed — each with when it was last serviced, DERIVED from the completed jobs that named it (job_equipment). RLS (0009) decides the site; nothing here filters.",
  },
  "equipment.register": {
    id: "equipment.register", method: "POST", path: "/s2/equipment", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "registerEquipment",
    summary: "Record a unit at a site: the kind from the closed list, the customer's own label, make, model, serial. The manufacturer dictionary is global reference data and grows by name here. Tenancy derives from the site.",
  },
  "contacts.list": {
    id: "contacts.list", method: "GET", path: "/contacts", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listContacts",
    summary: "The people at a node AND at its ancestors — a site with no manager of its own inherits the location's — each row saying which node it belongs to. Visible under the node's own rule (0009).",
  },
  "contacts.set": {
    id: "contacts.set", method: "POST", path: "/s2/contacts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "setContact",
    summary: "Record or replace a contact at a node: role, name, phone, email, note, primary. The customer's own edit of its contacts is OPEN-S6-CONTACTS; until it closes the office keeps the record.",
  },
  "invoices.list": {
    id: "invoices.list", method: "GET", path: "/invoices", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listInvoices",
    summary: "Invoices with lines at a site or location this principal may see, with THOSE lines and their subtotal — a consolidated parent invoice read from one location shows that location's lines and nothing beside (0009). Issuance is WS-E's; this is the read. Each carries its status and what is paid against the whole invoice, derived from its payments (0030).",
  },
  "invoices.void": {
    id: "invoices.void", method: "POST", path: "/s2/invoices/void", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "voidInvoice",
    summary: "Void an issued invoice the office should not have issued, with the reason. Refused while any payment stands against it. Final (0030). Finance and the principals (S2 writeRoles.invoice).",
  },
  "payments.list": {
    id: "payments.list", method: "GET", path: "/s2/payments", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listPayments",
    summary: "Every payment recorded against an invoice, oldest first, in every state — the history the derived status is read from.",
  },
  "payments.record": {
    id: "payments.record", method: "POST", path: "/s2/payments", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordPayment",
    summary: "Record a payment received against an issued invoice: amount in the invoice's currency, method, reference, the day it arrived (today if not given; never ahead, never before issue). Part payments are rows like any other; the total is never exceeded (0030). Emits invoice.paid when it settles the invoice, payment.recorded otherwise. Finance and the principals (S2 writeRoles.payment).",
  },
  "payments.return": {
    id: "payments.return", method: "POST", path: "/s2/payments/return", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "returnPayment",
    summary: "Mark a succeeded payment returned (a bounced check, an ACH return) or refunded, with the reason. The row stays; the invoice's status is re-derived without it. Finance and the principals.",
  },
  "sites.imagery": {
    id: "sites.imagery", method: "GET", path: "/s6/sites/imagery", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "siteImagery",
    summary: "Overhead imagery of a site, fetched by the GATEWAY from the configured provider (AC_IMAGERY_URL) and returned inline — the customer's browser never reaches a third party with the customer's address, and there is no key in a bundle. Unavailable is an answer, not an error: not configured, no coordinates, provider unreachable.",
  },
  "sites.mapTile": {
    id: "sites.mapTile", method: "GET", path: "/s2/sites/map-tile", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "siteMapTile",
    summary: "One web-mercator basemap tile near a site, fetched by the GATEWAY from the configured tile provider (AC_MAP_TILE_URL) and returned inline — the same reasons as sites.imagery: no key in a bundle, no customer's coordinates sent to a third party from a browser. Only tiles within MAP_TILE_REACH of the site's own tile, at MAP_ZOOM_MIN–MAP_ZOOM_MAX, are served: a pan around a home, not a free tile proxy. Unavailable is an answer: not configured, no coordinates, provider unreachable.",
  },
  "sites.locate": {
    id: "sites.locate", method: "POST", path: "/s2/sites/locate", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "locateSite",
    summary: "Place a site on the map: when its address carries no lat/lng, the GATEWAY asks the configured geocoder (AC_GEOCODE_URL) for that address and writes the coordinates onto the address through accounts.update — audited, account.updated. A site that already has coordinates is answered as recorded and not touched. Only a match at the address itself (a house number or a named place) is written; a street, town or postcode centroid is 'not_found', because a pin in the wrong yard is worse than none.",
  },
  // ---- C2: the agreements and term overrides S2 authors (09 §3.6) ----
  "contracts.list": {
    id: "contracts.list", method: "GET", path: "/s2/contracts", kind: "query", auth: "bearer",
    // S6 since item 6: a customer reads the agreements it signed. Its own org
    // by RLS (0006) — the orgId input is inert for a customer principal.
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listContracts",
    summary: "The signed agreements in an organization — what a term override must belong to, and where the state machine currently stands.",
  },
  "contracts.create": {
    id: "contracts.create", method: "POST", path: "/s2/contracts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createContract",
    summary: "Record an agreement against a node. OQ5's position is required with no default; regionId is an input for a parent-scope agreement alone and derives from the node below it.",
  },
  "contracts.transition": {
    id: "contracts.transition", method: "POST", path: "/s2/contracts/transition", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "transitionContract",
    summary: "draft → active → expired | terminated. A step off that ladder is refused by name; activation and ending are what the other blocks subscribe to.",
  },
  "terms.overrides.list": {
    id: "terms.overrides.list", method: "GET", path: "/s2/terms/overrides", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listTermOverrides",
    summary: "The override rows an organization holds — every tier, optionally narrowed to one term or one agreement. What the override screen lists before it adds to it.",
  },
  "terms.register": {
    id: "terms.register", method: "GET", path: "/terms/register", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "none", sdkMethod: "termRegister",
    summary: "The term policy register as data — value kind, enum values, authoring tiers, rationale. S2 renders the override form FROM this, so a twelfth term is a register diff and the form follows.",
  },

  // ---- C4: the subcontractor network S2 records (09 §3.6, item 7) ----
  // Reads are served to S8 as well: a firm reads its own row, its own crews,
  // its own documents and its own price, and RLS is what makes "its own" true.
  // Writes are S2's. S8's intake (a firm PROPOSING a document) is a separate
  // operation with its own entity, not yet in the catalogue.
  "firms.list": {
    id: "firms.list", method: "GET", path: "/network/firms", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listFirms",
    summary: "Subcontractor firms — legal name, status on the ladder, settlement terms, the MSA, OQ5 firm-side, and how many crews they field. S8 sees one row: itself.",
  },
  "firms.create": {
    id: "firms.create", method: "POST", path: "/s2/network/firms", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createFirm",
    summary: "Record a firm WITH its tenant root in one unit of work: the organizations row and the subcontractor_firms row share an id. A firm starts onboarding, in the region it is dispatched from. OQ5 is stated or the firm is not recorded.",
  },
  "firms.update": {
    id: "firms.update", method: "POST", path: "/s2/network/firms/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateFirm",
    summary: "Attributes and the status ladder: onboarding → active ⇄ suspended → terminated. Activation needs a signed MSA; a step off the ladder is refused by name.",
  },
  "crews.list": {
    id: "crews.list", method: "GET", path: "/network/crews", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3", "S8"], carrier: "query", sdkMethod: "listCrews",
    summary: "Crews — ours and the firms' — with a document summary per crew: what the gate would need, what is on file, what is verified, and the earliest expiry. Read by S2, by S3's board for a row per crew whether or not it holds work, and by a firm for its own crews; never by the field layer.",
  },
  "crews.create": {
    id: "crews.create", method: "POST", path: "/s2/network/crews", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createCrew",
    summary: "Record a crew in its home region. An employed crew is ours and names no firm; a subcontracted crew names its firm and is that firm's row. The tenancy follows from which.",
  },
  "crews.update": {
    id: "crews.update", method: "POST", path: "/s2/network/crews/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateCrew",
    summary: "Label and active flag. Never the firm, never the home region — a crew that changes employer or region is a new crew with a new document set.",
  },
  // 0020: the technician roster — every person who works our jobs, ours or a
  // firm's, login or not. The office reads it: S2 to keep it, S3's board to
  // draw every technician whether or not they hold work. S8 is not given it.
  // The home address is served to account owners alone; every other office
  // role reads it as restricted and cannot write it.
  "technicians.list": {
    id: "technicians.list", method: "GET", path: "/network/technicians", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3"], carrier: "query", sdkMethod: "listTechnicians",
    summary: "The technician roster — name, phone, specialties, crew, and the home address for an account owner or principal (restricted for every other role). Optionally one firm's.",
  },
  "technicians.record": {
    id: "technicians.record", method: "POST", path: "/s2/network/technicians", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordTechnician",
    summary: "Add a technician: ours (no firm) or a firm's. A crew named belongs to the same employer. Only an account owner or principal may record a home address.",
  },
  "technicians.update": {
    id: "technicians.update", method: "POST", path: "/s2/network/technicians/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateTechnician",
    summary: "Name, phone, specialties, crew, active — and the home address, by an account owner or principal only. Never the employer: a technician who changes firm is a new row.",
  },
  "credentials.list": {
    id: "credentials.list", method: "GET", path: "/network/credentials", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listCredentials",
    summary: "The documents on file for a crew or a firm's crews, verified or not. An unverified certificate is on the list AS unverified — it is not hidden, and it does not clear anything.",
  },
  "credentials.record": {
    id: "credentials.record", method: "POST", path: "/s2/network/credentials", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordCredential",
    summary: "Put a document on file — kind, identifier, the window it is valid for. ALWAYS unverified: there is no field for verified_at here, and the trigger refuses one on any path.",
  },
  "credentials.verify": {
    id: "credentials.verify", method: "POST", path: "/s2/network/credentials/verify", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "verifyCredential",
    summary: "THE ONLY PATH that sets verified_at — by S2, by the principal doing it, once. After this the document is immutable; a correction is a new document. The gate reads nothing else.",
  },
  "rateCards.list": {
    id: "rateCards.list", method: "GET", path: "/network/rate-cards", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listRateCards",
    summary: "A firm's rates by service code over time. A firm sees its own and no other's — RLS, not a WHERE clause.",
  },
  "rateCards.set": {
    id: "rateCards.set", method: "POST", path: "/s2/network/rate-cards", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "setRateCard",
    summary: "Set a rate from a day forward: the row in effect that day is closed at it and the new row inserted, both audited. A row that would overlap is refused by the EXCLUDE constraint — two prices at once is unrepresentable, not tie-broken.",
  },

  // ---- item 7: THE FIRM'S OWN WRITES (D12's minimum cut as the registry states
  // it: compliance_doc, crew_roster, settlement_ack, dispute) and the reads
  // behind settlement visibility. Each write has its own entity because the
  // allowlist is checked by entity: S2's `credentials.record` writes
  // crew_credential and S8's `credentials.submit` writes compliance_doc into
  // the same table, and 0005's trigger makes both arrive unverified. What a
  // firm's row may SAY is the table's (0007's two triggers), not the handler's.
  "credentials.submit": {
    id: "credentials.submit", method: "POST", path: "/s8/network/credentials", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "submitCredential",
    summary: "A firm puts a document on file for one of ITS OWN crews — kind, identifier, window, the stored file's key. Unverified on arrival, like every document; S2 verifies it, once, or it clears nothing. A crew the firm cannot see is 'unknown_crew', not 'forbidden'.",
  },
  "crews.enroll": {
    id: "crews.enroll", method: "POST", path: "/s8/network/crews", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "enrollCrew",
    summary: "A firm adds a crew to its roster: subcontracted, under itself, in the region it is dispatched from — none of which is an input. Onboarding and active firms roster (documents are verified before the first job); a suspended or terminated firm does not.",
  },
  "crews.retire": {
    id: "crews.retire", method: "POST", path: "/s8/network/crews/retire", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "retireCrew",
    summary: "A firm takes one of its crews off the roster (active = false) or renames it. Never the firm, the type or the region — 0007 refuses those from any path — and never a crew holding a live assignment: release it first.",
  },
  "settlements.list": {
    id: "settlements.list", method: "GET", path: "/money/settlements", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listSettlements",
    summary: "Statements we issue to firms for work done — period, total, state, and the firm's position on each. S2 reads every firm's; a firm reads its own, once issued (a draft is ours). RLS, not a WHERE.",
  },
  "settlements.lines": {
    id: "settlements.lines", method: "GET", path: "/money/settlements/lines", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listSettlementLines",
    summary: "One statement's lines: the job, the rate applied, the quantity, the amount. A firm sees the lines of a statement it can see and no other's — another firm's price is not derivable from a row the firm cannot read.",
  },
  "settlements.acknowledge": {
    id: "settlements.acknowledge", method: "POST", path: "/s8/money/settlements/acknowledge", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "acknowledgeSettlement",
    summary: "The firm states that an issued statement is right: issued → acknowledged, stamped. The one forward step a firm may take on money; the trigger refuses every other change to the row.",
  },
  "settlements.dispute": {
    id: "settlements.dispute", method: "POST", path: "/s8/money/settlements/dispute", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "disputeSettlement",
    summary: "The firm states that a statement is wrong, and why: issued or acknowledged → disputed, with the reason on the row. The office reads it on S2 (settlement.disputed on OFC). What happens next is WS-E's ladder, not S8's.",
  },

  // ---- item 4: the job itself, created in Office & Dispatch ----
  // 0024: an install is sold. The project is what it was sold under, and its
  // foreman is the person who sold it — every install job sits under one.
  "projects.list": {
    id: "projects.list", method: "GET", path: "/projects", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3"], carrier: "query", sdkMethod: "listProjects",
    summary: "The projects install work is opened under — who sold each, and how much install work sits under it — and the foremen a new one may be sold by. Optionally one customer's.",
  },
  "projects.create": {
    id: "projects.create", method: "POST", path: "/s2/projects", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createProject",
    summary: "Record what was sold: under an agreement in force, by a foreman (the person who sold it), for a window. The customer and region are the agreement's, never typed in.",
  },
  "jobs.create": {
    id: "jobs.create", method: "POST", path: "/s2/jobs", kind: "mutation", auth: "bearer",
    // S3 since 2026-10-21: a dispatcher opens a job for a call that came in by
    // phone, with no portal request behind it. Same handler, same derived SLA;
    // the unit of work holds a region-bound dispatcher to their own region.
    surfaces: ["S2", "S3"], carrier: "body", sdkMethod: "createJob",
    summary: "Author a job against a site. Opens its SLA timer in the same unit of work — due_at is DERIVED from the site's resolved sla_response term, never typed in (domain/sla deriveDueAt). Shadow mode until a region turns it off.",
  },
  "sites.list": {
    id: "sites.list", method: "GET", path: "/s3/sites", kind: "query", auth: "bearer",
    surfaces: ["S3"], carrier: "none", sdkMethod: "listSites",
    summary: "Every active site a dispatcher may open a job at — the sites in their region (every region for a parent-scoped principal), with the customer each belongs to. What S3's New job form picks from.",
  },
  "jobs.list": {
    id: "jobs.list", method: "GET", path: "/jobs", kind: "query", auth: "bearer",
    // S6 since item 6: a customer sees work at the sites it can see (0006's
    // ac_work_visible), and no crew — the assignment join returns nothing for
    // a customer principal, so currentCrew* are null on its rows by mechanism.
    // S8 since item 7: a firm sees work one of its own crews has been assigned
    // (0007's ac_firm_work_visible) — live or released — and the crew on the
    // row is its own, because the assignment join is behind the same rule.
    surfaces: ["S2", "S3", "S6", "S8"], carrier: "query", sdkMethod: "listJobs",
    summary: "Jobs visible to this principal — S2 org-wide, S3 region-locked, S6 at its own sites, S8 where its crews were sent, all by RLS, same operation. Carries each job's current (unreleased) assignment and open SLA timer, if any.",
  },
  // ---- item 6: S6's first write. A customer asks for work; the office turns it into a job. ----
  "serviceRequests.create": {
    id: "serviceRequests.create", method: "POST", path: "/s6/service-requests", kind: "mutation", auth: "bearer",
    surfaces: ["S6"], carrier: "body", sdkMethod: "createServiceRequest",
    summary: "A customer's request for service at one of its sites. The site must be visible to the principal (RLS decides; an invisible site is 'unknown_site', not 'forbidden'); tenancy derives from the site. It is a request, not a job — S2/S3 open the job against it.",
  },
  "serviceRequests.list": {
    id: "serviceRequests.list", method: "GET", path: "/service-requests", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3", "S6"], carrier: "query", sdkMethod: "listServiceRequests",
    summary: "Requests visible to this principal — a customer's own, the office's by region — with the site's name, the photos sent with it and, once one is opened, the job's state.",
  },
  "serviceRequests.attachPhoto": {
    id: "serviceRequests.attachPhoto", method: "POST", path: "/s6/service-requests/photos", kind: "mutation", auth: "bearer",
    surfaces: ["S6"], carrier: "body", sdkMethod: "attachServiceRequestPhoto",
    summary: "One photo onto the customer's own request, as base64 in the body. JPEG, PNG or HEIC by the file's own bytes; at most PHOTO_MAX_BYTES each and PHOTOS_PER_REQUEST per request; only while no job is open against it. The gateway writes the object — the browser never reaches the bucket.",
  },
  "serviceRequests.openJob": {
    id: "serviceRequests.openJob", method: "POST", path: "/s3/service-requests/open-job", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "openServiceRequestJob",
    summary: "The office answers a customer's request: opens a job at the request's site (jobs.create's own path — the SLA timer derived, never typed) and links the request to it, in one unit of work. A request is answered once; the link is final.",
  },
  "serviceRequests.hold": {
    id: "serviceRequests.hold", method: "POST", path: "/s3/service-requests/hold", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "holdServiceRequest",
    summary: "A phoned-in call the office cannot open a job for yet — the site's agreement is missing a term with no default — recorded as a request at that site, so it waits in Intake instead of being lost. createServiceRequest's own path; the dispatcher is the requester. It is opened from Intake once Contracts sets the term.",
  },
  "media.get": {
    id: "media.get", method: "GET", path: "/media", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3", "S6"], carrier: "query", sdkMethod: "getMedia",
    summary: "One stored photo, returned inline as a data: URL — read through the gateway under the same row security as the request it was sent with. A surface never receives a bucket URL.",
  },
  // ---- S3 ----
  "dispatch.assign": {
    id: "dispatch.assign", method: "POST", path: "/s3/assign", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "assignCrew",
    summary: "The one gated door. A crew that does not clear the whole service window is refused in plain words and nothing is written to assignments. Satisfies the job's SLA timer on success — the response the cascade is timing.",
  },
  "dispatch.candidates": {
    id: "dispatch.candidates", method: "GET", path: "/s3/dispatch/candidates", kind: "query", auth: "bearer",
    surfaces: ["S3"], carrier: "query", sdkMethod: "candidateCrews",
    summary: "A DRY RUN of the same gate dispatch.assign enforces, over every active crew in the job's region — nothing is written. What a dispatcher reads before deciding, not a second gate with its own opinion.",
  },
  "dispatch.release": {
    id: "dispatch.release", method: "POST", path: "/s3/release", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "releaseAssignment",
    summary: "Release a crew from a job that has not yet started (state still 'assigned') and return it to 'created' for re-dispatch. Once field execution has begun this is refused by name — that is a cancellation or a reassignment conversation, not a release.",
  },
  "jobs.transition": {
    id: "jobs.transition", method: "POST", path: "/s3/jobs/transition", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "transitionJob",
    summary: "The office's hand on a job's state: waiting on the customer (quote requested, quote submitted, approved or declined; held mid-job and resumed), closing out a dispatched job the crew finished off-device (any field state to complete), cancelling one before the crew is on site (the crew is released with it), and what blocks the invoice (needs pricing, waiting on a PO or pictures, an invoice kicked back). Only the edges OFFICE_JOB_TRANSITIONS lists; anything else is refused by name as an illegal transition.",
  },
  "jobs.addNote": {
    id: "jobs.addNote", method: "POST", path: "/s3/jobs/note", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "addJobNote",
    summary: "Write a note on a job. Append-only — a correction is a newer note — and internal: RLS shows notes to the office in the job's region and to nobody outside it. jobs.list carries the newest.",
  },
  "manager.overview": {
    id: "manager.overview", method: "GET", path: "/s3/manager", kind: "query", auth: "bearer",
    surfaces: ["S3"], carrier: "none", sdkMethod: "managerOverview",
    summary: "The company on one page for leadership: billed and completed this month against the same point last month, first-visit fixes, days per step from request to invoiced, labour against paid time, unbilled and unassigned work, expiring credentials, eight weeks of completed vs. invoiced, each branch, and the team. Org-wide, so only a principal or ops_leadership login at parent scope may call it (seesManagerOverview); anyone else is refused 403.",
  },
  "jobs.setReturnTrip": {
    id: "jobs.setReturnTrip", method: "POST", path: "/s3/jobs/return-trip", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "setReturnTrip",
    summary: "Flag or clear a job as owing a second visit. Set by hand, never read out of note text. Does not bump the job's version — a flag is not a state change a device's offline log should be superseded by.",
  },
  "jobs.detail": {
    id: "jobs.detail", method: "GET", path: "/s3/jobs/detail", kind: "query", auth: "bearer",
    surfaces: ["S3"], carrier: "query", sdkMethod: "jobDetail",
    summary: "One job as dispatch reads it: the board row, the site contact, every visit (assignment) with its logged span, every photo, every internal note, every customer update — drafts too — and the customer thread. RLS decides; nothing here filters.",
  },
  "jobs.conversation": {
    id: "jobs.conversation", method: "GET", path: "/jobs/conversation", kind: "query", auth: "bearer",
    surfaces: ["S6"], carrier: "query", sdkMethod: "jobConversation",
    summary: "What a customer reads about its job beyond the state: the updates dispatch PUBLISHED and the thread. A draft, an internal note, a crew or a photo key is not here — RLS (0016) returns only published updates to a customer.",
  },
  "jobs.saveUpdate": {
    id: "jobs.saveUpdate", method: "POST", path: "/s3/jobs/update", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "saveJobUpdate",
    summary: "Write or edit a DRAFT of what the customer is told, usually from an internal note. A draft is invisible to the customer; a published update cannot be edited (0016's trigger) — a correction is a new update.",
  },
  "jobs.publishUpdate": {
    id: "jobs.publishUpdate", method: "POST", path: "/s3/jobs/update/publish", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "publishJobUpdate",
    summary: "Publish a draft update to the customer. Once, by name: a second publish is refused as already_published. Delivery is the customer finding it in the portal — no email or push is sent.",
  },
  "jobs.postMessage": {
    id: "jobs.postMessage", method: "POST", path: "/jobs/message", kind: "mutation", auth: "bearer",
    surfaces: ["S3", "S6"], carrier: "body", sdkMethod: "postJobMessage",
    summary: "Write in the job's customer thread. The office (S3) and the customer (S6) post through the same door; which side wrote it is the caller's namespace, never a field. Append-only.",
  },
  // ---- item 4: the device shift grant (D-2a) — this device, this crew, this window ----
  "devices.list": {
    id: "devices.list", method: "GET", path: "/s2/devices", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listDevices",
    summary: "Registered hardware — ours and firms' own tablets and phones alike (D-2a: provisioning is a credential grant, not a shipment).",
  },
  "devices.register": {
    id: "devices.register", method: "POST", path: "/s2/devices", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "registerDevice",
    summary: "Record a physical device. firmId ties it to hardware the firm already owns; absent, it is ours (INTERNAL_ORG).",
  },
  "devices.grantShift": {
    id: "devices.grantShift", method: "POST", path: "/s2/devices/grant", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "grantDeviceShift",
    summary: "The primitive: this device, this crew, this technician, this window. What auth.deviceLogin mints a token against. Refused if the technician is not on the named crew, the crew is inactive, or the device already holds an overlapping grant.",
  },
  // ---- S5: what a technician reads before replaying a sync batch ----
  "jobs.mine": {
    id: "jobs.mine", method: "GET", path: "/s5/jobs/mine", kind: "query", auth: "bearer",
    surfaces: ["S5"], carrier: "none", sdkMethod: "myJobs",
    summary: "Jobs assigned to this shift's crew, unreleased and still open — finished, cancelled or aborted work drops off (FIELD_CLOSED_STATES). Each carries what a crew needs at the curb — the job number, the site's name, address and primary contact — and the checklist items already done. The field layer's own read — no employment shape, no compliance detail, no other crew's board.",
  },
  "punches.mine": {
    id: "punches.mine", method: "GET", path: "/s5/punches/mine", kind: "query", auth: "bearer",
    surfaces: ["S5"], carrier: "query", sdkMethod: "myPunches",
    summary: "The signed-in technician's own shift punches between two instants (at most 35 days apart), oldest first — every shift and every device they punched on, and nobody else's (0033). What the timesheet pairs into spans.",
  },
  "jobs.attachMedia": {
    id: "jobs.attachMedia", method: "POST", path: "/s5/jobs/media", kind: "mutation", auth: "bearer",
    surfaces: ["S5"], carrier: "body", sdkMethod: "attachJobMedia",
    summary: "One photo or the customer's signature onto a job this device's crew holds, as base64 in the body (0034). JPEG, PNG or HEIC by the file's own bytes — a signature is a PNG — at most PHOTO_MAX_BYTES, at most JOB_MEDIA_MAX per job. Idempotent by the device's mutationId: a retried upload answers with the row it already wrote.",
  },
  "jobs.wrapUp": {
    id: "jobs.wrapUp", method: "POST", path: "/s5/jobs/wrap-up", kind: "mutation", auth: "bearer",
    surfaces: ["S5"], carrier: "body", sdkMethod: "wrapUpJob",
    summary: "Close a visit from the field (0034): complete the job, in progress, and record how — Complete or Quote needed — with the notes, the signature or why there is none, and for a quote the RTU measurements. Every rule (WRAP_UP_MIN_PHOTOS, QUOTE_MIN_PHOTOS, the measurements) is checked against the media already uploaded, not the device's word. Idempotent by wrapUpId. A quote's QUOTE job is opened by the worker, not here.",
  },
  "sync.replay": {
    id: "sync.replay", method: "POST", path: "/s5/sync", kind: "mutation", auth: "bearer",
    surfaces: ["S5"], carrier: "body", sdkMethod: "replaySync",
    summary: "Replay a device's offline log in device order. The device is the source of intent; the server is the source of truth.",
  },
  "events.stream": {
    id: "events.stream", method: "GET", path: "/events", kind: "stream", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "events",
    summary: "Server-sent domain events, filtered to the subscriber's region. At-least-once; dedupe on eventId.",
  },
  "brand.setTheme": {
    id: "brand.setTheme", method: "POST", path: "/s2/brand/theme", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "setBrandTheme",
    summary: "Store a tenant's white-label theme. Validated against the ink schedule BEFORE it is a row: a theme that would break the portal is a 422 with the ratio, not a stylesheet nobody looks at until a customer does.",
  },
  "brand.theme": {
    id: "brand.theme", method: "GET", path: "/brand/theme", kind: "system", auth: "none",
    surfaces: WHITE_LABEL_SURFACES, carrier: "query", sdkMethod: "brandTheme",
    summary: "The stored theme for a host, as the stylesheet the shell installs. Unauthenticated because a portal is branded on its sign-in screen, before a principal exists; an unknown host gets Rankine's own plate rather than a 404, so the route cannot be used to ask which tenants exist.",
  },
  // ---- item 8: S1's anonymous door (00 §2.8 build order item 8) ----
  /**
   * THE COVERAGE CLAIM, AND ITS CEILING.
   *
   * 05 §S1: "coverage read from hierarchy, not hard-coded". This answers with
   * the metros our `regions` rows name and NOTHING else — no crew density, no
   * availability, no response window. That restraint is the product decision,
   * not an oversight: D7a (the response obligation behind a named owner) and
   * OQ6 (the single-site constraint) set the ceiling on what this surface may
   * promise, neither is written down yet, and action plan F9 is where it gets
   * written. Until it is, a page that says "we are in Dallas" is a statement
   * of presence; a page that says how fast we answer is a commitment nobody at
   * the gateway can enforce. `ac_public_coverage()` is the mechanism — a
   * SECURITY DEFINER function that returns two columns, so widening the claim
   * is a reviewed diff on a migration rather than a SELECT someone extends.
   *
   * `system` because it runs without a session, the way `brand.theme` does.
   * It is still BOUND — as the anonymous principal — before it reads: 0007's
   * lesson was a week of unbound sweeps reading zero rows and reporting green.
   */
  "coverage.list": {
    id: "coverage.list", method: "GET", path: "/coverage", kind: "system", auth: "none",
    surfaces: ["S1"], carrier: "none", sdkMethod: "coverage",
    summary: "The metros we serve, read from the regions table — code and name, nothing else. No density, no availability, no response window: the ceiling on what S1 may promise is D7a/OQ6 and it is not written yet (F9).",
  },
  /**
   * A visitor becomes a principal for as long as it takes to say who they are.
   *
   * Shaped like `auth.deviceLogin` rather than invented: it mints a token and
   * a `sessions` row (`principal_kind = 'anonymous'`, which 0001 has admitted
   * since the bootstrap), so an anonymous write arrives at the unit of work
   * the same way every other write does — a verified token, a live session, a
   * scope binding, an audit row with a real actor and a real session id. The
   * alternative, an unauthenticated POST straight onto `leads`, would have
   * been the one mutation in the system with no principal behind it.
   *
   * Minted LAZILY, on the first submit — not at page load. A session row per
   * visitor is a write per page view, and the site has to stand up with the
   * gateway unreachable (the registry's degraded line), which a boot-time
   * round trip would quietly undo.
   */
  "auth.anonymousSession": {
    id: "auth.anonymousSession", method: "POST", path: "/auth/anonymous", kind: "login", auth: "none",
    surfaces: ["S1"], carrier: "none", sdkMethod: "anonymousSession",
    summary: "Mint a short-lived anonymous token bound to PROSPECT/UNASSIGNED for S1's intake. Carries no roles and no scope below the prospect root; the only thing it can do is the two writes below.",
  },
  "leads.submit": {
    id: "leads.submit", method: "POST", path: "/s1/leads", kind: "mutation", auth: "bearer",
    surfaces: ["S1"], carrier: "body", sdkMethod: "submitLead",
    summary: "A stranger asks us to call them. Lands in PROSPECT/UNASSIGNED — tenancy is total, so a lead is owned before an account exists (arc 1). The submitter can never read it back.",
  },
  "callRecords.record": {
    id: "callRecords.record", method: "POST", path: "/s1/call-records", kind: "mutation", auth: "bearer",
    surfaces: ["S1"], carrier: "body", sdkMethod: "recordCall",
    summary: "A visitor used the call button. Recorded against the lead when there is one, and against nothing when there is not — an inbound call is a fact whether or not a form was filled.",
  },
  // ---- item 10: S4, the HQ view. Two reads of the rollup and nothing else:
  // `SURFACES.S4.writes` is [] and 0010 grants the gateway no write on
  // hq_metrics, so there is no request path here that changes anything.
  "hq.metrics": {
    id: "hq.metrics", method: "GET", path: "/s4/metrics", kind: "query", auth: "bearer",
    surfaces: ["S4"], carrier: "query", sdkMethod: "hqMetrics",
    summary: "Every figure in the HQ register for every region, as of the latest rollup (or the close of a given day), with the moment it was computed. Read from hq_metrics alone — the operational tables are the worker's to read.",
  },
  "hq.history": {
    id: "hq.history", method: "GET", path: "/s4/metrics/history", kind: "query", auth: "bearer",
    surfaces: ["S4"], carrier: "query", sdkMethod: "hqHistory",
    summary: "One figure's daily closing values per region over the last N days (default 30, at most 90) — the trend behind a number on the dashboard.",
  },
  // ---- item 11: PROCUREMENT. The office's purchasing (S2) and the vendor's
  // side of the same rows (S7). Reads are served to both; what each may see
  // and change is 0011's.
  "vendors.list": {
    id: "vendors.list", method: "GET", path: "/procurement/vendors", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "none", sdkMethod: "listVendors",
    summary: "Vendors — the office sees every one; a vendor sees its own row. RLS (0011), not a WHERE.",
  },
  "vendors.create": {
    id: "vendors.create", method: "POST", path: "/s2/procurement/vendors", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createVendor",
    summary: "Record a vendor WITH its tenant root in one unit of work: the organizations row and the vendors row share an id, in the region it is administered from.",
  },
  "receivingPoints.list": {
    id: "receivingPoints.list", method: "GET", path: "/procurement/receiving-points", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "none", sdkMethod: "listReceivingPoints",
    summary: "Our receiving points. A vendor sees the ones its issued orders ship to — code, tier, address — and never a customer's name, because the row carries none.",
  },
  "receivingPoints.create": {
    id: "receivingPoints.create", method: "POST", path: "/s2/procurement/receiving-points", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createReceivingPoint",
    summary: "Record a receiving point: a code, a tier (location stock, regional hub, national), the region and the address.",
  },
  "catalog.list": {
    id: "catalog.list", method: "GET", path: "/procurement/catalog", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "listCatalog",
    summary: "A vendor's catalogue: each item with the price in effect today (accepted) and any proposal waiting on the office.",
  },
  "catalog.addItem": {
    id: "catalog.addItem", method: "POST", path: "/s2/procurement/catalog", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "addCatalogItem",
    summary: "Add an item to a vendor's catalogue — the vendor's SKU, a description, the unit. It has no price until the vendor proposes one and the office accepts it.",
  },
  "prices.propose": {
    id: "prices.propose", method: "POST", path: "/s7/procurement/prices", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "proposePrice",
    summary: "A vendor proposes a price for one of its items from a day. Arrives proposed whatever the request says (0011); applies only once the office accepts it.",
  },
  "prices.withdraw": {
    id: "prices.withdraw", method: "POST", path: "/s7/procurement/prices/withdraw", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "withdrawPrice",
    summary: "A vendor withdraws its own proposal before the office decides it: proposed → withdrawn, nothing else.",
  },
  "prices.decide": {
    id: "prices.decide", method: "POST", path: "/s2/procurement/prices/decide", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "decidePrice",
    summary: "The office accepts or rejects a proposed price. Accepting closes the price in effect at the proposal's first day; two accepted prices at once are refused by the EXCLUDE constraint.",
  },
  "pos.list": {
    id: "pos.list", method: "GET", path: "/procurement/pos", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "listPurchaseOrders",
    summary: "Purchase orders — every one for the office; a vendor's own once issued (a draft is ours).",
  },
  "pos.detail": {
    id: "pos.detail", method: "GET", path: "/procurement/pos/detail", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "purchaseOrder",
    summary: "One purchase order: its lines with ordered, shipped, received and invoiced quantities, the receiving point, and every shipment, receipt, invoice and return against it.",
  },
  "pos.create": {
    id: "pos.create", method: "POST", path: "/s2/procurement/pos", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createPurchaseOrder",
    summary: "Raise a draft purchase order to a vendor for a receiving point. Each line takes the item's ACCEPTED price today and keeps it; an item with none is refused by name.",
  },
  "pos.issue": {
    id: "pos.issue", method: "POST", path: "/s2/procurement/pos/issue", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "issuePurchaseOrder",
    summary: "Send a draft to the vendor: draft → issued. From here the vendor can see it.",
  },
  "pos.cancel": {
    id: "pos.cancel", method: "POST", path: "/s2/procurement/pos/cancel", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "cancelPurchaseOrder",
    summary: "Cancel an order nothing has shipped against yet.",
  },
  "pos.acknowledge": {
    id: "pos.acknowledge", method: "POST", path: "/s7/procurement/pos/acknowledge", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "acknowledgePurchaseOrder",
    summary: "The vendor accepts an issued order and says when it will ship: issued → acknowledged with a promised ship date. The one change a vendor makes to an order (0011).",
  },
  "shipments.record": {
    id: "shipments.record", method: "POST", path: "/s7/procurement/shipments", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "recordShipment",
    summary: "The vendor records a shipment against an acknowledged order — the day, the carrier, the tracking, and quantities per line, never more than ordered.",
  },
  "receipts.record": {
    id: "receipts.record", method: "POST", path: "/s2/procurement/receipts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordReceipt",
    summary: "The office records what arrived, per line, never more than ordered. The order is received when every line is.",
  },
  "vendorInvoices.submit": {
    id: "vendorInvoices.submit", method: "POST", path: "/s7/procurement/invoices", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "submitVendorInvoice",
    summary: "The vendor submits an invoice against an order. The gateway matches it three ways — price against the order, quantity against the receipt — and records matched or held with every reason.",
  },
  "vendorInvoices.list": {
    id: "vendorInvoices.list", method: "GET", path: "/procurement/invoices", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "listVendorInvoices",
    summary: "Vendor invoices with their lines and their match verdict — every one for the office, its own for a vendor.",
  },
  "rmas.request": {
    id: "rmas.request", method: "POST", path: "/s2/procurement/rmas", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "requestReturn",
    summary: "The office asks to return part of a received line, with the reason. Never more than was received.",
  },
  "rmas.respond": {
    id: "rmas.respond", method: "POST", path: "/s7/procurement/rmas/respond", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "respondToReturn",
    summary: "The vendor answers a requested return once: authorized with its RMA number, or rejected with a reason.",
  },
  "rmas.list": {
    id: "rmas.list", method: "GET", path: "/procurement/rmas", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "listReturns",
    summary: "Returns — every one for the office, its own for a vendor.",
  },
  "system.health": {
    id: "system.health", method: "GET", path: "/healthz", kind: "system", auth: "none",
    surfaces: ["S1", ...AUTHENTICATED], carrier: "none", sdkMethod: "health",
    summary: "Liveness and the enabled surface list. The shell's degraded probe.",
  },
} as const satisfies Record<string, OperationSpec>;

export type OperationId = keyof typeof OPERATIONS;
export type Operation = (typeof OPERATIONS)[OperationId];
export const OPERATION_IDS = Object.freeze(Object.keys(OPERATIONS)) as readonly OperationId[];

/**
 * The mutations that write the caller's own session or users row and nothing
 * of the business's: ending a session, and the Account button (0033). The
 * only writes a read-only surface (S4) is served.
 */
export const OWN_IDENTITY_MUTATIONS: readonly OperationId[] = ["auth.logout", "account.update", "account.setAvatar", "account.changePassword"];

export const isOperationId = (s: string): s is OperationId => Object.hasOwn(OPERATIONS, s);

/** `METHOD /path` → operation. The gateway's dispatcher and the generator both index by this. */
export const routeKey = (op: Pick<Operation, "method" | "path">): string => `${op.method} ${op.path}`;

/** Which of an operation's surfaces a principal of this namespace may call it as. */
export const surfacesFor = (
  id: OperationId,
  namespaceOf: (s: SurfaceId) => string,
  namespace: string,
): readonly SurfaceId[] => OPERATIONS[id].surfaces.filter((s) => namespaceOf(s) === namespace);

// ---------------------------------------------------------------------------
// Wire shapes. Declared beside the catalogue so the generated client is typed
// without a type-checker in the generator: `OperationIO[id]["input"]` is a
// type reference the emitter writes as text.
//
// These mirror the gateway handlers' inputs and outputs structurally. The
// domain's own types (Mutation, SyncOutcome, Refusal, Resolution) live below
// contracts in the dependency order and are not imported here; the
// integration suite is what holds the two shapes together.
// ---------------------------------------------------------------------------
export type LoginInput = { readonly email: string; readonly password: string; readonly surface: SurfaceId };
export type LoginOutput = {
  /** Also set as the httpOnly `ac_session` cookie. A browser surface ignores this field; devices and tests use it as a bearer. */
  readonly token: string;
  readonly expiresAt: string;
  readonly context: Pick<HierarchyContext, "path" | "parent" | "regions" | "activeRegionId" | "segment">;
};
export type LogoutOutput = { readonly ok: true; readonly sessionId: string };

/**
 * 0033 — THE ACCOUNT BUTTON. What a person sets about themselves. Presence is
 * what they say, never a state the system derived, so a surface draws it as a
 * word and never in a state ink.
 */
export const PRESENCES = ["available", "busy", "away", "off"] as const;
export type Presence = (typeof PRESENCES)[number];
export const PRESENCE_LABEL: Readonly<Record<Presence, string>> = { available: "Available", busy: "Busy", away: "Away", off: "Off shift" };
export const STATUS_NOTE_MAX = 80;
export const DISPLAY_NAME_MAX = 80;
/** A thumbnail, not a photo: the browser scales the picture to a small square before sending it. */
export const AVATAR_MAX_BYTES = 64 * 1024;
export const ACCOUNT_PASSWORD_MIN = 12;
export const ACCOUNT_PASSWORD_MAX = 256;
export type AvatarContentType = "image/jpeg" | "image/png";
export type MyAccountWire = {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly presence: Presence;
  readonly statusNote: string | null;
  /** Base64 bytes and their type, or null for no picture. */
  readonly avatar: { readonly contentType: AvatarContentType; readonly image: string } | null;
  readonly passwordChangedAt: string | null;
};
export type UpdateMyAccountInput = { readonly displayName?: string; readonly presence?: Presence; readonly statusNote?: string | null };
export type SetAvatarInput = { readonly dataBase64: string | null };
export type ChangePasswordInput = { readonly currentPassword: string; readonly newPassword: string };
export type ChangePasswordOutput = { readonly ok: true; readonly passwordChangedAt: string; readonly endedSessions: number };

/**
 * A technician's own credential plus the hardware in their hands. Unlike
 * `auth.login`, the surface is not a caller's choice among several — S5 is
 * the only one this mints for — so there is no `surface` field to lie about.
 */
export type DeviceLoginInput = { readonly hardwareId: string; readonly email: string; readonly password: string };
export type DeviceLoginOutput = {
  readonly token: string;
  readonly expiresAt: string;
  readonly crewId: string;
  readonly crewLabel: string;
  readonly context: Pick<HierarchyContext, "path" | "parent" | "regions" | "activeRegionId" | "segment">;
};

export type AuthorOverrideInput = {
  readonly contractId: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly termKey: string;
  /** Money is a string of integer minor units. A JSON number is a double and is refused. */
  readonly termValue: unknown;
  /** ISO date, inclusive. */
  readonly effectiveFrom: string;
  /** ISO date, exclusive; null or absent = open-ended. */
  readonly effectiveTo?: string | null;
  readonly orgId: string;
  readonly regionId: string;
};
export type AuthorOverrideOutput = { readonly id: string; readonly eventId: string };

export type ResolvedTermsInput = {
  /** Defaults to the principal's org. */
  readonly orgId?: string;
  /** Defaults to `site`. */
  readonly tier?: Tier;
  readonly nodeId: string;
  /** ISO date. Defaults to the gateway's today. A disputed February job reprices against February by saying "February" here. */
  readonly asOf?: string;
  /** Comma-separated on the query string. Absent = every registered term; the trace panel asks for one. */
  readonly termKeys?: string;
};
export type TraceStepWire = {
  readonly tier: Tier; readonly id: string;
  readonly outcome: "no_override" | "candidate" | "won" | "not_walked";
  readonly value?: unknown; readonly overrideId?: string; readonly note?: string;
};
export type ResolutionWire = {
  readonly termKey: string;
  readonly value: unknown;
  readonly wonAt: { readonly tier: Tier; readonly id: string } | "fallback";
  readonly policy: TermPolicy;
  readonly trace: readonly TraceStepWire[];
  readonly asOf: string;
};
export type ResolvedTermsOutput = {
  readonly resolved: Readonly<Record<string, ResolutionWire>>;
  readonly refused: Readonly<Record<string, { readonly code: string; readonly message: string }>>;
};

// ---- C1 wire shapes ----
export type RegionWire = { readonly id: string; readonly code: string; readonly name: string; readonly timezone: string; readonly minCrewDensity: number; readonly active: boolean };
export type ListRegionsOutput = { readonly regions: readonly RegionWire[] };

export type OrganizationKind = "customer" | "subcontractor";
export type ListOrganizationsInput = { readonly kind?: OrganizationKind };
/** Residential or commercial (R1: fixed once set). Customers only — null for every other kind of organization. */
export type CustomerSegment = "residential" | "commercial";
export type OrganizationWire = { readonly id: string; readonly name: string; readonly kind: OrganizationKind; readonly segment: CustomerSegment | null; readonly externalRef: string | null; readonly active: boolean; readonly regionNodeCount: number };
export type ListOrganizationsOutput = { readonly organizations: readonly OrganizationWire[] };

export type CreateOrganizationInput = {
  readonly name: string;
  readonly kind?: OrganizationKind;
  /** Defaults to commercial — this is the multi-node door. A home goes through customers.createResidential. */
  readonly segment?: CustomerSegment;
  readonly externalRef?: string;
  /** The first region node — created in the same unit of work. A parent never exists without a place we serve it from. */
  readonly firstRegionNode: { readonly regionId: string; readonly name: string };
};
export type CreateOrganizationOutput = { readonly orgId: string; readonly regionNodeId: string; readonly eventId: string };

export type CreateResidentialInput = {
  /** The household's name, e.g. "Turner residence". */
  readonly name: string;
  /** OUR service region the home is dispatched from. */
  readonly regionId: string;
  /** Where the home is. line1 is required — it names the household. */
  readonly address: AddressWire;
  readonly externalRef?: string;
  /** The homeowner, recorded as the household's primary contact. */
  readonly contact?: { readonly name: string; readonly phone?: string; readonly email?: string };
};
export type CreateResidentialOutput = {
  readonly orgId: string; readonly regionNodeId: string; readonly locationId: string; readonly siteId: string;
  /** The standard home agreement the home is on from today, already active. */
  readonly contractId: string;
  readonly eventId: string;
  /** D14's caveats from opening the household's location, if any. */
  readonly caveats: readonly string[];
};
export type LeadWire = {
  readonly id: string; readonly source: string; readonly contact: LeadContact; readonly requestedMetro: string | null;
  readonly createdAt: string;
  /** The home (site) this lead became, once converted. */
  readonly convertedAccountId: string | null;
};
export type ListLeadsInput = { readonly include?: "waiting" | "all" };
export type ListLeadsOutput = { readonly leads: readonly LeadWire[] };
export type ConvertLeadInput = {
  readonly leadId: string;
  readonly regionId: string;
  readonly address: AddressWire;
  /** Defaults to the name the visitor gave. */
  readonly name?: string;
};
export type ConvertLeadOutput = CreateResidentialOutput & { readonly leadId: string };

export type AccountTierWire = "region" | "location" | "site";
export type AccountWire = {
  readonly id: string; readonly tier: AccountTierWire; readonly name: string; readonly parentId: string | null; readonly regionId: string;
  readonly customerGroup: string | null; readonly externalRef: string | null; readonly timezone: string | null; readonly active: boolean;
  /** Ancestor ids, region node first, this node last. */
  readonly path: readonly string[];
  /** Item 9: the node's address as recorded, or null. See AddressWire. */
  readonly address: AddressWire | null;
};
export type ListAccountsInput = { readonly orgId: string };
export type ListAccountsOutput = { readonly nodes: readonly AccountWire[] };

export type CreateAccountInput = {
  readonly orgId: string;
  readonly tier: AccountTierWire;
  /** Absent for a region node (its parent is the organization); required below. */
  readonly parentId?: string;
  /** OUR region — for tier "region" only, where it is the binding. Below that it derives from the parent edge and is refused as an input. */
  readonly regionId?: string;
  readonly name: string;
  readonly customerGroup?: string;
  readonly externalRef?: string;
  readonly address?: Readonly<Record<string, unknown>>;
  readonly timezone?: string;
};
export type CreateAccountOutput = {
  readonly id: string; readonly regionId: string; readonly eventId: string;
  /** Admitted with a caveat rather than refused — "D14 rule not set for <region>". S2 renders these as a banner, not a modal. */
  readonly caveats: readonly string[];
};

export type MoveAccountInput = { readonly accountId: string; readonly newParentId: string };
export type MoveAccountOutput = { readonly id: string; readonly regionId: string; readonly movedDescendants: number; readonly eventId: string };

export type UpdateAccountInput = {
  readonly accountId: string;
  readonly name?: string; readonly customerGroup?: string | null; readonly externalRef?: string | null;
  readonly address?: Readonly<Record<string, unknown>> | null; readonly timezone?: string | null; readonly active?: boolean;
};
export type UpdateAccountOutput = { readonly id: string; readonly eventId: string };

// ---- item 9: the site record ----
/**
 * The shape `accounts.address` carries when it carries one. Every field is
 * optional because an address arrives as a customer wrote it on a contract;
 * `lat`/`lng` are what the imagery and any routing need, and are absent until
 * someone records them (accounts.update takes the whole object).
 */
export type AddressWire = {
  readonly line1?: string; readonly line2?: string; readonly city?: string; readonly state?: string; readonly postal?: string; readonly country?: string;
  readonly lat?: number; readonly lng?: number;
};
export type EquipmentKind = "rtu" | "split" | "package" | "ahu" | "chiller" | "boiler" | "heat_pump" | "mini_split" | "vrf" | "exhaust" | "mau" | "controls" | "other";
export type EquipmentWire = {
  readonly id: string; readonly siteId: string; readonly kind: EquipmentKind; readonly label: string | null;
  readonly manufacturer: string | null; readonly model: string; readonly serial: string | null;
  readonly installedOn: string | null;
  /** Integer thousandths of a ton, as a string on the wire — the rule every `*_milli` and `*_minor` column follows. Null when unknown. */
  readonly tonnageMilli: string | null; readonly active: boolean;
  /** The latest completed/invoiced job that named this unit, by its window end. Null when none has. Derived, never stored. */
  readonly lastServicedAt: string | null; readonly lastServicedJobId: string | null; readonly lastServicedServiceCode: string | null;
  /** How many jobs have named this unit, any state. */
  readonly jobCount: number;
};
export type ListEquipmentInput = { readonly siteId: string };
export type ListEquipmentOutput = { readonly equipment: readonly EquipmentWire[] };
export type RegisterEquipmentInput = {
  readonly siteId: string; readonly kind: EquipmentKind; readonly model: string;
  readonly label?: string; readonly manufacturer?: string; readonly serial?: string; readonly installedOn?: string;
  /** Integer thousandths of a ton, as a string ("7500" is 7.5 tons). */
  readonly tonnageMilli?: string;
};
export type RegisterEquipmentOutput = { readonly id: string; readonly eventId: string };

export type ContactRole = "site_manager" | "facilities" | "accounts_payable" | "security" | "other";
export type ContactWire = {
  readonly id: string;
  /** The node the contact is recorded at — the site itself, or an ancestor it inherits from. */
  readonly accountId: string; readonly accountName: string; readonly accountTier: AccountTierWire;
  readonly role: ContactRole; readonly name: string; readonly phone: string | null; readonly email: string | null; readonly note: string | null;
  readonly isPrimary: boolean; readonly active: boolean;
};
export type ListContactsInput = { readonly accountId: string };
export type ListContactsOutput = { readonly contacts: readonly ContactWire[] };
export type SetContactInput = {
  readonly accountId: string; readonly role?: ContactRole; readonly name: string;
  readonly phone?: string; readonly email?: string; readonly note?: string; readonly isPrimary?: boolean;
  /** Replace this contact rather than add one. */
  readonly contactId?: string; readonly active?: boolean;
};
export type SetContactOutput = { readonly id: string; readonly eventId: string };

export type InvoiceLineWire = {
  readonly id: string; readonly locationId: string; readonly jobId: string | null; readonly description: string;
  /** Integer thousandths, as a string on the wire. */
  readonly quantityMilli: string;
  /** Integer minor units, as strings on the wire (money is never a float). */
  readonly unitPriceMinor: string; readonly amountMinor: string;
};
export type InvoiceWire = {
  readonly id: string; readonly billToTier: "parent" | "region" | "location" | "site"; readonly billToId: string; readonly contractId: string;
  readonly billingPath: BillingPath; readonly periodStart: string | null; readonly periodEnd: string | null;
  /** The whole invoice's total — the consolidated header — as minor units. */
  readonly totalMinor: string; readonly currency: string; readonly issuedAt: string | null; readonly dueAt: string | null;
  /** 0030, derived from the invoice's payments: never stored. Past due is `open` or `partially_paid` with `dueAt` behind now — a reading, not a status. */
  readonly status: InvoiceStatus;
  /** Succeeded payments against the WHOLE invoice, minor units — set beside `totalMinor`, not `subtotalMinor`. */
  readonly paidMinor: string;
  readonly voidedAt: string | null; readonly voidReason: string | null;
  /** The lines this principal may see on it, at the node asked for. */
  readonly lines: readonly InvoiceLineWire[];
  /** Sum of `lines` — what the node asked for was billed on this invoice. */
  readonly subtotalMinor: string;
};
export type InvoiceStatus = "draft" | "open" | "partially_paid" | "paid" | "void";
export const invoiceStatusOf = (r: { readonly issuedAt: string | null; readonly voidedAt: string | null; readonly totalMinor: string; readonly paidMinor: string }): InvoiceStatus =>
  r.voidedAt ? "void"
    : !r.issuedAt ? "draft"
    : BigInt(r.paidMinor) >= BigInt(r.totalMinor) ? "paid"
    : BigInt(r.paidMinor) > 0n ? "partially_paid"
    : "open";
export const PAYMENT_METHODS = ["ach", "wire", "check", "card", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentState = "pending" | "succeeded" | "failed" | "returned" | "refunded";
export type PaymentWire = {
  readonly id: string; readonly invoiceId: string; readonly amountMinor: string; readonly currency: string;
  readonly method: PaymentMethod; readonly reference: string | null; readonly state: PaymentState;
  readonly receivedAt: string; readonly returnedAt: string | null; readonly returnReason: string | null;
};
export type ListPaymentsInput = { readonly invoiceId: string };
export type ListPaymentsOutput = { readonly payments: readonly PaymentWire[] };
export type RecordPaymentInput = {
  readonly invoiceId: string; readonly amountMinor: string; readonly method: PaymentMethod;
  readonly reference?: string; readonly receivedAt?: string;
};
export type ReturnPaymentInput = { readonly paymentId: string; readonly reason: string; readonly as?: "returned" | "refunded" };
/** What a payment write left the invoice at, so the caller need not refetch to know. */
export type PaymentOutput = { readonly payment: PaymentWire; readonly invoiceStatus: InvoiceStatus; readonly paidMinor: string; readonly eventId: string };
export type VoidInvoiceInput = { readonly invoiceId: string; readonly reason: string };
export type VoidInvoiceOutput = { readonly invoiceId: string; readonly voidedAt: string; readonly eventId: string };
export type ListInvoicesInput = { readonly siteId?: string; readonly locationId?: string };
export type ListInvoicesOutput = { readonly invoices: readonly InvoiceWire[] };

export type SiteImageryInput = { readonly siteId: string };
export type SiteImageryOutput = {
  readonly siteId: string;
  readonly lat: number | null; readonly lng: number | null;
  /** A data: URL the card can draw, or null with `unavailable` saying why. */
  readonly image: string | null;
  readonly attribution: string | null;
  readonly unavailable: "not_configured" | "no_coordinates" | "provider_unreachable" | null;
};
/** The zooms sites.mapTile serves, and how many tiles either side of the site's own tile it will reach at each. The surface clamps its pan to the same box. */
export const MAP_ZOOM_MIN = 10, MAP_ZOOM_MAX = 19, MAP_TILE_REACH = 4;
/** Web-mercator tile coordinates of a point at zoom z, fractional — floor them for the tile, keep the fraction for where in it. */
export const tileOf = (lat: number, lng: number, z: number): { readonly x: number; readonly y: number } => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};
export type LocateSiteInput = { readonly siteId: string };
export type LocateSiteOutput = {
  readonly siteId: string;
  readonly lat: number | null; readonly lng: number | null;
  /** recorded: it already had coordinates; located: the geocoder found it and they were written. Otherwise why there is no pin. */
  readonly outcome: "recorded" | "located" | "not_configured" | "no_address" | "not_found" | "provider_unreachable";
  readonly eventId: string | null;
};
export type SiteMapTileInput = { readonly siteId: string; readonly z: number; readonly x: number; readonly y: number };
export type SiteMapTileOutput = {
  readonly z: number; readonly x: number; readonly y: number;
  /** A data: URL of the tile, or null with `unavailable` saying why. */
  readonly image: string | null;
  readonly attribution: string | null;
  readonly unavailable: "not_configured" | "no_coordinates" | "provider_unreachable" | null;
};

// ---- C2 wire shapes ----
export type ContractKind = "msa" | "amendment" | "location_agreement" | "project_sow" | "residential_membership" | "one_time";
export type BillingPath = "one_time" | "residential_membership" | "enterprise_sla" | "project";
export type ContractState = "draft" | "active" | "expired" | "terminated";

export type ContractWire = {
  readonly id: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly kind: ContractKind;
  readonly parentContractId: string | null;
  readonly billingPath: BillingPath;
  /**
   * OUR region, the one this agreement is administered from. Carried on the
   * wire because `terms.authorOverride` requires a region and the override
   * screen authors against a contract — without it the surface would have to
   * guess one, which is how a term override ends up in the wrong shard.
   */
  readonly regionId: string;
  readonly signedAt: string;
  /** ISO date, inclusive. */
  readonly effectiveFrom: string;
  /** ISO date, exclusive; null = evergreen. */
  readonly effectiveTo: string | null;
  readonly diagnosticDataRightsReserved: boolean;
  readonly documentKey: string | null;
  readonly state: ContractState;
};
export type ListContractsInput = { readonly orgId: string; readonly scopeId?: string };
export type ListContractsOutput = { readonly contracts: readonly ContractWire[] };

export type CreateContractInput = {
  readonly orgId: string;
  /** OUR region — for a parent-scope agreement only, the one scope with no edge to derive it from. Refused below it, the same rule C1 applies to a node. */
  readonly regionId?: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly kind: ContractKind;
  /** An amendment's MSA. Required for kind "amendment" and refused when the named agreement has already ended. */
  readonly parentContractId?: string;
  readonly billingPath: BillingPath;
  readonly signedAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  /** OQ5, per record. No default: absent or non-boolean is a 400, because nothing was refused on its merits — no position was stated. */
  readonly diagnosticDataRightsReserved: boolean;
  readonly documentKey?: string;
};
export type CreateContractOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };

export type TransitionContractInput = { readonly contractId: string; readonly to: "active" | "expired" | "terminated" };
export type TransitionContractOutput = { readonly id: string; readonly state: ContractState; readonly eventId: string };

export type TermOverrideWire = {
  readonly id: string; readonly contractId: string; readonly scopeTier: Tier; readonly scopeId: string;
  readonly termKey: string; readonly termValue: unknown;
  readonly effectiveFrom: string; readonly effectiveTo: string | null;
};
export type ListTermOverridesInput = { readonly orgId: string; readonly termKey?: string; readonly contractId?: string };
export type ListTermOverridesOutput = { readonly overrides: readonly TermOverrideWire[] };

/** The register as data. S2 builds the override form from this rather than hard-coding eleven inputs. */
export type TermRegisterOutput = { readonly terms: readonly TermPolicy[] };

// ---- C4 wire shapes ----
export type FirmStatus = "onboarding" | "active" | "suspended" | "terminated";
export type FirmWire = {
  /** The firm's id IS its organization's id — one tenant root, one operational row, created together. */
  readonly id: string;
  readonly legalName: string;
  readonly status: FirmStatus;
  /** OUR region the firm is dispatched from — its crews' home by default and the shard its rows live in. */
  readonly regionId: string;
  /** D13. Measured from day one. */
  readonly settlementTermsDays: number;
  readonly msaSignedAt: string | null;
  /** OQ5, firm side. Always stated — the row does not exist otherwise. */
  readonly diagnosticDataRightsReserved: boolean;
  readonly w9DocumentKey: string | null;
  readonly crewCount: number;
  readonly activeCrewCount: number;
};
export type ListFirmsInput = { readonly status?: FirmStatus };
export type ListFirmsOutput = { readonly firms: readonly FirmWire[] };

export type CreateFirmInput = {
  readonly legalName: string;
  /** OUR region — the one the firm is dispatched from. An input here, because a firm is a root and has no edge to derive it from. */
  readonly regionId: string;
  readonly settlementTermsDays: number;
  /** OQ5, firm side. No default: absent or non-boolean is a 400 — no position was stated. */
  readonly diagnosticDataRightsReserved: boolean;
  readonly msaSignedAt?: string;
  readonly w9DocumentKey?: string;
  readonly externalRef?: string;
};
export type CreateFirmOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };

export type UpdateFirmInput = {
  readonly firmId: string;
  readonly legalName?: string;
  readonly settlementTermsDays?: number;
  readonly msaSignedAt?: string | null;
  readonly w9DocumentKey?: string | null;
  /** A step on the ladder. Refused by name when it is not an edge from the current status. */
  readonly status?: Exclude<FirmStatus, "onboarding">;
};
export type UpdateFirmOutput = { readonly id: string; readonly status: FirmStatus; readonly eventId: string };

export type EmploymentType = "employed" | "subcontracted";
/**
 * 0024. A technician is never on a crew: their dispatch unit is a `service`
 * crew of one technician. An `install` crew is installers only. Mirrors
 * CREW_KINDS in packages/schema (the column's CHECK); a test holds them equal.
 */
export const CREW_KINDS = ["service", "install"] as const;
export type CrewKind = (typeof CREW_KINDS)[number];
/** 0024. Install work goes to an install crew; service and commissioning go to a technician. Mirrors JOB_WORK_CLASSES in packages/schema. */
export const JOB_WORK_CLASSES = ["service", "install", "commissioning"] as const;
export type JobWorkClass = (typeof JOB_WORK_CLASSES)[number];
/** The one place the work decides the crew. Read by jobs.create, dispatch.candidates and dispatch.assign; 0024's trigger says the same in SQL. */
export const crewKindFor = (work: JobWorkClass): CrewKind => (work === "install" ? "install" : "service");

/**
 * 0027 — an emergency job is settled at the rate × its card's multiplier,
 * stored as basis points so the money path carries no float. The wire says it
 * as the decimal a person types.
 */
export const EMERGENCY_MULTIPLIER_DEFAULT = "1.5";
/** "1.5" → 15000; null for anything that is not a multiplier of at least 1 with at most two places. */
export const multiplierBp = (v: string): number | null => {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 10_000 + Number((m[2] ?? "").padEnd(2, "0")) * 100;
  return bp >= 10_000 ? bp : null;
};
/** 15000 → "1.5", 20000 → "2", 12500 → "1.25". */
export const multiplierOf = (bp: number): string => {
  const whole = Math.floor(bp / 10_000), frac = String(bp % 10_000).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};
/**
 * 0025 — THE SERVICE CATALOGUE. What a job may be opened for, and which kind
 * of work each one is: the work class of a job is its code's, never typed
 * beside it. Mirrored into `service_codes` (tools/ci/emit-schema.ts), which
 * jobs.service_code references. Adding a code is a reviewed diff here.
 */
export const SERVICE_CATALOG = [
  { code: "DIAGNOSTIC", label: "Diagnostic", workClass: "service" },
  { code: "HVAC-REPAIR", label: "Repair", workClass: "service" },
  { code: "PM-VISIT", label: "Preventive maintenance", workClass: "service" },
  { code: "WARRANTY-CALLBACK", label: "Warranty callback", workClass: "service" },
  // 0034: what a technician's "Quote needed" opens. Service class, so it needs no project: once the customer approves, sales opens the install under one.
  { code: "QUOTE", label: "Quote", workClass: "service" },
  { code: "EQUIPMENT-CHANGEOUT", label: "Equipment changeout", workClass: "install" },
  { code: "NEW-INSTALL", label: "New installation", workClass: "install" },
  { code: "DUCTWORK", label: "Ductwork", workClass: "install" },
  { code: "STARTUP-COMMISSIONING", label: "Startup & commissioning", workClass: "commissioning" },
] as const satisfies readonly { readonly code: string; readonly label: string; readonly workClass: JobWorkClass }[];
export type ServiceCode = (typeof SERVICE_CATALOG)[number]["code"];
export type ServiceEntry = (typeof SERVICE_CATALOG)[number];
/** The catalogue entry for a code, or undefined for one that is not in it (a job opened before 0025). */
export const serviceOf = (code: string): ServiceEntry | undefined => SERVICE_CATALOG.find((s) => s.code === code);
/** A code's words, falling back to the code itself for a job opened before the catalogue. */
export const serviceLabel = (code: string): string => serviceOf(code)?.label ?? code.replace(/_/g, " ");

/** One set of words for the three, read by every surface that shows them. */
export const CREW_KIND_LABEL: Readonly<Record<CrewKind, string>> = { service: "Technician's unit", install: "Install crew" };
export const JOB_WORK_CLASS_LABEL: Readonly<Record<JobWorkClass, string>> = { service: "Service", install: "Install", commissioning: "Commissioning" };
/** What the gate would say about this crew's documents today — not a clearance, a summary S2 reads. */
export type CrewDocumentSummary = {
  /** The kinds the gate requires for this employment shape (domain/compliance/gate.ts REQUIRED). */
  readonly required: readonly string[];
  /** Required kinds with a VERIFIED document on file whose window includes today. */
  readonly satisfied: readonly string[];
  /** Required kinds with a document on file but none verified. */
  readonly unverified: readonly string[];
  /** Required kinds with a verified document on file, none of which covers today. */
  readonly expired: readonly string[];
  /** Required kinds with nothing on file at all. */
  readonly missing: readonly string[];
  /** Earliest valid_to among the verified documents that satisfy a required kind, ISO date, or null. */
  readonly earliestExpiry: string | null;
};
export type CrewWire = {
  readonly id: string;
  readonly label: string;
  readonly employmentType: EmploymentType;
  readonly kind: CrewKind;
  readonly firmId: string | null;
  readonly homeRegionId: string;
  readonly active: boolean;
  readonly documents: CrewDocumentSummary;
};
export type ListCrewsInput = { readonly firmId?: string; readonly regionId?: string };
export type ListCrewsOutput = { readonly crews: readonly CrewWire[] };

export type CreateCrewInput = {
  readonly label: string;
  readonly employmentType: EmploymentType;
  /** Omitted: `service` — one technician's unit. */
  readonly kind?: CrewKind;
  /** Required for a subcontracted crew; refused for an employed one. */
  readonly firmId?: string;
  /** OUR region the crew is normally dispatched from. Its tenancy region on insert. */
  readonly homeRegionId: string;
};
export type CreateCrewOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };
export type UpdateCrewInput = { readonly crewId: string; readonly label?: string; readonly active?: boolean };
export type UpdateCrewOutput = { readonly id: string; readonly eventId: string };

/** 0020: the office roles that read and write a technician's home address. Every other role reads it as restricted. One list, read by the gateway, S2 and the demo. */
export const TECHNICIAN_ADDRESS_ROLES = ["account_owner", "principal"] as const;
export const mayReadTechnicianAddress = (roles: readonly string[]): boolean => roles.some((r) => (TECHNICIAN_ADDRESS_ROLES as readonly string[]).includes(r));

/**
 * 0020. Mirrors TECHNICIAN_SPECIALTIES in packages/schema (the column's CHECK); a test holds them equal.
 * The kinds of equipment a person is qualified on. Since 0025, never the kind of work they do — that is
 * their role (TECHNICIAN_ROLES): "install" and "ductwork" left this list for it.
 */
export const TECHNICIAN_SPECIALTIES = ["residential_hvac", "light_commercial", "commercial_rtu", "refrigeration", "chillers_boilers", "controls_bas"] as const;
export type TechnicianSpecialty = (typeof TECHNICIAN_SPECIALTIES)[number];
/** 0024. `technician` goes on a service unit (alone); the others on an install crew. Mirrors TECHNICIAN_ROLES in packages/schema. */
export const TECHNICIAN_ROLES = ["technician", "lead_installer", "installer", "helper"] as const;
export type TechnicianRole = (typeof TECHNICIAN_ROLES)[number];
/** The crew kind a role belongs on. */
export const crewKindForRole = (role: TechnicianRole): CrewKind => (role === "technician" ? "service" : "install");
export const TECHNICIAN_ROLE_LABEL: Readonly<Record<TechnicianRole, string>> = { technician: "Technician", lead_installer: "Lead installer", installer: "Installer", helper: "Helper" };
export type TechnicianWire = {
  readonly id: string;
  /** Null: one of ours. */
  readonly firmId: string | null;
  readonly crewId: string | null;
  readonly name: string;
  readonly phone: string | null;
  /** Null when none is recorded OR when this principal may not read it — `addressRestricted` says which. */
  readonly homeAddress: AddressWire | null;
  /** True for every role outside TECHNICIAN_ADDRESS_ROLES: the address exists or not, and this reader is not told. */
  readonly addressRestricted: boolean;
  readonly role: TechnicianRole;
  readonly specialties: readonly TechnicianSpecialty[];
  readonly homeRegionId: string;
  readonly active: boolean;
};
export type ListTechniciansInput = { readonly firmId?: string };
export type ListTechniciansOutput = { readonly technicians: readonly TechnicianWire[] };
export type RecordTechnicianInput = {
  readonly name: string;
  /** Omit for one of ours. */
  readonly firmId?: string;
  readonly crewId?: string;
  readonly phone?: string;
  /** Account owners and principals only. */
  readonly homeAddress?: AddressWire;
  /** Omitted: `technician`. */
  readonly role?: TechnicianRole;
  readonly specialties: readonly TechnicianSpecialty[];
  /** OUR region they work from; the row's tenancy region. */
  readonly homeRegionId: string;
};
export type RecordTechnicianOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };
export type UpdateTechnicianInput = {
  readonly technicianId: string;
  readonly name?: string;
  /** Empty string clears it. */
  readonly phone?: string;
  /** Account owners and principals only. Null clears it. */
  readonly homeAddress?: AddressWire | null;
  readonly role?: TechnicianRole;
  readonly specialties?: readonly TechnicianSpecialty[];
  /** Null takes them off their crew. */
  readonly crewId?: string | null;
  readonly active?: boolean;
};
export type UpdateTechnicianOutput = { readonly id: string; readonly eventId: string };

export type CredentialKind = "insurance" | "license" | "certification" | "background_check";
export type CredentialWire = {
  readonly id: string;
  readonly crewId: string;
  readonly kind: CredentialKind;
  readonly identifier: string;
  /** ISO dates, both inclusive — the gate covers the whole service window with them. */
  readonly validFrom: string;
  readonly validTo: string;
  readonly documentKey: string | null;
  readonly verifiedAt: string | null;
  readonly verifiedBy: string | null;
};
export type ListCredentialsInput = { readonly crewId?: string; readonly firmId?: string };
export type ListCredentialsOutput = { readonly credentials: readonly CredentialWire[] };
export type RecordCredentialInput = {
  readonly crewId: string;
  readonly kind: CredentialKind;
  readonly identifier: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly documentKey?: string;
};
export type RecordCredentialOutput = { readonly id: string; readonly eventId: string };
export type VerifyCredentialInput = { readonly credentialId: string };
export type VerifyCredentialOutput = { readonly id: string; readonly verifiedAt: string; readonly verifiedBy: string; readonly eventId: string };

export type RateCardWire = {
  readonly id: string;
  readonly firmId: string;
  readonly serviceCode: string;
  /** Integer minor units as a STRING. A JSON number is a double. */
  readonly rateMinor: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  /** Exclusive; null = open. */
  readonly effectiveTo: string | null;
  /** 0027: what an emergency job is settled at, as a decimal string of the rate — "1.5" is time and a half. */
  readonly emergencyMultiplier: string;
  /** The rate × the multiplier, integer minor units as a string — what one unit of emergency work is settled at. */
  readonly emergencyRateMinor: string;
};
export type ListRateCardsInput = { readonly firmId: string; readonly serviceCode?: string };
export type ListRateCardsOutput = { readonly rateCards: readonly RateCardWire[] };
export type SetRateCardInput = {
  readonly firmId: string;
  readonly serviceCode: string;
  /** Integer minor units as a string of digits. */
  readonly rateMinor: string;
  readonly currency: string;
  /** ISO date the new rate takes effect. The row in effect that day is closed at it. */
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  /** 0027: a decimal string, at least "1" and at most two places — "1.5", "2", "1.25". Omitted: "1.5". */
  readonly emergencyMultiplier?: string;
};
export type SetRateCardOutput = { readonly id: string; readonly closedId: string | null; readonly eventId: string };

// ---- item 7 wire shapes: the firm's own writes, and the statement ----
export type SubmitCredentialInput = {
  readonly crewId: string;
  readonly kind: CredentialKind;
  readonly identifier: string;
  readonly validFrom: string;
  readonly validTo: string;
  /** The stored file's key, from the upload path. Optional in Phase 1: a document may be identified before it is scanned. */
  readonly documentKey?: string;
};
export type SubmitCredentialOutput = { readonly id: string; readonly crewId: string; readonly eventId: string };
/** No employmentType, no firmId, no homeRegionId: each is the principal's, derived. */
export type EnrollCrewInput = {
  readonly label: string;
  /** 0024. Omitted: `service` — one technician's unit. */
  readonly kind?: CrewKind;
};
export type EnrollCrewOutput = { readonly id: string; readonly firmId: string; readonly regionId: string; readonly eventId: string };
export type RetireCrewInput = { readonly crewId: string; readonly label?: string; readonly active?: boolean };
export type RetireCrewOutput = { readonly id: string; readonly eventId: string };

export type SettlementState = "draft" | "issued" | "acknowledged" | "disputed" | "paid";
export type SettlementWire = {
  readonly id: string;
  readonly firmId: string;
  readonly regionId: string;
  /** ISO dates: the period's first day, and its last day inclusive. */
  readonly periodFrom: string;
  readonly periodTo: string;
  /** Integer minor units as a STRING. A JSON number is a double. */
  readonly totalMinor: string;
  readonly currency: string;
  readonly state: SettlementState;
  readonly issuedAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly disputedAt: string | null;
  readonly disputeReason: string | null;
  readonly lineCount: number;
};
export type ListSettlementsInput = { readonly firmId?: string; readonly state?: SettlementState };
export type ListSettlementsOutput = { readonly settlements: readonly SettlementWire[] };
export type SettlementLineWire = {
  readonly id: string;
  readonly settlementId: string;
  readonly jobId: string;
  readonly serviceCode: string | null;
  readonly siteName: string | null;
  readonly rateCardId: string;
  /** Integer minor units as a string. */
  readonly rateMinor: string | null;
  /** Integer thousandths as a string. */
  readonly quantityMilli: string;
  readonly amountMinor: string;
};
export type ListSettlementLinesInput = { readonly settlementId: string };
export type ListSettlementLinesOutput = { readonly settlementId: string; readonly lines: readonly SettlementLineWire[] };
export type AcknowledgeSettlementInput = { readonly settlementId: string };
export type AcknowledgeSettlementOutput = { readonly id: string; readonly state: "acknowledged"; readonly acknowledgedAt: string; readonly eventId: string };
export type DisputeSettlementInput = { readonly settlementId: string; readonly reason: string };
export type DisputeSettlementOutput = { readonly id: string; readonly state: "disputed"; readonly disputedAt: string; readonly eventId: string };

// ---- item 4 wire shapes: the job, dispatch's dry run and release, the device shift grant ----
export type JobPriority = "emergency" | "urgent" | "routine" | "pm";
export type JobStateWire =
  | "created" | "assigned" | "reassigned" | "en_route" | "on_site" | "in_progress" | "awaiting_parts"
  | "complete" | "reopened" | "invoiced" | "cancelled" | "aborted"
  | "quote_requested" | "quote_submitted" | "awaiting_customer"
  | "needs_pricing" | "awaiting_po" | "awaiting_pictures" | "invoice_trouble";

/**
 * The work is done: every state between a technician finishing and the
 * invoice standing. A job here is not open field work — the board, the HQ
 * rollup and "last serviced" all read it as finished — whatever is still
 * blocking the bill. One list, because six copies of "complete or invoiced"
 * each missed the states 0014 added.
 */
export const WORK_DONE_STATES: readonly JobStateWire[] = Object.freeze(["complete", "needs_pricing", "awaiting_po", "awaiting_pictures", "invoiced", "invoice_trouble"]);

/**
 * The moves the office makes by hand (`jobs.transition`, S3) — the job
 * waiting on the customer or coming back from it, and closing out a job the
 * crew finished. Apart from closing out, a subset of packages/domain's
 * JOB_TRANSITIONS (the domain test holds it there), kept
 * here because a surface reads it to offer the buttons and a surface may not
 * import the domain. Before dispatch the wait is a quote: requested,
 * submitted, then approved back to `created` or declined to `cancelled`.
 * Mid-job it is `awaiting_customer` — an approval, or access — and back to
 * `in_progress`. After the work, whatever blocks the invoice (pricing, a PO,
 * pictures) and back to `complete`; an invoice kicked back and re-sent.
 * Assignment, release and the field's own moves keep their own doors.
 *
 * Closing out: a dispatched job the crew finished without moving it on a
 * device — a paper ticket, a phoned-in finish, a dead tablet — the office
 * moves to `complete` from any field state (OFFICE_CLOSE_OUT_FROM). Except
 * in_progress → complete, these are the office's edges alone and deliberately
 * NOT in the domain's JOB_TRANSITIONS, which is what a device may take: a
 * technician still walks en route → on site → in progress → complete.
 *
 * Cancelling after dispatch: before the crew is on site (`assigned`,
 * `en_route`) the office may cancel the job outright; the gateway releases the
 * crew in the same unit of work. Once the crew is on site, stopping is an
 * abort — the field's, with what it bills — not a cancellation.
 */
export const OFFICE_JOB_TRANSITIONS: Readonly<Partial<Record<JobStateWire, readonly JobStateWire[]>>> = Object.freeze({
  created: ["quote_requested"],
  quote_requested: ["quote_submitted", "cancelled"],
  quote_submitted: ["created", "cancelled"],
  // Closing out a dispatched job (OFFICE_CLOSE_OUT_FROM), or cancelling it before the crew is on site.
  assigned: ["complete", "cancelled"],
  en_route: ["complete", "cancelled"],
  on_site: ["awaiting_customer", "complete"],
  in_progress: ["awaiting_customer", "complete"],
  awaiting_parts: ["complete"],
  awaiting_customer: ["in_progress", "complete"],
  // After the work: what blocks the invoice, and back to ready-to-invoice.
  complete: ["needs_pricing", "awaiting_po", "awaiting_pictures"],
  needs_pricing: ["complete"],
  awaiting_po: ["complete"],
  awaiting_pictures: ["complete"],
  invoiced: ["invoice_trouble"],
  invoice_trouble: ["invoiced"],
});

/** What drops off a crew's list (`jobs.mine`): the work is done, cancelled or aborted. The assignment stays live on finished work, so the device's late time, parts and photos still apply. */
export const FIELD_CLOSED_STATES: readonly JobStateWire[] = Object.freeze([...WORK_DONE_STATES, "cancelled", "aborted"]);

/** The field states the office may close a dispatched job out of — each has `complete` in OFFICE_JOB_TRANSITIONS. */
export const OFFICE_CLOSE_OUT_FROM: readonly JobStateWire[] = Object.freeze(["assigned", "en_route", "on_site", "in_progress", "awaiting_parts", "awaiting_customer"]);

/** 0024: what an install was sold under. `foremanId` is the person who sold it — an active internal user holding `foreman`. */
export type ProjectState = "planned" | "active" | "closed" | "cancelled";
export type ProjectWire = {
  readonly id: string; readonly orgId: string; readonly regionId: string; readonly contractId: string;
  readonly customer: string; readonly name: string;
  readonly foremanId: string | null; readonly foremanName: string | null;
  /** ISO datetimes; end exclusive. */
  readonly serviceWindowStart: string; readonly serviceWindowEnd: string;
  readonly state: ProjectState;
  readonly installJobs: number;
};
/** A person a project may be sold by: an active internal user holding `foreman`. */
export type ForemanWire = { readonly id: string; readonly name: string };
export type ListProjectsInput = { readonly orgId?: string };
export type ListProjectsOutput = { readonly projects: readonly ProjectWire[]; readonly foremen: readonly ForemanWire[] };
export type CreateProjectInput = {
  readonly contractId: string;
  readonly name: string;
  /** Who sold it. */
  readonly foremanId: string;
  readonly serviceWindowStart: string;
  readonly serviceWindowEnd: string;
};
export type CreateProjectOutput = { readonly id: string; readonly orgId: string; readonly regionId: string; readonly eventId: string };

export type CreateJobInput = {
  readonly siteId: string;
  /** 0025: a code in SERVICE_CATALOG. Its work class is the job's — install is never an emergency and names its project. */
  readonly serviceCode: string;
  readonly priority?: JobPriority;
  /** ISO datetime, inclusive. */
  readonly serviceWindowStart: string;
  /** ISO datetime, exclusive. */
  readonly serviceWindowEnd: string;
  readonly contractId?: string;
  /** 0024: required when the service code is install work — the project it was sold under, whose foreman sold it. */
  readonly projectId?: string;
  /** Item 9: the units at the site this job is about. Each must be equipment at `siteId`; the row lands in job_equipment in the same unit of work. */
  readonly equipmentIds?: readonly string[];
};
export type CreateJobOutput = {
  readonly id: string; readonly orgId: string; readonly regionId: string;
  /** The timer this job opened, derived from the site's resolved sla_response — never typed in. */
  readonly slaTimerId: string; readonly dueAt: string; readonly responseTerm: string;
  readonly eventId: string;
};

/** What a job carries on a board, in the middle of its life. Same shape for S2 (any state) and S3 (region-locked by RLS). */
export type JobWire = {
  readonly id: string; readonly siteId: string;
  /** The site's name as RLS lets this principal see the row — null when the account row is not visible to it (item 7: a firm sees the site it was sent to). */
  readonly siteName: string | null;
  /** The site's address as recorded (accounts.address), or null — same RLS as the name. */
  readonly siteAddress: AddressWire | null;
  readonly contractId: string | null; readonly projectId: string | null;
  readonly serviceCode: string; readonly priority: JobPriority; readonly state: JobStateWire;
  /** 0024: which kind of crew this job is dispatched to (`crewKindFor`). */
  readonly workClass: JobWorkClass;
  readonly serviceWindowStart: string; readonly serviceWindowEnd: string; readonly version: number; readonly openedAt: string;
  /** When the job entered its current state: the latest job_state_events row into it, or openedAt when none has been written (a job still "created"). */
  readonly stateChangedAt: string;
  readonly regionId: string; readonly orgId: string;
  /** The customer's segment (0019) — null where the organization row is not visible to this principal (a firm). */
  readonly customerSegment: CustomerSegment | null;
  /** The crew currently holding this job, unreleased — null once dispatched-and-released or never assigned. */
  readonly currentCrewId: string | null; readonly currentCrewLabel: string | null;
  /** The open assignment's own id — what `dispatch.release` names. Null exactly when currentCrewId is null. */
  readonly currentAssignmentId: string | null;
  /** The open (unsatisfied) SLA timer, if this job still has one. */
  readonly slaDueAt: string | null; readonly slaEscalationStage: number | null; readonly slaSatisfiedAt: string | null;
  /** 0015: a second visit is owed. The office's flag, set by hand. */
  readonly returnTrip: boolean;
  /** 0015: the newest job_notes row — null when there is none, and always null outside the office (RLS: notes are internal). */
  readonly latestNote: { readonly body: string; readonly at: string } | null;
};
// ---- item 6: service requests ----
export type ServiceRequestPriority = "emergency" | "urgent" | "routine";
export type CreateServiceRequestInput = {
  readonly siteId: string;
  readonly priority?: ServiceRequestPriority;
  readonly description: string;
};
export type CreateServiceRequestOutput = { readonly id: string; readonly orgId: string; readonly regionId: string; readonly eventId: string };
export type ServiceRequestWire = {
  readonly id: string; readonly siteId: string; readonly siteName: string;
  readonly priority: ServiceRequestPriority; readonly description: string;
  readonly requestedBy: string; readonly createdAt: string;
  /** The job the office opened against this request, if one has been. */
  readonly jobId: string | null; readonly jobState: JobStateWire | null;
  readonly orgId: string; readonly regionId: string;
  /** The customer's segment (0019), so the office can tell a homeowner from a building. */
  readonly customerSegment: CustomerSegment | null;
  /** Oldest first. Fetch each with `media.get`. */
  readonly photos: readonly RequestPhotoWire[];
  /**
   * For a waiting request read by the office (S2, S3): the no-default term the
   * site's agreement is missing today, so a job cannot be opened until
   * Contracts sets it. Derived on every read, never stored — it clears itself
   * the moment the term exists. Null otherwise, and always null for S6.
   */
  readonly waitingOnTerm: string | null;
};
/** A photo sent with a request: what it is, never where it is stored. */
export type RequestPhotoWire = { readonly id: string; readonly contentType: PhotoContentType; readonly bytes: number };
export type PhotoContentType = "image/jpeg" | "image/png" | "image/heic";
/** 10 MiB: a phone photo, not a video. Checked by the gateway on the decoded bytes, and by S6 before it sends. */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTOS_PER_REQUEST = 6;
const HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
/**
 * What the bytes are, by their own signature — never the file name or the
 * type a browser claims. Null for anything that is not a photo we take. The
 * gateway decides with it; S6 asks it first so a refusal arrives before the upload.
 */
export const sniffPhoto = (b: Uint8Array): PhotoContentType | null => {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(4, 8)) === "ftyp" && HEIF_BRANDS.includes(String.fromCharCode(...b.subarray(8, 12)))) return "image/heic";
  return null;
};
export type AttachPhotoInput = { readonly requestId: string; readonly dataBase64: string };
export type AttachPhotoOutput = { readonly id: string; readonly requestId: string; readonly contentType: PhotoContentType; readonly bytes: number; readonly eventId: string };
/** The site comes from the request, never from the input; priority defaults to the one the customer declared. */
export type OpenRequestJobInput = {
  readonly requestId: string;
  readonly serviceCode: string;
  readonly priority?: JobPriority;
  readonly serviceWindowStart: string;
  readonly serviceWindowEnd: string;
};
export type OpenRequestJobOutput = CreateJobOutput & { readonly requestId: string };
export type GetMediaInput = { readonly id: string };
export type GetMediaOutput = { readonly id: string; readonly contentType: PhotoContentType; readonly image: string };
export type ListServiceRequestsInput = { readonly siteId?: string };
export type ListServiceRequestsOutput = { readonly requests: readonly ServiceRequestWire[] };

/** One site a dispatcher may open a job at, and the customer it belongs to. */
export type SiteWire = {
  readonly id: string; readonly name: string; readonly orgId: string; readonly orgName: string; readonly regionId: string;
  readonly address: AddressWire | null;
};
export type ListSitesOutput = { readonly sites: readonly SiteWire[] };

export type ListJobsInput = { readonly state?: string };
export type ListJobsOutput = { readonly jobs: readonly JobWire[] };

/** Who may read manager.overview: leadership, at parent scope — the only binding under which every table it reads is org-wide. */
export const MANAGER_ROLES = ["principal", "ops_leadership"] as const;
export const seesManagerOverview = (p: { readonly roles: readonly string[]; readonly scopeTier: string }): boolean =>
  p.scopeTier === "parent" && p.roles.some((r) => (MANAGER_ROLES as readonly string[]).includes(r));

export type ManagerWaitStep = "request_to_scheduled" | "scheduled_to_on_site" | "on_site_to_finished" | "finished_to_invoiced";
export type CredentialStanding = "ok" | "at_risk" | "breached";
export type ManagerOverviewOutput = {
  readonly asOf: string;
  /** Month to date, and the same span of last month. Money is minor units as text, per currency. */
  readonly billed: readonly { readonly currency: string; readonly minor: string; readonly priorMinor: string }[];
  readonly completed: { readonly now: number; readonly prior: number };
  /** Of the jobs completed this month, those with one visit and no return trip owed. */
  readonly fixedFirstVisit: number;
  /** Average days for the jobs that finished each step in the last 30 days; null when none did. */
  readonly waits: readonly { readonly step: ManagerWaitStep; readonly avgDays: number | null; readonly jobs: number }[];
  /** Labour logged by active employed crews over the last 7 days, and how many such crews there are. */
  readonly labor: { readonly hours: number; readonly techs: number };
  /** Finished, not invoiced — counts by state. */
  readonly unbilled: { readonly complete: number; readonly needsPricing: number; readonly awaitingPo: number; readonly awaitingPictures: number; readonly invoiceTrouble: number };
  readonly urgentUnassigned: readonly { readonly regionId: string; readonly count: number }[];
  /** Active crews whose soonest current credential has lapsed, or lapses within 30 days. */
  readonly credentials: { readonly expired: number; readonly expiring: number };
  /** Active employed crews at 36 hours or more since Monday. */
  readonly nearOvertime: number;
  readonly weeks: readonly { readonly weekStart: string; readonly completed: number; readonly invoiced: number }[];
  readonly branches: readonly { readonly regionId: string; readonly name: string; readonly techs: number; readonly laborHours: number; readonly unbilled: number }[];
  readonly team: readonly {
    readonly userId: string; readonly name: string; readonly roles: readonly string[]; readonly branch: string;
    readonly onJob: boolean; readonly hoursThisWeek: number | null; readonly credential: CredentialStanding | null;
  }[];
};

/** S5's own read. No employment shape, no compliance detail — the field layer never sees either (09 §3.10, non-negotiable #9). */
/** The site as a crew needs it at the curb: what it is called, where it is, and who answers the phone there. */
export type FieldSiteWire = {
  readonly name: string; readonly address: AddressWire | null;
  /** The site's primary active contact, else its oldest active one; null when the site has none. */
  readonly contact: { readonly name: string; readonly phone: string | null } | null;
};
export type FieldJobWire = {
  /** Null only if row security hides the site from the device — the job stays on the list either way. */
  readonly id: string; readonly jobNo: string | null; readonly siteId: string; readonly site: FieldSiteWire | null;
  readonly serviceCode: string; readonly priority: JobPriority; readonly state: JobStateWire;
  readonly serviceWindowStart: string; readonly serviceWindowEnd: string; readonly version: number;
  /** The checklist item keys the server holds as done — what a device shows ticked before anything of its own is queued. */
  readonly checklistDone: readonly string[];
};
export type MyJobsOutput = { readonly jobs: readonly FieldJobWire[] };
export type MyPunchesInput = { readonly from: string; readonly to: string };

// ---- 0034: wrapping up a visit ----
/** Photos an ordinary completion needs (a before and an after), and what Quote needed needs. Partner answers, 2026-10-27. */
export const WRAP_UP_MIN_PHOTOS = 2;
export const QUOTE_MIN_PHOTOS = 10;
/** The most media one job carries — photos and the signature together. */
export const JOB_MEDIA_MAX = 40;
export const RTU_VOLTAGES = ["208-230/1", "208-230/3", "460/3", "575/3"] as const;
export const RTU_FUELS = ["gas", "electric", "heat_pump"] as const;
/** The fixed RTU set Quote needed requires, every field (partner, 2026-10-27). Dimensions in whole inches. */
export type WrapUpMeasurementsWire = {
  readonly tonnage: number; readonly voltage: (typeof RTU_VOLTAGES)[number]; readonly fuel: (typeof RTU_FUELS)[number];
  readonly unitLengthIn: number; readonly unitWidthIn: number; readonly unitHeightIn: number;
  readonly curbLengthIn: number; readonly curbWidthIn: number;
  readonly oldModel: string; readonly oldSerial: string;
};
const DIMENSIONS = { unitLengthIn: "unit length", unitWidthIn: "unit width", unitHeightIn: "unit height", curbLengthIn: "curb length", curbWidthIn: "curb width" } as const;
/**
 * What is wrong with a measurement set, in a technician's words, or null when
 * it is whole. One function, so the device's Submit and the gateway's refusal
 * name the same missing field the same way.
 */
export const measurementsFault = (m: unknown): string | null => {
  if (!m || typeof m !== "object") return "the measurements are missing";
  const r = m as Record<string, unknown>;
  if (typeof r.tonnage !== "number" || !(r.tonnage >= 1 && r.tonnage <= 150) || Math.round(r.tonnage * 2) !== r.tonnage * 2) return "tonnage (1 to 150 tons, in halves)";
  if (!RTU_VOLTAGES.includes(r.voltage as never)) return "voltage / phase";
  if (!RTU_FUELS.includes(r.fuel as never)) return "fuel";
  for (const [k, label] of Object.entries(DIMENSIONS)) if (typeof r[k] !== "number" || !Number.isInteger(r[k]) || (r[k] as number) < 1 || (r[k] as number) > 600) return `${label} in whole inches`;
  if (typeof r.oldModel !== "string" || r.oldModel.trim().length === 0 || r.oldModel.length > 80) return "the old unit's model";
  if (typeof r.oldSerial !== "string" || r.oldSerial.trim().length === 0 || r.oldSerial.length > 80) return "the old unit's serial";
  return null;
};
export type JobMediaKind = "photo" | "signature";
export type AttachJobMediaInput = {
  readonly jobId: string; readonly mutationId: string; readonly kind: JobMediaKind;
  readonly dataBase64: string; readonly capturedAt: string;
};
export type AttachJobMediaOutput = { readonly id: string; readonly jobId: string; readonly duplicate: boolean };
export type WrapUpOutcome = "complete" | "quote_needed";
export type WrapUpInput = {
  readonly jobId: string; readonly wrapUpId: string; readonly outcome: WrapUpOutcome; readonly submittedAt: string;
  readonly notes?: string; readonly measurements?: WrapUpMeasurementsWire;
  /** The mutationIds the photos were uploaded under (jobs.attachMedia). */
  readonly photoMutationIds: readonly string[];
  /** Exactly one of these two. */
  readonly signatureMutationId?: string; readonly customerAbsentReason?: string;
};
export type WrapUpOutput = { readonly jobId: string; readonly wrapUpId: string; readonly state: "complete"; readonly duplicate: boolean };
/** One tap of the shift clock (0033). `at` is the device's clock at the tap. */
export type ShiftPunchWire = { readonly id: string; readonly kind: "in" | "out"; readonly at: string };
export type MyPunchesOutput = { readonly punches: readonly ShiftPunchWire[] };

export type ComplianceRefusalWireItem = { readonly reason: "missing" | "expired_in_window" | "unverified" | "crew_inactive"; readonly credentialKind: string; readonly detail: string };
/** 0024: only crews of the kind the job's work needs are candidates (`crewKindFor`). */
export type CandidateCrewWire = {
  readonly crewId: string; readonly label: string; readonly employmentType: EmploymentType;
  readonly cleared: boolean;
  /** Present exactly when `cleared` is false — the same verdict `dispatch.assign` would return. */
  readonly refusal: ComplianceRefusalWireItem | null;
};
export type CandidateCrewsInput = { readonly jobId: string; readonly orgId: string; readonly regionId: string };
export type CandidateCrewsOutput = { readonly jobId: string; readonly candidates: readonly CandidateCrewWire[] };

export type ReleaseAssignmentInput = { readonly assignmentId: string; readonly orgId: string; readonly regionId: string; readonly reason?: string };
export type ReleaseAssignmentOutput = { readonly jobId: string; readonly eventId: string };
export type TransitionJobInput = { readonly jobId: string; readonly orgId: string; readonly regionId: string; readonly to: JobStateWire };
export type TransitionJobOutput = { readonly jobId: string; readonly state: JobStateWire; readonly version: number; readonly eventId: string };
export type JobNoteKind = "note" | "standing";
export type AddJobNoteInput = { readonly jobId: string; readonly orgId: string; readonly regionId: string; readonly body: string; readonly kind?: JobNoteKind };
export type AddJobNoteOutput = { readonly id: string; readonly jobId: string; readonly eventId: string };
export type SetReturnTripInput = { readonly jobId: string; readonly orgId: string; readonly regionId: string; readonly returnTrip: boolean };
export type SetReturnTripOutput = { readonly jobId: string; readonly returnTrip: boolean; readonly eventId: string };

// ---- 0016: job detail and customer communication ----
/** One visit: an assignment of a crew to the job, with the span its time entries cover inside it. */
export type JobVisitWire = {
  readonly id: string; readonly crewId: string; readonly crewLabel: string | null;
  readonly assignedAt: string; readonly releasedAt: string | null;
  /** First and last instant the crew logged time on this job during the assignment — null until it logs any. */
  readonly workStart: string | null; readonly workEnd: string | null;
};
export type JobMediaWire = { readonly id: string; readonly kind: string; readonly storageKey: string; readonly label: string | null; readonly capturedAt: string };
export type JobNoteWire = { readonly id: string; readonly body: string; readonly kind: JobNoteKind; readonly at: string; readonly authorName: string | null };
export type JobUpdateState = "draft" | "published";
export type JobUpdateWire = {
  readonly id: string; readonly sourceNoteId: string | null; readonly body: string; readonly state: JobUpdateState;
  readonly updatedAt: string; readonly publishedAt: string | null; readonly publishedByName: string | null;
};
/** The writer's name is null where the reader may not see the writer (a customer does not see office users). */
export type JobMessageWire = { readonly id: string; readonly authorKind: "customer" | "office"; readonly authorName: string | null; readonly body: string; readonly at: string };
export type JobContactWire = { readonly name: string; readonly phone: string | null; readonly email: string | null };
export type JobDetailInput = { readonly jobId: string };
export type JobDetailOutput = {
  readonly job: JobWire;
  /** The site's contact, or the nearest ancestor's — what a crew calls ahead. */
  readonly contact: JobContactWire | null;
  readonly visits: readonly JobVisitWire[];
  readonly media: readonly JobMediaWire[];
  readonly notes: readonly JobNoteWire[];
  readonly updates: readonly JobUpdateWire[];
  readonly messages: readonly JobMessageWire[];
};
export type JobConversationInput = { readonly jobId: string };
export type JobConversationOutput = { readonly jobId: string; readonly updates: readonly JobUpdateWire[]; readonly messages: readonly JobMessageWire[] };
export type SaveJobUpdateInput = {
  readonly jobId: string; readonly orgId: string; readonly regionId: string; readonly body: string;
  /** Present: edit that draft. Absent: a new draft. */
  readonly updateId?: string;
  /** The internal note the update was written from, if any. */
  readonly sourceNoteId?: string;
};
export type SaveJobUpdateOutput = { readonly id: string; readonly state: "draft"; readonly eventId: string };
export type PublishJobUpdateInput = { readonly updateId: string };
export type PublishJobUpdateOutput = { readonly id: string; readonly publishedAt: string; readonly eventId: string };
export type PostJobMessageInput = { readonly jobId: string; readonly body: string };
export type PostJobMessageOutput = { readonly id: string; readonly authorKind: "customer" | "office"; readonly eventId: string };

export type DeviceKind = "android_pilot" | "yocto_tablet" | "web_fallback";
export type DeviceWire = {
  readonly id: string; readonly hardwareId: string; readonly kind: DeviceKind;
  readonly firmId: string | null; readonly active: boolean; readonly orgId: string; readonly regionId: string;
};
export type ListDevicesInput = { readonly firmId?: string };
export type ListDevicesOutput = { readonly devices: readonly DeviceWire[] };
export type RegisterDeviceInput = {
  readonly hardwareId: string; readonly kind: DeviceKind;
  /**
   * The device-held public key a future challenge-response login would verify against. Base64. Not yet checked at login — see claude/19_S3_S5_Dispatch_and_Field.md.
   * Required for hardware; optional for `web_fallback`, a browser that holds no key of its own (stored empty).
   */
  readonly publicKey?: string;
  /** Where this hardware is provisioned. Required — a device is an operational row and region_id is never null. */
  readonly regionId: string;
  /** Hardware the firm already owns (D-2a). Absent: the device is ours. */
  readonly firmId?: string;
};
export type RegisterDeviceOutput = { readonly id: string; readonly orgId: string; readonly regionId: string; readonly eventId: string };

export type GrantShiftInput = {
  readonly deviceId: string; readonly crewId: string;
  /**
   * The technician's login (users.id). Absent: the one active login on the crew — since 0024 a
   * technician's unit is their own, so the unit names the person. Refused `not_crew_member` when
   * the crew has no active login or more than one (a shared crew made before 0024).
   */
  readonly technicianId?: string;
  /** ISO datetime, inclusive. */
  readonly windowStart: string;
  /** ISO datetime, exclusive. */
  readonly windowEnd: string;
};
export type GrantShiftOutput = { readonly id: string; readonly orgId: string; readonly regionId: string; readonly eventId: string };

export type AssignInput = { readonly jobId: string; readonly crewId: string; readonly orgId: string; readonly regionId: string };
export type ComplianceRefusalWire = {
  readonly ok: false;
  readonly reason: "missing" | "expired_in_window" | "unverified" | "crew_inactive";
  readonly credentialKind: string;
  readonly detail: string;
};
export type AssignOutput =
  | { readonly ok: true; readonly assignmentId: string; readonly clearanceId: string; readonly eventId: string }
  | { readonly ok: false; readonly refusal: ComplianceRefusalWire; readonly eventId: string };

export type SyncMutationWire = {
  readonly mutationId: string;
  readonly deviceId: string;
  readonly deviceSeq: number;
  readonly entityTable: string;
  readonly entityId: string;
  readonly op: "insert" | "update" | "transition";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly clientObservedVersion: number | null;
  readonly deviceAt: string;
};
export type SyncReplayInput = { readonly orgId: string; readonly regionId: string; readonly mutations: readonly SyncMutationWire[] };
export type ServerStateWire = { readonly version: number; readonly state?: string; readonly fields: Readonly<Record<string, unknown>> };
export type SyncOutcomeWire =
  | { readonly outcome: "applied"; readonly mutationId: string; readonly newVersion: number }
  | { readonly outcome: "duplicate"; readonly mutationId: string }
  | { readonly outcome: "superseded"; readonly mutationId: string; readonly note: string; readonly serverState: ServerStateWire | null }
  | { readonly outcome: "queued_for_human"; readonly mutationId: string; readonly note: string; readonly serverState: ServerStateWire | null }
  | { readonly outcome: "rejected"; readonly mutationId: string; readonly note: string };
export type SyncReplayOutput = { readonly outcomes: readonly SyncOutcomeWire[] };

// ---- item 10 wire shapes: the HQ rollup ----
export type HqMetricsInput = { readonly day?: string };
export type HqRegionWire = {
  readonly id: string; readonly code: string; readonly name: string; readonly active: boolean;
  /** False for UNASSIGNED — where leads wait before the office places them. */
  readonly placed: boolean;
};
export type HqValueWire = {
  readonly regionId: string; readonly metric: string;
  /** A count or integer minor units, as a string: bigint on the wire, like every *_minor. */
  readonly value: string;
};
export type HqMetricsOutput = {
  /** The UTC day the values close, or null when no rollup has ever run. */
  readonly day: string | null;
  /** When the worker computed them. The one thing S4's degraded line promises to show. */
  readonly asOf: string | null;
  readonly refreshMinutes: number;
  readonly regions: readonly HqRegionWire[];
  readonly values: readonly HqValueWire[];
};
export type HqHistoryInput = { readonly metric: string; readonly days?: number };
export type HqHistoryPointWire = { readonly day: string; readonly regionId: string; readonly value: string };
export type HqHistoryOutput = { readonly metric: string; readonly days: number; readonly points: readonly HqHistoryPointWire[] };

// ---- item 11 wire shapes: procurement ----
export type VendorStatus = "active" | "suspended" | "terminated";
export type VendorWire = { readonly id: string; readonly legalName: string; readonly status: VendorStatus; readonly regionId: string; readonly paymentTermsDays: number; readonly contactEmail: string | null };
export type ListVendorsOutput = { readonly vendors: readonly VendorWire[] };
export type CreateVendorInput = { readonly legalName: string; readonly regionId: string; readonly paymentTermsDays?: number; readonly contactEmail?: string };
export type CreateVendorOutput = { readonly id: string; readonly eventId: string };

export type ReceivingTier = "location_stock" | "regional_hub" | "national";
export type ReceivingPointWire = { readonly id: string; readonly code: string; readonly tier: ReceivingTier; readonly regionId: string; readonly address: AddressWire; readonly active: boolean };
export type ListReceivingPointsOutput = { readonly receivingPoints: readonly ReceivingPointWire[] };
export type CreateReceivingPointInput = { readonly code: string; readonly tier: ReceivingTier; readonly regionId: string; readonly address: AddressWire };
export type CreateReceivingPointOutput = { readonly id: string; readonly eventId: string };

export type PriceState = "proposed" | "accepted" | "rejected" | "withdrawn";
export type CatalogPriceWire = {
  readonly id: string; readonly itemId: string; readonly vendorId: string;
  /** Integer minor units as a string. */
  readonly priceMinor: string; readonly currency: string;
  readonly effectiveFrom: string; readonly effectiveTo: string | null;
  readonly state: PriceState; readonly proposedAt: string; readonly decidedAt: string | null; readonly decisionNote: string | null;
};
export type CatalogItemWire = {
  readonly id: string; readonly vendorId: string; readonly vendorSku: string; readonly description: string; readonly uom: string; readonly active: boolean;
  /** The accepted price whose window includes today, or null. What a new purchase order line takes. */
  readonly current: CatalogPriceWire | null;
  /** Every proposal waiting on the office, oldest first. */
  readonly proposals: readonly CatalogPriceWire[];
};
export type ListCatalogInput = { readonly vendorId?: string };
export type ListCatalogOutput = { readonly items: readonly CatalogItemWire[] };
export type AddCatalogItemInput = { readonly vendorId: string; readonly vendorSku: string; readonly description: string; readonly uom?: string };
export type AddCatalogItemOutput = { readonly id: string; readonly eventId: string };
export type ProposePriceInput = { readonly itemId: string; readonly priceMinor: string; readonly currency: string; readonly effectiveFrom: string };
export type ProposePriceOutput = { readonly id: string; readonly eventId: string };
export type WithdrawPriceInput = { readonly priceId: string };
export type WithdrawPriceOutput = { readonly id: string; readonly eventId: string };
export type DecidePriceInput = { readonly priceId: string; readonly decision: "accepted" | "rejected"; readonly note?: string };
export type DecidePriceOutput = { readonly id: string; readonly state: PriceState; readonly closedId: string | null; readonly eventId: string };

export type PoState = "draft" | "issued" | "acknowledged" | "received" | "cancelled";
export type PurchaseOrderWire = {
  readonly id: string; readonly number: string; readonly vendorId: string; readonly vendorName: string | null;
  readonly receivingPointId: string; readonly receivingPointCode: string | null; readonly receivingTier: ReceivingTier | null; readonly regionId: string;
  readonly state: PoState; readonly currency: string; readonly totalMinor: string;
  readonly issuedAt: string | null; readonly acknowledgedAt: string | null; readonly promisedShipOn: string | null; readonly createdAt: string;
};
export type ListPurchaseOrdersInput = { readonly state?: PoState };
export type ListPurchaseOrdersOutput = { readonly orders: readonly PurchaseOrderWire[] };
export type PoLineWire = {
  readonly id: string; readonly lineNo: number; readonly itemId: string; readonly vendorSku: string; readonly description: string; readonly uom: string;
  /** Integer thousandths as strings. */
  /** invoicedMilli counts MATCHED invoices only — a held invoice does not use up the receipt. */
  readonly quantityMilli: string; readonly shippedMilli: string; readonly receivedMilli: string; readonly invoicedMilli: string; readonly returnedMilli: string;
  readonly unitPriceMinor: string; readonly amountMinor: string;
};
export type ShipmentWire = { readonly id: string; readonly shippedOn: string; readonly carrier: string; readonly tracking: string | null; readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string }[] };
export type ReceiptWire = { readonly id: string; readonly poLineId: string; readonly quantityMilli: string; readonly receivedAt: string };
export type MatchNoteWire = { readonly poLineId: string | null; readonly code: string; readonly message: string };
export type VendorInvoiceWire = {
  readonly id: string; readonly poId: string; readonly poNumber: string | null; readonly vendorId: string; readonly invoiceNumber: string; readonly invoiceDate: string;
  readonly totalMinor: string; readonly currency: string; readonly matchState: "matched" | "held"; readonly matchNotes: readonly MatchNoteWire[]; readonly createdAt: string;
  readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string; readonly unitPriceMinor: string; readonly amountMinor: string }[];
};
export type RmaState = "requested" | "authorized" | "rejected";
export type RmaWire = {
  readonly id: string; readonly poId: string; readonly poNumber: string | null; readonly poLineId: string; readonly vendorId: string; readonly quantityMilli: string; readonly reason: string;
  readonly state: RmaState; readonly rmaNumber: string | null; readonly vendorNote: string | null; readonly createdAt: string; readonly respondedAt: string | null;
};
export type PurchaseOrderDetailInput = { readonly poId: string };
export type PurchaseOrderDetailOutput = {
  readonly order: PurchaseOrderWire; readonly receivingPoint: ReceivingPointWire | null; readonly lines: readonly PoLineWire[];
  readonly shipments: readonly ShipmentWire[]; readonly receipts: readonly ReceiptWire[]; readonly invoices: readonly VendorInvoiceWire[]; readonly returns: readonly RmaWire[];
};
export type CreatePurchaseOrderInput = { readonly vendorId: string; readonly receivingPointId: string; readonly lines: readonly { readonly itemId: string; readonly quantityMilli: string }[] };
export type CreatePurchaseOrderOutput = { readonly id: string; readonly number: string; readonly totalMinor: string; readonly eventId: string };
export type PoIdInput = { readonly poId: string };
export type CancelPurchaseOrderInput = { readonly poId: string; readonly reason?: string };
export type PoTransitionOutput = { readonly id: string; readonly state: PoState; readonly eventId: string };
export type AcknowledgePurchaseOrderInput = { readonly poId: string; readonly promisedShipOn: string };
export type RecordShipmentInput = { readonly poId: string; readonly shippedOn: string; readonly carrier: string; readonly tracking?: string; readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string }[] };
export type RecordShipmentOutput = { readonly id: string; readonly eventId: string };
export type RecordReceiptInput = { readonly poId: string; readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string }[] };
export type RecordReceiptOutput = { readonly ids: readonly string[]; readonly state: PoState; readonly eventId: string };
export type SubmitVendorInvoiceInput = { readonly poId: string; readonly invoiceNumber: string; readonly invoiceDate: string; readonly documentKey?: string; readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string; readonly unitPriceMinor: string }[] };
export type SubmitVendorInvoiceOutput = { readonly id: string; readonly matchState: "matched" | "held"; readonly matchNotes: readonly MatchNoteWire[]; readonly totalMinor: string; readonly eventId: string };
export type ListVendorInvoicesInput = { readonly poId?: string };
export type ListVendorInvoicesOutput = { readonly invoices: readonly VendorInvoiceWire[] };
export type RequestReturnInput = { readonly poId: string; readonly poLineId: string; readonly quantityMilli: string; readonly reason: string };
export type RequestReturnOutput = { readonly id: string; readonly eventId: string };
export type RespondToReturnInput = { readonly rmaId: string; readonly decision: "authorized" | "rejected"; readonly rmaNumber?: string; readonly note?: string };
export type RespondToReturnOutput = { readonly id: string; readonly state: RmaState; readonly eventId: string };
export type ListReturnsInput = { readonly poId?: string };
export type ListReturnsOutput = { readonly returns: readonly RmaWire[] };

export type HealthOutput = { readonly ok: true; readonly surfaces: readonly SurfaceId[] };

/**
 * A TENANT'S THEME, on the wire.
 *
 * `overrides` is the accent slots and nothing else — packages/tokens
 * BRAND_OVERRIDABLE is the list, and the gateway refuses a key outside it with
 * the reason. The structural tokens, the focus ring and the state ramp are not
 * here because a themeable focus ring is an accessibility regression shipped
 * under someone else's logo, and a themeable state ramp is an instrument a
 * tenant re-keyed.
 *
 * `host` is the key, not the org id: the browser asking for a theme has not
 * authenticated yet and cannot be trusted to name an org. It names where it is,
 * and the gateway decides whose that is.
 */
export type BrandThemeInput = {
  readonly host: string;
  readonly orgId: string;
  readonly regionId: string;
  /** The tenant's brand colour, gated separately from the slots — see `admission`. */
  readonly accent: string;
  readonly overrides: Readonly<Record<string, string>>;
};

/** Where an accent may be painted. Narrower than "admitted": the gate refuses the slot, never the tenant. */
export type AccentAdmissionWire = {
  readonly stateSurfaces: boolean;
  readonly achromatic: boolean;
  readonly minSeparation: number;
  readonly nearestState: string;
  readonly tiers: Readonly<Record<string, { readonly text: boolean; readonly fill: boolean }>>;
  readonly notes: readonly string[];
};

export type BrandThemeOutput = {
  readonly host: string;
  readonly eventId: string;
  readonly admission: AccentAdmissionWire;
};

/**
 * What the shell installs. `css` is already scoped by packages/tokens
 * TENANT_SCOPE, so it cannot reach the field frame whatever a surface does
 * with it, and `tenant` is false for a host with no theme — which is a plain
 * answer, not a 404, so this route says nothing about which tenants exist.
 */
export type BrandStylesheetInput = { readonly host?: string };
export type BrandStylesheetOutput = {
  readonly tenant: boolean;
  readonly css: string;
  readonly admission: AccentAdmissionWire | null;
};

/**
 * ITEM 8 — S1's wire shapes.
 *
 * `CoverageMetro` is two fields on purpose. Every other read in this file
 * widens as the surface needs it; this one is the public claim, and the
 * narrowest thing that answers "are you in my city" is a name.
 */
export type CoverageMetro = { readonly code: string; readonly name: string };
export type CoverageOutput = { readonly metros: readonly CoverageMetro[] };

export type AnonymousSessionOutput = {
  /** Also set as the httpOnly `ac_session` cookie. Short-lived; a visitor is not a session to resume. */
  readonly token: string;
  readonly expiresAt: string;
};

/**
 * WHERE THE LEAD CAME FROM, as data. A source typed into a handler is a
 * funnel nobody can count; adding one is a diff here and a diff on 0008's
 * check constraint, which is exactly as hard as it should be.
 */
export const LEAD_SOURCES = ["web_form", "call_button", "referral"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * What a stranger hands us. No account, no site, no equipment — those are
 * things a customer has, and this is the surface for people who are not one
 * yet. `requestedMetro` is free text and stays free text: it is what they
 * typed, not a resolved region, and resolving it is S2's job when the lead is
 * worked (`converted_account_id`).
 */
export type LeadContact = {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly note?: string;
};
export type SubmitLeadInput = {
  /**
   * Minted by the browser ONCE, when the visitor presses the button, and
   * replayed unchanged until the gateway answers. The unique index behind it
   * (migration 0008) is what makes S1's durable buffer safe to retry: a
   * replay that already landed loses to the constraint and comes back as
   * `leads_submission_id_key`, which the buffer reads as "done" rather than
   * as a failure. Without it, "queue and replay" means phoning the same
   * person once per reconnection.
   */
  readonly submissionId: string;
  readonly source: LeadSource;
  readonly contact: LeadContact;
  readonly requestedMetro?: string;
};
export type SubmitLeadOutput = { readonly id: string; readonly eventId: string };

export type RecordCallInput = {
  readonly leadId?: string;
  readonly direction: "inbound" | "outbound";
  readonly occurredAt: string;
};
export type RecordCallOutput = { readonly id: string; readonly eventId: string };

/**
 * One entry per operation, enforced by `satisfies`: add a row to OPERATIONS
 * without a shape here and the file does not type-check; the generator, which
 * writes these names as text, then emits a method whose type does not resolve.
 */
export type OperationIO = {
  "auth.login": { input: LoginInput; output: LoginOutput };
  "auth.logout": { input: void; output: LogoutOutput };
  "auth.deviceLogin": { input: DeviceLoginInput; output: DeviceLoginOutput };
  "session.me": { input: void; output: HierarchyContext };
  "account.me": { input: void; output: MyAccountWire };
  "account.update": { input: UpdateMyAccountInput; output: MyAccountWire };
  "account.setAvatar": { input: SetAvatarInput; output: MyAccountWire };
  "account.changePassword": { input: ChangePasswordInput; output: ChangePasswordOutput };
  "terms.authorOverride": { input: AuthorOverrideInput; output: AuthorOverrideOutput };
  "terms.resolved": { input: ResolvedTermsInput; output: ResolvedTermsOutput };
  "regions.list": { input: void; output: ListRegionsOutput };
  "organizations.list": { input: ListOrganizationsInput; output: ListOrganizationsOutput };
  "organizations.create": { input: CreateOrganizationInput; output: CreateOrganizationOutput };
  "customers.createResidential": { input: CreateResidentialInput; output: CreateResidentialOutput };
  "leads.list": { input: ListLeadsInput; output: ListLeadsOutput };
  "leads.convert": { input: ConvertLeadInput; output: ConvertLeadOutput };
  "accounts.list": { input: ListAccountsInput; output: ListAccountsOutput };
  "accounts.create": { input: CreateAccountInput; output: CreateAccountOutput };
  "accounts.move": { input: MoveAccountInput; output: MoveAccountOutput };
  "accounts.update": { input: UpdateAccountInput; output: UpdateAccountOutput };
  "equipment.list": { input: ListEquipmentInput; output: ListEquipmentOutput };
  "equipment.register": { input: RegisterEquipmentInput; output: RegisterEquipmentOutput };
  "contacts.list": { input: ListContactsInput; output: ListContactsOutput };
  "contacts.set": { input: SetContactInput; output: SetContactOutput };
  "invoices.list": { input: ListInvoicesInput; output: ListInvoicesOutput };
  "invoices.void": { input: VoidInvoiceInput; output: VoidInvoiceOutput };
  "payments.list": { input: ListPaymentsInput; output: ListPaymentsOutput };
  "payments.record": { input: RecordPaymentInput; output: PaymentOutput };
  "payments.return": { input: ReturnPaymentInput; output: PaymentOutput };
  "sites.imagery": { input: SiteImageryInput; output: SiteImageryOutput };
  "sites.mapTile": { input: SiteMapTileInput; output: SiteMapTileOutput };
  "sites.locate": { input: LocateSiteInput; output: LocateSiteOutput };
  "contracts.list": { input: ListContractsInput; output: ListContractsOutput };
  "contracts.create": { input: CreateContractInput; output: CreateContractOutput };
  "contracts.transition": { input: TransitionContractInput; output: TransitionContractOutput };
  "terms.overrides.list": { input: ListTermOverridesInput; output: ListTermOverridesOutput };
  "terms.register": { input: void; output: TermRegisterOutput };
  "firms.list": { input: ListFirmsInput; output: ListFirmsOutput };
  "firms.create": { input: CreateFirmInput; output: CreateFirmOutput };
  "firms.update": { input: UpdateFirmInput; output: UpdateFirmOutput };
  "crews.list": { input: ListCrewsInput; output: ListCrewsOutput };
  "crews.create": { input: CreateCrewInput; output: CreateCrewOutput };
  "crews.update": { input: UpdateCrewInput; output: UpdateCrewOutput };
  "technicians.list": { input: ListTechniciansInput; output: ListTechniciansOutput };
  "technicians.record": { input: RecordTechnicianInput; output: RecordTechnicianOutput };
  "technicians.update": { input: UpdateTechnicianInput; output: UpdateTechnicianOutput };
  "credentials.list": { input: ListCredentialsInput; output: ListCredentialsOutput };
  "credentials.record": { input: RecordCredentialInput; output: RecordCredentialOutput };
  "credentials.verify": { input: VerifyCredentialInput; output: VerifyCredentialOutput };
  "rateCards.list": { input: ListRateCardsInput; output: ListRateCardsOutput };
  "rateCards.set": { input: SetRateCardInput; output: SetRateCardOutput };
  "credentials.submit": { input: SubmitCredentialInput; output: SubmitCredentialOutput };
  "crews.enroll": { input: EnrollCrewInput; output: EnrollCrewOutput };
  "crews.retire": { input: RetireCrewInput; output: RetireCrewOutput };
  "settlements.list": { input: ListSettlementsInput; output: ListSettlementsOutput };
  "settlements.lines": { input: ListSettlementLinesInput; output: ListSettlementLinesOutput };
  "settlements.acknowledge": { input: AcknowledgeSettlementInput; output: AcknowledgeSettlementOutput };
  "settlements.dispute": { input: DisputeSettlementInput; output: DisputeSettlementOutput };
  "projects.list": { input: ListProjectsInput; output: ListProjectsOutput };
  "projects.create": { input: CreateProjectInput; output: CreateProjectOutput };
  "jobs.create": { input: CreateJobInput; output: CreateJobOutput };
  "sites.list": { input: void; output: ListSitesOutput };
  "jobs.list": { input: ListJobsInput; output: ListJobsOutput };
  "serviceRequests.create": { input: CreateServiceRequestInput; output: CreateServiceRequestOutput };
  "serviceRequests.list": { input: ListServiceRequestsInput; output: ListServiceRequestsOutput };
  "serviceRequests.attachPhoto": { input: AttachPhotoInput; output: AttachPhotoOutput };
  "serviceRequests.openJob": { input: OpenRequestJobInput; output: OpenRequestJobOutput };
  "serviceRequests.hold": { input: CreateServiceRequestInput; output: CreateServiceRequestOutput };
  "media.get": { input: GetMediaInput; output: GetMediaOutput };
  "jobs.mine": { input: void; output: MyJobsOutput };
  "punches.mine": { input: MyPunchesInput; output: MyPunchesOutput };
  "jobs.attachMedia": { input: AttachJobMediaInput; output: AttachJobMediaOutput };
  "jobs.wrapUp": { input: WrapUpInput; output: WrapUpOutput };
  "dispatch.assign": { input: AssignInput; output: AssignOutput };
  "dispatch.candidates": { input: CandidateCrewsInput; output: CandidateCrewsOutput };
  "dispatch.release": { input: ReleaseAssignmentInput; output: ReleaseAssignmentOutput };
  "jobs.transition": { input: TransitionJobInput; output: TransitionJobOutput };
  "jobs.addNote": { input: AddJobNoteInput; output: AddJobNoteOutput };
  "manager.overview": { input: void; output: ManagerOverviewOutput };
  "jobs.setReturnTrip": { input: SetReturnTripInput; output: SetReturnTripOutput };
  "jobs.detail": { input: JobDetailInput; output: JobDetailOutput };
  "jobs.conversation": { input: JobConversationInput; output: JobConversationOutput };
  "jobs.saveUpdate": { input: SaveJobUpdateInput; output: SaveJobUpdateOutput };
  "jobs.publishUpdate": { input: PublishJobUpdateInput; output: PublishJobUpdateOutput };
  "jobs.postMessage": { input: PostJobMessageInput; output: PostJobMessageOutput };
  "devices.list": { input: ListDevicesInput; output: ListDevicesOutput };
  "devices.register": { input: RegisterDeviceInput; output: RegisterDeviceOutput };
  "devices.grantShift": { input: GrantShiftInput; output: GrantShiftOutput };
  "sync.replay": { input: SyncReplayInput; output: SyncReplayOutput };
  "brand.setTheme": { input: BrandThemeInput; output: BrandThemeOutput };
  "brand.theme": { input: BrandStylesheetInput; output: BrandStylesheetOutput };
  "events.stream": { input: void; output: never };
  "coverage.list": { input: void; output: CoverageOutput };
  "auth.anonymousSession": { input: void; output: AnonymousSessionOutput };
  "leads.submit": { input: SubmitLeadInput; output: SubmitLeadOutput };
  "callRecords.record": { input: RecordCallInput; output: RecordCallOutput };
  "hq.metrics": { input: HqMetricsInput; output: HqMetricsOutput };
  "hq.history": { input: HqHistoryInput; output: HqHistoryOutput };
  "vendors.list": { input: void; output: ListVendorsOutput };
  "vendors.create": { input: CreateVendorInput; output: CreateVendorOutput };
  "receivingPoints.list": { input: void; output: ListReceivingPointsOutput };
  "receivingPoints.create": { input: CreateReceivingPointInput; output: CreateReceivingPointOutput };
  "catalog.list": { input: ListCatalogInput; output: ListCatalogOutput };
  "catalog.addItem": { input: AddCatalogItemInput; output: AddCatalogItemOutput };
  "prices.propose": { input: ProposePriceInput; output: ProposePriceOutput };
  "prices.withdraw": { input: WithdrawPriceInput; output: WithdrawPriceOutput };
  "prices.decide": { input: DecidePriceInput; output: DecidePriceOutput };
  "pos.list": { input: ListPurchaseOrdersInput; output: ListPurchaseOrdersOutput };
  "pos.detail": { input: PurchaseOrderDetailInput; output: PurchaseOrderDetailOutput };
  "pos.create": { input: CreatePurchaseOrderInput; output: CreatePurchaseOrderOutput };
  "pos.issue": { input: PoIdInput; output: PoTransitionOutput };
  "pos.cancel": { input: CancelPurchaseOrderInput; output: PoTransitionOutput };
  "pos.acknowledge": { input: AcknowledgePurchaseOrderInput; output: PoTransitionOutput };
  "shipments.record": { input: RecordShipmentInput; output: RecordShipmentOutput };
  "receipts.record": { input: RecordReceiptInput; output: RecordReceiptOutput };
  "vendorInvoices.submit": { input: SubmitVendorInvoiceInput; output: SubmitVendorInvoiceOutput };
  "vendorInvoices.list": { input: ListVendorInvoicesInput; output: ListVendorInvoicesOutput };
  "rmas.request": { input: RequestReturnInput; output: RequestReturnOutput };
  "rmas.respond": { input: RespondToReturnInput; output: RespondToReturnOutput };
  "rmas.list": { input: ListReturnsInput; output: ListReturnsOutput };
  "system.health": { input: void; output: HealthOutput };
};
// Both directions: every operation has IO, and no IO names a missing operation.
type _IoCoversCatalogue = { [K in OperationId]: OperationIO[K] };
type _CatalogueCoversIo = { [K in keyof OperationIO]: (typeof OPERATIONS)[K] };
export type _OperationIoParity = [_IoCoversCatalogue, _CatalogueCoversIo];
