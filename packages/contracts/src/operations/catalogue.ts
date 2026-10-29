import type { HierarchyContext } from "../context.ts";
import { WHITE_LABEL_SURFACES } from "../surfaces.ts";
import type { OperationSpec } from "./define.ts";
import { AUTHENTICATED, COMPANY, PASSWORD_LOGIN, op } from "./define.ts";
import type * as Wire from "./wire.ts";

/**
 * THE OPERATION CATALOGUE. One row per request a surface may make.
 * The wire types live on the row (`op<Input, Output>()`), so `OperationIO`
 * is derived and a second hand-written map cannot drift.
 */
export const OPERATIONS = {
  "auth.login": op<Wire.LoginInput, Wire.LoginOutput>()({
    id: "auth.login", method: "POST", path: "/auth/login", kind: "login", auth: "none",
    surfaces: PASSWORD_LOGIN, carrier: "body", sdkMethod: "login",
    summary: "Mint a token and resolve the hierarchy context once. The surface named in the body must serve the user's namespace.",
  }),
  "auth.logout": op<void, Wire.LogoutOutput>()({
    id: "auth.logout", method: "POST", path: "/auth/logout", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "logout",
    summary: "Revoke the session behind this token and clear the session cookie. The next request with either is 401 revoked.",
  }),
  "auth.deviceLogin": op<Wire.DeviceLoginInput, Wire.DeviceLoginOutput>()({
    id: "auth.deviceLogin", method: "POST", path: "/auth/device-login", kind: "login", auth: "none",
    surfaces: ["S5"], carrier: "body", sdkMethod: "deviceLogin",
    summary: "A technician's own credential PLUS the hardware they are holding. Mints a device-namespace token bound to the one active shift grant for (device, technician) — the token expires with the shift, never later.",
  }),
  "session.me": op<void, HierarchyContext>()({
    id: "session.me", method: "GET", path: "/me", kind: "query", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "me",
    summary: "The principal and its hierarchy context, re-resolved. What the shell reads at boot.",
  }),
  // ---- 0032: the Account button — the caller's own row, on every signed-in surface ----
  "account.me": op<void, Wire.MyAccountWire>()({
    id: "account.me", method: "GET", path: "/account", kind: "query", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "myAccount",
    summary: "The caller's own name, email, picture, status and when they last set their password. A device principal reads the technician behind the shift.",
  }),
  "account.update": op<Wire.UpdateMyAccountInput, Wire.MyAccountWire>()({
    id: "account.update", method: "POST", path: "/account", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "body", sdkMethod: "updateMyAccount",
    summary: "Set the caller's own display name, presence and one-line status. Fields left out are left as they are.",
  }),
  "account.setAvatar": op<Wire.SetAvatarInput, Wire.MyAccountWire>()({
    id: "account.setAvatar", method: "POST", path: "/account/avatar", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "body", sdkMethod: "setAccountAvatar",
    summary: "Set or clear the caller's own picture: a JPEG or PNG by its own bytes, at most AVATAR_MAX_BYTES, as base64 in the body. Null clears it.",
  }),
  "account.changePassword": op<Wire.ChangePasswordInput, Wire.ChangePasswordOutput>()({
    id: "account.changePassword", method: "POST", path: "/account/password", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "body", sdkMethod: "changePassword",
    summary: "Change the caller's own password, given the current one. Wrong guesses count against sign-in's throttle. Ends every other session the person holds; this one stays.",
  }),
  "terms.authorOverride": op<Wire.AuthorOverrideInput, Wire.AuthorOverrideOutput>()({
    id: "terms.authorOverride", method: "POST", path: "/s2/terms/override", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "authorTermOverride",
    summary: "Author a contract term override. Admitted or refused at insert against the register; a refusal is a 422 with the reason and its axis.",
  }),
  "terms.resolved": op<Wire.ResolvedTermsInput, Wire.ResolvedTermsOutput>()({
    id: "terms.resolved", method: "GET", path: "/terms/resolved", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "resolvedTerms",
    summary: "Every term at a node as of a date, with the trace naming every rung.",
  }),
  // ---- C1: the hierarchy S2 authors (09 §3.6) ----
  "regions.list": op<void, Wire.ListRegionsOutput>()({
    id: "regions.list", method: "GET", path: "/regions", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3"], carrier: "none", sdkMethod: "listRegions",
    summary: "OUR service regions — the shard boundary. What a region node binds to; what D14's density rule is set on.",
  }),
  "organizations.list": op<Wire.ListOrganizationsInput, Wire.ListOrganizationsOutput>()({
    id: "organizations.list", method: "GET", path: "/s2/organizations", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listOrganizations",
    summary: "Customer and subcontractor organizations — the parent tier — with how many of our regions each one meets.",
  }),
  "organizations.create": op<Wire.CreateOrganizationInput, Wire.CreateOrganizationOutput>()({
    id: "organizations.create", method: "POST", path: "/s2/organizations", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createOrganization",
    summary: "Create a customer parent WITH its first region node in one unit of work. No orphan parent: a parent never exists without a place we serve it from.",
  }),
  "customers.createResidential": op<Wire.CreateResidentialInput, Wire.CreateResidentialOutput>()({
    id: "customers.createResidential", method: "POST", path: "/s2/customers/residential", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createResidentialCustomer",
    summary: "A home as a customer, in one unit of work: the organization (segment residential, fixed for good), the region node we serve it from, the household as its location and the home as its site, both at the address, and the homeowner as the primary contact when given. The tier ladder is unchanged — a home is a one-branch tree.",
  }),
  "leads.list": op<Wire.ListLeadsInput, Wire.ListLeadsOutput>()({
    id: "leads.list", method: "GET", path: "/s2/leads", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listLeads",
    summary: "Leads S1 captured, newest first — waiting ones by default — with the contact the visitor gave and, once converted, the home it became.",
  }),
  "leads.convert": op<Wire.ConvertLeadInput, Wire.ConvertLeadOutput>()({
    id: "leads.convert", method: "POST", path: "/s2/leads/convert", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "convertLead",
    summary: "A lead becomes a residential customer: customers.createResidential with the lead's name and contact, and the lead records the home it became — once; a second conversion is refused, naming the home.",
  }),
  "accounts.list": op<Wire.ListAccountsInput, Wire.ListAccountsOutput>()({
    id: "accounts.list", method: "GET", path: "/s2/accounts", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listAccounts",
    summary: "Every node in an organization's tree the caller may see. S6 sees its own subtree by RLS; same operation.",
  }),
  "accounts.create": op<Wire.CreateAccountInput, Wire.CreateAccountOutput>()({
    id: "accounts.create", method: "POST", path: "/s2/accounts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createAccount",
    summary: "Author a region node, location or site. region_id is an input for a region node only; below that it derives from the parent edge. D14 is checked for a location.",
  }),
  "accounts.move": op<Wire.MoveAccountInput, Wire.MoveAccountOutput>()({
    id: "accounts.move", method: "POST", path: "/s2/accounts/move", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "moveAccount",
    summary: "Re-parent a node. The shard key follows the edge by trigger; the output says how many descendants moved with it.",
  }),
  "accounts.update": op<Wire.UpdateAccountInput, Wire.UpdateAccountOutput>()({
    id: "accounts.update", method: "POST", path: "/s2/accounts/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateAccount",
    summary: "Attributes of a node — name, the customer's own grouping, external ref, address, timezone, active. Never parent_id or region_id; those are accounts.move.",
  }),
  // ---- item 9: the site record — what a site IS, not only what is happening there (S6 site card) ----
  "equipment.list": op<Wire.ListEquipmentInput, Wire.ListEquipmentOutput>()({
    id: "equipment.list", method: "GET", path: "/equipment", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listEquipment",
    summary: "The units at a site this principal may see — kind, label, make and model, serial, tonnage, installed — each with when it was last serviced, DERIVED from the completed jobs that named it (job_equipment). RLS (0009) decides the site; nothing here filters.",
  }),
  "equipment.register": op<Wire.RegisterEquipmentInput, Wire.RegisterEquipmentOutput>()({
    id: "equipment.register", method: "POST", path: "/s2/equipment", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "registerEquipment",
    summary: "Record a unit at a site: the kind from the closed list, the customer's own label, make, model, serial. The manufacturer dictionary is global reference data and grows by name here. Tenancy derives from the site.",
  }),
  "contacts.list": op<Wire.ListContactsInput, Wire.ListContactsOutput>()({
    id: "contacts.list", method: "GET", path: "/contacts", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listContacts",
    summary: "The people at a node AND at its ancestors — a site with no manager of its own inherits the location's — each row saying which node it belongs to. Visible under the node's own rule (0009).",
  }),
  "contacts.set": op<Wire.SetContactInput, Wire.SetContactOutput>()({
    id: "contacts.set", method: "POST", path: "/s2/contacts", kind: "mutation", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "body", sdkMethod: "setContact",
    summary: "Record or replace a contact at a node: role, name, phone, email, note, primary. The customer may edit a contact at a node in its own scope (0037, OPEN-S6-CONTACTS closed).",
  }),
  "invoices.list": op<Wire.ListInvoicesInput, Wire.ListInvoicesOutput>()({
    id: "invoices.list", method: "GET", path: "/invoices", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listInvoices",
    summary: "Invoices with lines at a site or location this principal may see, with THOSE lines and their subtotal — a consolidated parent invoice read from one location shows that location's lines and nothing beside (0009). Issuance is WS-E's; this is the read. Each carries its status and what is paid against the whole invoice, derived from its payments (0030).",
  }),
  "invoices.void": op<Wire.VoidInvoiceInput, Wire.VoidInvoiceOutput>()({
    id: "invoices.void", method: "POST", path: "/s2/invoices/void", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "voidInvoice",
    summary: "Void an issued invoice the office should not have issued, with the reason. Refused while any payment stands against it. Final (0030). Finance and the principals (S2 writeRoles.invoice).",
  }),
  "payments.list": op<Wire.ListPaymentsInput, Wire.ListPaymentsOutput>()({
    id: "payments.list", method: "GET", path: "/s2/payments", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listPayments",
    summary: "Every payment recorded against an invoice, oldest first, in every state — the history the derived status is read from.",
  }),
  "payments.record": op<Wire.RecordPaymentInput, Wire.PaymentOutput>()({
    id: "payments.record", method: "POST", path: "/s2/payments", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordPayment",
    summary: "Record a payment received against an issued invoice: amount in the invoice's currency, method, reference, the day it arrived (today if not given; never ahead, never before issue). Part payments are rows like any other; the total is never exceeded (0030). Emits invoice.paid when it settles the invoice, payment.recorded otherwise. Finance and the principals (S2 writeRoles.payment).",
  }),
  "payments.webhook": op<Wire.PaymentWebhookInput, Wire.PaymentOutput>()({
    id: "payments.webhook", method: "POST", path: "/webhooks/payments", kind: "system", auth: "none",
    surfaces: ["S2"], carrier: "body", sdkMethod: "paymentWebhook",
    summary: "Processor webhook entry point (OPEN-PAYMENTS scaffold). Verifies a signature when AC_PAYMENT_WEBHOOK_SECRET is set and records a succeeded payment the same way the office does. Unset, refuses. Y1–Y5 still decide the real processor and merchant of record.",
  }),
  "payments.return": op<Wire.ReturnPaymentInput, Wire.PaymentOutput>()({
    id: "payments.return", method: "POST", path: "/s2/payments/return", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "returnPayment",
    summary: "Mark a succeeded payment returned (a bounced check, an ACH return) or refunded, with the reason. The row stays; the invoice's status is re-derived without it. Finance and the principals.",
  }),
  "sites.imagery": op<Wire.SiteImageryInput, Wire.SiteImageryOutput>()({
    id: "sites.imagery", method: "GET", path: "/s6/sites/imagery", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "siteImagery",
    summary: "Overhead imagery of a site, fetched by the GATEWAY from the configured provider (AC_IMAGERY_URL) and returned inline — the customer's browser never reaches a third party with the customer's address, and there is no key in a bundle. Unavailable is an answer, not an error: not configured, no coordinates, provider unreachable.",
  }),
  "sites.mapTile": op<Wire.SiteMapTileInput, Wire.SiteMapTileOutput>()({
    id: "sites.mapTile", method: "GET", path: "/s2/sites/map-tile", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "siteMapTile",
    summary: "One web-mercator basemap tile near a site, fetched by the GATEWAY from the configured tile provider (AC_MAP_TILE_URL) and returned inline — the same reasons as sites.imagery: no key in a bundle, no customer's coordinates sent to a third party from a browser. Only tiles within MAP_TILE_REACH of the site's own tile, at MAP_ZOOM_MIN–MAP_ZOOM_MAX, are served: a pan around a home, not a free tile proxy. Unavailable is an answer: not configured, no coordinates, provider unreachable.",
  }),
  "sites.locate": op<Wire.LocateSiteInput, Wire.LocateSiteOutput>()({
    id: "sites.locate", method: "POST", path: "/s2/sites/locate", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "locateSite",
    summary: "Place a site on the map: when its address carries no lat/lng, the GATEWAY asks the configured geocoder (AC_GEOCODE_URL) for that address and writes the coordinates onto the address through accounts.update — audited, account.updated. A site that already has coordinates is answered as recorded and not touched. Only a match at the address itself (a house number or a named place) is written; a street, town or postcode centroid is 'not_found', because a pin in the wrong yard is worse than none.",
  }),
  // ---- C2: the agreements and term overrides S2 authors (09 §3.6) ----
  "contracts.list": op<Wire.ListContractsInput, Wire.ListContractsOutput>()({
    id: "contracts.list", method: "GET", path: "/s2/contracts", kind: "query", auth: "bearer",
    // S6 since item 6: a customer reads the agreements it signed. Its own org
    // by RLS (0006) — the orgId input is inert for a customer principal.
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listContracts",
    summary: "The signed agreements in an organization — what a term override must belong to, and where the state machine currently stands.",
  }),
  "contracts.create": op<Wire.CreateContractInput, Wire.CreateContractOutput>()({
    id: "contracts.create", method: "POST", path: "/s2/contracts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createContract",
    summary: "Record an agreement against a node. OQ5's position is required with no default; regionId is an input for a parent-scope agreement alone and derives from the node below it.",
  }),
  "contracts.transition": op<Wire.TransitionContractInput, Wire.TransitionContractOutput>()({
    id: "contracts.transition", method: "POST", path: "/s2/contracts/transition", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "transitionContract",
    summary: "draft → active → expired | terminated. A step off that ladder is refused by name; activation and ending are what the other blocks subscribe to.",
  }),
  "terms.overrides.list": op<Wire.ListTermOverridesInput, Wire.ListTermOverridesOutput>()({
    id: "terms.overrides.list", method: "GET", path: "/s2/terms/overrides", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listTermOverrides",
    summary: "The override rows an organization holds — every tier, optionally narrowed to one term or one agreement. What the override screen lists before it adds to it.",
  }),
  "terms.register": op<void, Wire.TermRegisterOutput>()({
    id: "terms.register", method: "GET", path: "/terms/register", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "none", sdkMethod: "termRegister",
    summary: "The term policy register as data — value kind, enum values, authoring tiers, rationale. S2 renders the override form FROM this, so a twelfth term is a register diff and the form follows.",
  }),

  // ---- C4: the subcontractor network S2 records (09 §3.6, item 7) ----
  // Reads are served to S8 as well: a firm reads its own row, its own crews,
  // its own documents and its own price, and RLS is what makes "its own" true.
  // Writes are S2's. S8's intake (a firm PROPOSING a document) is a separate
  // operation with its own entity, not yet in the catalogue.
  "firms.list": op<Wire.ListFirmsInput, Wire.ListFirmsOutput>()({
    id: "firms.list", method: "GET", path: "/network/firms", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listFirms",
    summary: "Subcontractor firms — legal name, status on the ladder, settlement terms, the MSA, OQ5 firm-side, and how many crews they field. S8 sees one row: itself.",
  }),
  "firms.create": op<Wire.CreateFirmInput, Wire.CreateFirmOutput>()({
    id: "firms.create", method: "POST", path: "/s2/network/firms", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createFirm",
    summary: "Record a firm WITH its tenant root in one unit of work: the organizations row and the subcontractor_firms row share an id. A firm starts onboarding, in the region it is dispatched from. OQ5 is stated or the firm is not recorded.",
  }),
  "firms.update": op<Wire.UpdateFirmInput, Wire.UpdateFirmOutput>()({
    id: "firms.update", method: "POST", path: "/s2/network/firms/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateFirm",
    summary: "Attributes and the status ladder: onboarding → active ⇄ suspended → terminated. Activation needs a signed MSA; a step off the ladder is refused by name.",
  }),
  "crews.list": op<Wire.ListCrewsInput, Wire.ListCrewsOutput>()({
    id: "crews.list", method: "GET", path: "/network/crews", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3", "S8"], carrier: "query", sdkMethod: "listCrews",
    summary: "Crews — ours and the firms' — with a document summary per crew: what the gate would need, what is on file, what is verified, and the earliest expiry. Read by S2, by S3's board for a row per crew whether or not it holds work, and by a firm for its own crews; never by the field layer.",
  }),
  "crews.create": op<Wire.CreateCrewInput, Wire.CreateCrewOutput>()({
    id: "crews.create", method: "POST", path: "/s2/network/crews", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createCrew",
    summary: "Record a crew in its home region. An employed crew is ours and names no firm; a subcontracted crew names its firm and is that firm's row. The tenancy follows from which.",
  }),
  "crews.update": op<Wire.UpdateCrewInput, Wire.UpdateCrewOutput>()({
    id: "crews.update", method: "POST", path: "/s2/network/crews/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateCrew",
    summary: "Label and active flag. Never the firm, never the home region — a crew that changes employer or region is a new crew with a new document set.",
  }),
  // 0020: the technician roster — every person who works our jobs, ours or a
  // firm's, login or not. The office reads it: S2 to keep it, S3's board to
  // draw every technician whether or not they hold work. S8 is not given it.
  // The home address is served to account owners alone; every other office
  // role reads it as restricted and cannot write it.
  "technicians.list": op<Wire.ListTechniciansInput, Wire.ListTechniciansOutput>()({
    id: "technicians.list", method: "GET", path: "/network/technicians", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3"], carrier: "query", sdkMethod: "listTechnicians",
    summary: "The technician roster — name, phone, specialties, crew, and the home address for an account owner or principal (restricted for every other role). Optionally one firm's.",
  }),
  "technicians.record": op<Wire.RecordTechnicianInput, Wire.RecordTechnicianOutput>()({
    id: "technicians.record", method: "POST", path: "/s2/network/technicians", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordTechnician",
    summary: "Add a technician: ours (no firm) or a firm's. A crew named belongs to the same employer. Only an account owner or principal may record a home address.",
  }),
  "technicians.update": op<Wire.UpdateTechnicianInput, Wire.UpdateTechnicianOutput>()({
    id: "technicians.update", method: "POST", path: "/s2/network/technicians/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateTechnician",
    summary: "Name, phone, specialties, crew, active — and the home address, by an account owner or principal only. Never the employer: a technician who changes firm is a new row.",
  }),
  "credentials.list": op<Wire.ListCredentialsInput, Wire.ListCredentialsOutput>()({
    id: "credentials.list", method: "GET", path: "/network/credentials", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listCredentials",
    summary: "The documents on file for a crew or a firm's crews, verified or not. An unverified certificate is on the list AS unverified — it is not hidden, and it does not clear anything.",
  }),
  "credentials.record": op<Wire.RecordCredentialInput, Wire.RecordCredentialOutput>()({
    id: "credentials.record", method: "POST", path: "/s2/network/credentials", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordCredential",
    summary: "Put a document on file — kind, identifier, the window it is valid for. ALWAYS unverified: there is no field for verified_at here, and the trigger refuses one on any path.",
  }),
  "credentials.verify": op<Wire.VerifyCredentialInput, Wire.VerifyCredentialOutput>()({
    id: "credentials.verify", method: "POST", path: "/s2/network/credentials/verify", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "verifyCredential",
    summary: "THE ONLY PATH that sets verified_at — by S2, by the principal doing it, once. After this the document is immutable; a correction is a new document. The gate reads nothing else.",
  }),
  "rateCards.list": op<Wire.ListRateCardsInput, Wire.ListRateCardsOutput>()({
    id: "rateCards.list", method: "GET", path: "/network/rate-cards", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listRateCards",
    summary: "A firm's rates by service code over time. A firm sees its own and no other's — RLS, not a WHERE clause.",
  }),
  "rateCards.set": op<Wire.SetRateCardInput, Wire.SetRateCardOutput>()({
    id: "rateCards.set", method: "POST", path: "/s2/network/rate-cards", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "setRateCard",
    summary: "Set a rate from a day forward: the row in effect that day is closed at it and the new row inserted, both audited. A row that would overlap is refused by the EXCLUDE constraint — two prices at once is unrepresentable, not tie-broken.",
  }),

  // ---- item 7: THE FIRM'S OWN WRITES (D12's minimum cut as the registry states
  // it: compliance_doc, crew_roster, settlement_ack, dispute) and the reads
  // behind settlement visibility. Each write has its own entity because the
  // allowlist is checked by entity: S2's `credentials.record` writes
  // crew_credential and S8's `credentials.submit` writes compliance_doc into
  // the same table, and 0005's trigger makes both arrive unverified. What a
  // firm's row may SAY is the table's (0007's two triggers), not the handler's.
  "credentials.submit": op<Wire.SubmitCredentialInput, Wire.SubmitCredentialOutput>()({
    id: "credentials.submit", method: "POST", path: "/s8/network/credentials", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "submitCredential",
    summary: "A firm puts a document on file for one of ITS OWN crews — kind, identifier, window, the stored file's key. Unverified on arrival, like every document; S2 verifies it, once, or it clears nothing. A crew the firm cannot see is 'unknown_crew', not 'forbidden'.",
  }),
  "crews.enroll": op<Wire.EnrollCrewInput, Wire.EnrollCrewOutput>()({
    id: "crews.enroll", method: "POST", path: "/s8/network/crews", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "enrollCrew",
    summary: "A firm adds a crew to its roster: subcontracted, under itself, in the region it is dispatched from — none of which is an input. Onboarding and active firms roster (documents are verified before the first job); a suspended or terminated firm does not.",
  }),
  "crews.retire": op<Wire.RetireCrewInput, Wire.RetireCrewOutput>()({
    id: "crews.retire", method: "POST", path: "/s8/network/crews/retire", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "retireCrew",
    summary: "A firm takes one of its crews off the roster (active = false) or renames it. Never the firm, the type or the region — 0007 refuses those from any path — and never a crew holding a live assignment: release it first.",
  }),
  "settlements.list": op<Wire.ListSettlementsInput, Wire.ListSettlementsOutput>()({
    id: "settlements.list", method: "GET", path: "/money/settlements", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listSettlements",
    summary: "Statements we issue to firms for work done — period, total, state, and the firm's position on each. S2 reads every firm's; a firm reads its own, once issued (a draft is ours). RLS, not a WHERE.",
  }),
  "settlements.lines": op<Wire.ListSettlementLinesInput, Wire.ListSettlementLinesOutput>()({
    id: "settlements.lines", method: "GET", path: "/money/settlements/lines", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listSettlementLines",
    summary: "One statement's lines: the job, the rate applied, the quantity, the amount. A firm sees the lines of a statement it can see and no other's — another firm's price is not derivable from a row the firm cannot read.",
  }),
  "settlements.issue": op<Wire.IssueSettlementInput, Wire.IssueSettlementOutput>()({
    id: "settlements.issue", method: "POST", path: "/s2/money/settlements/issue", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "issueSettlement",
    summary: "Issue a draft statement to a firm: draft → issued, stamped. The office's step that makes a settlement visible to the firm (WS-E). Refused if not a draft.",
  }),
  "settlements.acknowledge": op<Wire.AcknowledgeSettlementInput, Wire.AcknowledgeSettlementOutput>()({
    id: "settlements.acknowledge", method: "POST", path: "/s8/money/settlements/acknowledge", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "acknowledgeSettlement",
    summary: "The firm states that an issued statement is right: issued → acknowledged, stamped. The one forward step a firm may take on money; the trigger refuses every other change to the row.",
  }),
  "settlements.dispute": op<Wire.DisputeSettlementInput, Wire.DisputeSettlementOutput>()({
    id: "settlements.dispute", method: "POST", path: "/s8/money/settlements/dispute", kind: "mutation", auth: "bearer",
    surfaces: ["S8"], carrier: "body", sdkMethod: "disputeSettlement",
    summary: "The firm states that a statement is wrong, and why: issued or acknowledged → disputed, with the reason on the row. The office reads it on S2 (settlement.disputed on OFC). What happens next is WS-E's ladder, not S8's.",
  }),

  // ---- item 4: the job itself, created in Office & Dispatch ----
  // 0024: an install is sold. The project is what it was sold under, and its
  // foreman is the person who sold it — every install job sits under one.
  "projects.list": op<Wire.ListProjectsInput, Wire.ListProjectsOutput>()({
    id: "projects.list", method: "GET", path: "/projects", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3"], carrier: "query", sdkMethod: "listProjects",
    summary: "The projects install work is opened under — who sold each, and how much install work sits under it — and the foremen a new one may be sold by. Optionally one customer's.",
  }),
  "projects.create": op<Wire.CreateProjectInput, Wire.CreateProjectOutput>()({
    id: "projects.create", method: "POST", path: "/s2/projects", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createProject",
    summary: "Record what was sold: under an agreement in force, by a foreman (the person who sold it), for a window. The customer and region are the agreement's, never typed in.",
  }),
  "jobs.create": op<Wire.CreateJobInput, Wire.CreateJobOutput>()({
    id: "jobs.create", method: "POST", path: "/s2/jobs", kind: "mutation", auth: "bearer",
    // S3 since 2026-10-21: a dispatcher opens a job for a call that came in by
    // phone, with no portal request behind it. Same handler, same derived SLA;
    // the unit of work holds a region-bound dispatcher to their own region.
    surfaces: ["S2", "S3"], carrier: "body", sdkMethod: "createJob",
    summary: "Author a job against a site. Opens its SLA timer in the same unit of work — due_at is DERIVED from the site's resolved sla_response term, never typed in (domain/sla deriveDueAt). Shadow mode until a region turns it off.",
  }),
  "sites.list": op<void, Wire.ListSitesOutput>()({
    id: "sites.list", method: "GET", path: "/s3/sites", kind: "query", auth: "bearer",
    surfaces: ["S3"], carrier: "none", sdkMethod: "listSites",
    summary: "Every active site a dispatcher may open a job at — the sites in their region (every region for a parent-scoped principal), with the customer each belongs to. What S3's New job form picks from.",
  }),
  "jobs.list": op<Wire.ListJobsInput, Wire.ListJobsOutput>()({
    id: "jobs.list", method: "GET", path: "/jobs", kind: "query", auth: "bearer",
    // S6 since item 6: a customer sees work at the sites it can see (0006's
    // ac_work_visible), and no crew — the assignment join returns nothing for
    // a customer principal, so currentCrew* are null on its rows by mechanism.
    // S8 since item 7: a firm sees work one of its own crews has been assigned
    // (0007's ac_firm_work_visible) — live or released — and the crew on the
    // row is its own, because the assignment join is behind the same rule.
    surfaces: ["S2", "S3", "S6", "S8"], carrier: "query", sdkMethod: "listJobs",
    summary: "Jobs visible to this principal — S2 org-wide, S3 region-locked, S6 at its own sites, S8 where its crews were sent, all by RLS, same operation. Carries each job's current (unreleased) assignment and open SLA timer, if any.",
  }),
  // ---- item 6: S6's first write. A customer asks for work; the office turns it into a job. ----
  "serviceRequests.create": op<Wire.CreateServiceRequestInput, Wire.CreateServiceRequestOutput>()({
    id: "serviceRequests.create", method: "POST", path: "/s6/service-requests", kind: "mutation", auth: "bearer",
    surfaces: ["S6"], carrier: "body", sdkMethod: "createServiceRequest",
    summary: "A customer's request for service at one of its sites. The site must be visible to the principal (RLS decides; an invisible site is 'unknown_site', not 'forbidden'); tenancy derives from the site. It is a request, not a job — S2/S3 open the job against it.",
  }),
  "serviceRequests.list": op<Wire.ListServiceRequestsInput, Wire.ListServiceRequestsOutput>()({
    id: "serviceRequests.list", method: "GET", path: "/service-requests", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3", "S6"], carrier: "query", sdkMethod: "listServiceRequests",
    summary: "Requests visible to this principal — a customer's own, the office's by region — with the site's name, the photos sent with it and, once one is opened, the job's state.",
  }),
  "serviceRequests.attachPhoto": op<Wire.AttachPhotoInput, Wire.AttachPhotoOutput>()({
    id: "serviceRequests.attachPhoto", method: "POST", path: "/s6/service-requests/photos", kind: "mutation", auth: "bearer",
    surfaces: ["S6"], carrier: "body", sdkMethod: "attachServiceRequestPhoto",
    summary: "One photo onto the customer's own request, as base64 in the body. JPEG, PNG or HEIC by the file's own bytes; at most PHOTO_MAX_BYTES each and PHOTOS_PER_REQUEST per request; only while no job is open against it. The gateway writes the object — the browser never reaches the bucket.",
  }),
  "serviceRequests.openJob": op<Wire.OpenRequestJobInput, Wire.OpenRequestJobOutput>()({
    id: "serviceRequests.openJob", method: "POST", path: "/s3/service-requests/open-job", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "openServiceRequestJob",
    summary: "The office answers a customer's request: opens a job at the request's site (jobs.create's own path — the SLA timer derived, never typed) and links the request to it, in one unit of work. A request is answered once; the link is final.",
  }),
  "serviceRequests.hold": op<Wire.CreateServiceRequestInput, Wire.CreateServiceRequestOutput>()({
    id: "serviceRequests.hold", method: "POST", path: "/s3/service-requests/hold", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "holdServiceRequest",
    summary: "A phoned-in call the office cannot open a job for yet — the site's agreement is missing a term with no default — recorded as a request at that site, so it waits in Intake instead of being lost. createServiceRequest's own path; the dispatcher is the requester. It is opened from Intake once Contracts sets the term.",
  }),
  "media.get": op<Wire.GetMediaInput, Wire.GetMediaOutput>()({
    id: "media.get", method: "GET", path: "/media", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3", "S6"], carrier: "query", sdkMethod: "getMedia",
    summary: "One stored photo, returned inline as a data: URL — read through the gateway under the same row security as the request it was sent with. A job's photos and signature (0034) are the office's alone. A surface never receives a bucket URL.",
  }),
  // ---- S3 ----
  "dispatch.assign": op<Wire.AssignInput, Wire.AssignOutput>()({
    id: "dispatch.assign", method: "POST", path: "/s3/assign", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "assignCrew",
    summary: "The one gated door. A crew that does not clear the whole service window is refused in plain words and nothing is written to assignments. Satisfies the job's SLA timer on success — the response the cascade is timing.",
  }),
  "dispatch.candidates": op<Wire.CandidateCrewsInput, Wire.CandidateCrewsOutput>()({
    id: "dispatch.candidates", method: "GET", path: "/s3/dispatch/candidates", kind: "query", auth: "bearer",
    surfaces: ["S3"], carrier: "query", sdkMethod: "candidateCrews",
    summary: "A DRY RUN of the same gate dispatch.assign enforces, over every active crew in the job's region — nothing is written. What a dispatcher reads before deciding, not a second gate with its own opinion.",
  }),
  "dispatch.release": op<Wire.ReleaseAssignmentInput, Wire.ReleaseAssignmentOutput>()({
    id: "dispatch.release", method: "POST", path: "/s3/release", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "releaseAssignment",
    summary: "Release a crew from a job that has not yet started (state still 'assigned') and return it to 'created' for re-dispatch. Once field execution has begun this is refused by name — that is a cancellation or a reassignment conversation, not a release.",
  }),
  "jobs.transition": op<Wire.TransitionJobInput, Wire.TransitionJobOutput>()({
    id: "jobs.transition", method: "POST", path: "/s3/jobs/transition", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "transitionJob",
    summary: "The office's hand on a job's state: waiting on the customer (quote requested, quote submitted, approved or declined; held mid-job and resumed), closing out a dispatched job the crew finished off-device (any field state to complete), cancelling one before the crew is on site (the crew is released with it), and what blocks the invoice (needs pricing, waiting on a PO or pictures, an invoice kicked back). Only the edges OFFICE_JOB_TRANSITIONS lists; anything else is refused by name as an illegal transition.",
  }),
  "jobs.addNote": op<Wire.AddJobNoteInput, Wire.AddJobNoteOutput>()({
    id: "jobs.addNote", method: "POST", path: "/s3/jobs/note", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "addJobNote",
    summary: "Write a note on a job. Append-only — a correction is a newer note — and internal: RLS shows notes to the office in the job's region and to nobody outside it. jobs.list carries the newest.",
  }),
  "manager.overview": op<void, Wire.ManagerOverviewOutput>()({
    id: "manager.overview", method: "GET", path: "/s3/manager", kind: "query", auth: "bearer",
    surfaces: ["S3"], carrier: "none", sdkMethod: "managerOverview",
    summary: "The company on one page for leadership: billed and completed this month against the same point last month, first-visit fixes, days per step from request to invoiced, labour against paid time, unbilled and unassigned work, expiring credentials, eight weeks of completed vs. invoiced, each branch, and the team. Org-wide, so only a principal or ops_leadership login at parent scope may call it (seesManagerOverview); anyone else is refused 403.",
  }),
  "jobs.setReturnTrip": op<Wire.SetReturnTripInput, Wire.SetReturnTripOutput>()({
    id: "jobs.setReturnTrip", method: "POST", path: "/s3/jobs/return-trip", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "setReturnTrip",
    summary: "Flag or clear a job as owing a second visit. Set by hand, never read out of note text. Does not bump the job's version — a flag is not a state change a device's offline log should be superseded by.",
  }),
  "jobs.detail": op<Wire.JobDetailInput, Wire.JobDetailOutput>()({
    id: "jobs.detail", method: "GET", path: "/s3/jobs/detail", kind: "query", auth: "bearer",
    surfaces: ["S3"], carrier: "query", sdkMethod: "jobDetail",
    summary: "One job as dispatch reads it: the board row, the site contact, every visit (assignment) with its logged span, every photo, every internal note, every customer update — drafts too — the customer thread, and how the field wrapped it up (0034). RLS decides; nothing here filters.",
  }),
  "jobs.conversation": op<Wire.JobConversationInput, Wire.JobConversationOutput>()({
    id: "jobs.conversation", method: "GET", path: "/jobs/conversation", kind: "query", auth: "bearer",
    surfaces: ["S6"], carrier: "query", sdkMethod: "jobConversation",
    summary: "What a customer reads about its job beyond the state: the updates dispatch PUBLISHED and the thread. A draft, an internal note, a crew or a photo key is not here — RLS (0016) returns only published updates to a customer.",
  }),
  "jobs.saveUpdate": op<Wire.SaveJobUpdateInput, Wire.SaveJobUpdateOutput>()({
    id: "jobs.saveUpdate", method: "POST", path: "/s3/jobs/update", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "saveJobUpdate",
    summary: "Write or edit a DRAFT of what the customer is told, usually from an internal note. A draft is invisible to the customer; a published update cannot be edited (0016's trigger) — a correction is a new update.",
  }),
  "jobs.publishUpdate": op<Wire.PublishJobUpdateInput, Wire.PublishJobUpdateOutput>()({
    id: "jobs.publishUpdate", method: "POST", path: "/s3/jobs/update/publish", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "publishJobUpdate",
    summary: "Publish a draft update to the customer. Once, by name: a second publish is refused as already_published. Delivery is the customer finding it in the portal — no email or push is sent.",
  }),
  "jobs.postMessage": op<Wire.PostJobMessageInput, Wire.PostJobMessageOutput>()({
    id: "jobs.postMessage", method: "POST", path: "/jobs/message", kind: "mutation", auth: "bearer",
    surfaces: ["S3", "S6"], carrier: "body", sdkMethod: "postJobMessage",
    summary: "Write in the job's customer thread. The office (S3) and the customer (S6) post through the same door; which side wrote it is the caller's namespace, never a field. Append-only.",
  }),
  // ---- item 4: the device shift grant (D-2a) — this device, this crew, this window ----
  "devices.list": op<Wire.ListDevicesInput, Wire.ListDevicesOutput>()({
    id: "devices.list", method: "GET", path: "/s2/devices", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listDevices",
    summary: "Registered hardware — ours and firms' own tablets and phones alike (D-2a: provisioning is a credential grant, not a shipment).",
  }),
  "devices.register": op<Wire.RegisterDeviceInput, Wire.RegisterDeviceOutput>()({
    id: "devices.register", method: "POST", path: "/s2/devices", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "registerDevice",
    summary: "Record a physical device. firmId ties it to hardware the firm already owns; absent, it is ours (INTERNAL_ORG).",
  }),
  "devices.grantShift": op<Wire.GrantShiftInput, Wire.GrantShiftOutput>()({
    id: "devices.grantShift", method: "POST", path: "/s2/devices/grant", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "grantDeviceShift",
    summary: "The primitive: this device, this crew, this technician, this window. What auth.deviceLogin mints a token against. Refused if the technician is not on the named crew, the crew is inactive, or the device already holds an overlapping grant.",
  }),
  // ---- S5: what a technician reads before replaying a sync batch ----
  "jobs.mine": op<void, Wire.MyJobsOutput>()({
    id: "jobs.mine", method: "GET", path: "/s5/jobs/mine", kind: "query", auth: "bearer",
    surfaces: ["S5"], carrier: "none", sdkMethod: "myJobs",
    summary: "Jobs assigned to this shift's crew, unreleased and still open — finished, cancelled or aborted work drops off (FIELD_CLOSED_STATES). Each carries what a crew needs at the curb — the job number, the site's name, address and primary contact — and the checklist items already done. The field layer's own read — no employment shape, no compliance detail, no other crew's board.",
  }),
  "punches.mine": op<Wire.MyPunchesInput, Wire.MyPunchesOutput>()({
    id: "punches.mine", method: "GET", path: "/s5/punches/mine", kind: "query", auth: "bearer",
    surfaces: ["S5"], carrier: "query", sdkMethod: "myPunches",
    summary: "The signed-in technician's own shift punches between two instants (at most 35 days apart), oldest first — every shift and every device they punched on, and nobody else's (0033). What the timesheet pairs into spans.",
  }),
  "jobs.attachMedia": op<Wire.AttachJobMediaInput, Wire.AttachJobMediaOutput>()({
    id: "jobs.attachMedia", method: "POST", path: "/s5/jobs/media", kind: "mutation", auth: "bearer",
    surfaces: ["S5"], carrier: "body", sdkMethod: "attachJobMedia",
    summary: "One photo or the customer's signature onto a job this device's crew holds, as base64 in the body (0034). JPEG, PNG or HEIC by the file's own bytes — a signature is a PNG — at most PHOTO_MAX_BYTES, at most JOB_MEDIA_MAX per job. Idempotent by the device's mutationId: a retried upload answers with the row it already wrote.",
  }),
  "jobs.wrapUp": op<Wire.WrapUpInput, Wire.WrapUpOutput>()({
    id: "jobs.wrapUp", method: "POST", path: "/s5/jobs/wrap-up", kind: "mutation", auth: "bearer",
    surfaces: ["S5"], carrier: "body", sdkMethod: "wrapUpJob",
    summary: "Close a visit from the field (0034): complete the job, in progress, and record how — Complete or Quote needed — with the notes, the signature or why there is none, and for a quote the RTU measurements. Every rule (WRAP_UP_MIN_PHOTOS, QUOTE_MIN_PHOTOS, the measurements) is checked against the media already uploaded, not the device's word. Idempotent by wrapUpId. A quote's QUOTE job is opened by the worker, not here.",
  }),
  "sync.replay": op<Wire.SyncReplayInput, Wire.SyncReplayOutput>()({
    id: "sync.replay", method: "POST", path: "/s5/sync", kind: "mutation", auth: "bearer",
    surfaces: ["S5"], carrier: "body", sdkMethod: "replaySync",
    summary: "Replay a device's offline log in device order. The device is the source of intent; the server is the source of truth.",
  }),
  "events.stream": op<void, never>()({
    id: "events.stream", method: "GET", path: "/events", kind: "stream", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "events",
    summary: "Server-sent domain events, filtered to the subscriber's region. At-least-once; dedupe on eventId.",
  }),
  "brand.setTheme": op<Wire.BrandThemeInput, Wire.BrandThemeOutput>()({
    id: "brand.setTheme", method: "POST", path: "/s2/brand/theme", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "setBrandTheme",
    summary: "Store a tenant's white-label theme. Validated against the ink schedule BEFORE it is a row: a theme that would break the portal is a 422 with the ratio, not a stylesheet nobody looks at until a customer does.",
  }),
  "brand.theme": op<Wire.BrandStylesheetInput, Wire.BrandStylesheetOutput>()({
    id: "brand.theme", method: "GET", path: "/brand/theme", kind: "system", auth: "none",
    surfaces: WHITE_LABEL_SURFACES, carrier: "query", sdkMethod: "brandTheme",
    summary: "The stored theme for a host, as the stylesheet the shell installs. Unauthenticated because a portal is branded on its sign-in screen, before a principal exists; an unknown host gets Rankine's own plate rather than a 404, so the route cannot be used to ask which tenants exist.",
  }),
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
  "coverage.list": op<void, Wire.CoverageOutput>()({
    id: "coverage.list", method: "GET", path: "/coverage", kind: "system", auth: "none",
    surfaces: ["S1"], carrier: "none", sdkMethod: "coverage",
    summary: "The metros we serve, read from the regions table — code and name, nothing else. No density, no availability, no response window: the ceiling on what S1 may promise is D7a/OQ6 and it is not written yet (F9).",
  }),
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
  "auth.anonymousSession": op<void, Wire.AnonymousSessionOutput>()({
    id: "auth.anonymousSession", method: "POST", path: "/auth/anonymous", kind: "login", auth: "none",
    surfaces: ["S1"], carrier: "none", sdkMethod: "anonymousSession",
    summary: "Mint a short-lived anonymous token bound to PROSPECT/UNASSIGNED for S1's intake. Carries no roles and no scope below the prospect root; the only thing it can do is the two writes below.",
  }),
  "leads.submit": op<Wire.SubmitLeadInput, Wire.SubmitLeadOutput>()({
    id: "leads.submit", method: "POST", path: "/s1/leads", kind: "mutation", auth: "bearer",
    surfaces: ["S1"], carrier: "body", sdkMethod: "submitLead",
    summary: "A stranger asks us to call them. Lands in PROSPECT/UNASSIGNED — tenancy is total, so a lead is owned before an account exists (arc 1). The submitter can never read it back.",
  }),
  "callRecords.record": op<Wire.RecordCallInput, Wire.RecordCallOutput>()({
    id: "callRecords.record", method: "POST", path: "/s1/call-records", kind: "mutation", auth: "bearer",
    surfaces: ["S1"], carrier: "body", sdkMethod: "recordCall",
    summary: "A visitor used the call button. Recorded against the lead when there is one, and against nothing when there is not — an inbound call is a fact whether or not a form was filled.",
  }),
  // ---- item 10: S4, the HQ view. Two reads of the rollup and nothing else:
  // `SURFACES.S4.writes` is [] and 0010 grants the gateway no write on
  // hq_metrics, so there is no request path here that changes anything.
  "hq.metrics": op<Wire.HqMetricsInput, Wire.HqMetricsOutput>()({
    id: "hq.metrics", method: "GET", path: "/s4/metrics", kind: "query", auth: "bearer",
    surfaces: ["S4"], carrier: "query", sdkMethod: "hqMetrics",
    summary: "Every figure in the HQ register for every region, as of the latest rollup (or the close of a given day), with the moment it was computed. Read from hq_metrics alone — the operational tables are the worker's to read.",
  }),
  "hq.history": op<Wire.HqHistoryInput, Wire.HqHistoryOutput>()({
    id: "hq.history", method: "GET", path: "/s4/metrics/history", kind: "query", auth: "bearer",
    surfaces: ["S4"], carrier: "query", sdkMethod: "hqHistory",
    summary: "One figure's daily closing values per region over the last N days (default 30, at most 90) — the trend behind a number on the dashboard.",
  }),
  // ---- item 11: PROCUREMENT. The office's purchasing (S2) and the vendor's
  // side of the same rows (S7). Reads are served to both; what each may see
  // and change is 0011's.
  "vendors.list": op<void, Wire.ListVendorsOutput>()({
    id: "vendors.list", method: "GET", path: "/procurement/vendors", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "none", sdkMethod: "listVendors",
    summary: "Vendors — the office sees every one; a vendor sees its own row. RLS (0011), not a WHERE.",
  }),
  "vendors.create": op<Wire.CreateVendorInput, Wire.CreateVendorOutput>()({
    id: "vendors.create", method: "POST", path: "/s2/procurement/vendors", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createVendor",
    summary: "Record a vendor WITH its tenant root in one unit of work: the organizations row and the vendors row share an id, in the region it is administered from.",
  }),
  "receivingPoints.list": op<void, Wire.ListReceivingPointsOutput>()({
    id: "receivingPoints.list", method: "GET", path: "/procurement/receiving-points", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "none", sdkMethod: "listReceivingPoints",
    summary: "Our receiving points. A vendor sees the ones its issued orders ship to — code, tier, address — and never a customer's name, because the row carries none.",
  }),
  "receivingPoints.create": op<Wire.CreateReceivingPointInput, Wire.CreateReceivingPointOutput>()({
    id: "receivingPoints.create", method: "POST", path: "/s2/procurement/receiving-points", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createReceivingPoint",
    summary: "Record a receiving point: a code, a tier (location stock, regional hub, national), the region and the address.",
  }),
  "catalog.list": op<Wire.ListCatalogInput, Wire.ListCatalogOutput>()({
    id: "catalog.list", method: "GET", path: "/procurement/catalog", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "listCatalog",
    summary: "A vendor's catalogue: each item with the price in effect today (accepted) and any proposal waiting on the office.",
  }),
  "catalog.addItem": op<Wire.AddCatalogItemInput, Wire.AddCatalogItemOutput>()({
    id: "catalog.addItem", method: "POST", path: "/s2/procurement/catalog", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "addCatalogItem",
    summary: "Add an item to a vendor's catalogue — the vendor's SKU, a description, the unit. It has no price until the vendor proposes one and the office accepts it.",
  }),
  "prices.propose": op<Wire.ProposePriceInput, Wire.ProposePriceOutput>()({
    id: "prices.propose", method: "POST", path: "/s7/procurement/prices", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "proposePrice",
    summary: "A vendor proposes a price for one of its items from a day. Arrives proposed whatever the request says (0011); applies only once the office accepts it.",
  }),
  "prices.withdraw": op<Wire.WithdrawPriceInput, Wire.WithdrawPriceOutput>()({
    id: "prices.withdraw", method: "POST", path: "/s7/procurement/prices/withdraw", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "withdrawPrice",
    summary: "A vendor withdraws its own proposal before the office decides it: proposed → withdrawn, nothing else.",
  }),
  "prices.decide": op<Wire.DecidePriceInput, Wire.DecidePriceOutput>()({
    id: "prices.decide", method: "POST", path: "/s2/procurement/prices/decide", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "decidePrice",
    summary: "The office accepts or rejects a proposed price. Accepting closes the price in effect at the proposal's first day; two accepted prices at once are refused by the EXCLUDE constraint.",
  }),
  "pos.list": op<Wire.ListPurchaseOrdersInput, Wire.ListPurchaseOrdersOutput>()({
    id: "pos.list", method: "GET", path: "/procurement/pos", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "listPurchaseOrders",
    summary: "Purchase orders — every one for the office; a vendor's own once issued (a draft is ours).",
  }),
  "pos.detail": op<Wire.PurchaseOrderDetailInput, Wire.PurchaseOrderDetailOutput>()({
    id: "pos.detail", method: "GET", path: "/procurement/pos/detail", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "purchaseOrder",
    summary: "One purchase order: its lines with ordered, shipped, received and invoiced quantities, the receiving point, and every shipment, receipt, invoice and return against it.",
  }),
  "pos.create": op<Wire.CreatePurchaseOrderInput, Wire.CreatePurchaseOrderOutput>()({
    id: "pos.create", method: "POST", path: "/s2/procurement/pos", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createPurchaseOrder",
    summary: "Raise a draft purchase order to a vendor for a receiving point. Each line takes the item's ACCEPTED price today and keeps it; an item with none is refused by name.",
  }),
  "pos.issue": op<Wire.PoIdInput, Wire.PoTransitionOutput>()({
    id: "pos.issue", method: "POST", path: "/s2/procurement/pos/issue", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "issuePurchaseOrder",
    summary: "Send a draft to the vendor: draft → issued. From here the vendor can see it.",
  }),
  "pos.cancel": op<Wire.CancelPurchaseOrderInput, Wire.PoTransitionOutput>()({
    id: "pos.cancel", method: "POST", path: "/s2/procurement/pos/cancel", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "cancelPurchaseOrder",
    summary: "Cancel an order nothing has shipped against yet.",
  }),
  "pos.acknowledge": op<Wire.AcknowledgePurchaseOrderInput, Wire.PoTransitionOutput>()({
    id: "pos.acknowledge", method: "POST", path: "/s7/procurement/pos/acknowledge", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "acknowledgePurchaseOrder",
    summary: "The vendor accepts an issued order and says when it will ship: issued → acknowledged with a promised ship date. The one change a vendor makes to an order (0011).",
  }),
  "shipments.record": op<Wire.RecordShipmentInput, Wire.RecordShipmentOutput>()({
    id: "shipments.record", method: "POST", path: "/s7/procurement/shipments", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "recordShipment",
    summary: "The vendor records a shipment against an acknowledged order — the day, the carrier, the tracking, and quantities per line, never more than ordered.",
  }),
  "receipts.record": op<Wire.RecordReceiptInput, Wire.RecordReceiptOutput>()({
    id: "receipts.record", method: "POST", path: "/s2/procurement/receipts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordReceipt",
    summary: "The office records what arrived, per line, never more than ordered. The order is received when every line is.",
  }),
  "vendorInvoices.submit": op<Wire.SubmitVendorInvoiceInput, Wire.SubmitVendorInvoiceOutput>()({
    id: "vendorInvoices.submit", method: "POST", path: "/s7/procurement/invoices", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "submitVendorInvoice",
    summary: "The vendor submits an invoice against an order. The gateway matches it three ways — price against the order, quantity against the receipt — and records matched or held with every reason.",
  }),
  "vendorInvoices.list": op<Wire.ListVendorInvoicesInput, Wire.ListVendorInvoicesOutput>()({
    id: "vendorInvoices.list", method: "GET", path: "/procurement/invoices", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "listVendorInvoices",
    summary: "Vendor invoices with their lines and their match verdict — every one for the office, its own for a vendor.",
  }),
  "rmas.request": op<Wire.RequestReturnInput, Wire.RequestReturnOutput>()({
    id: "rmas.request", method: "POST", path: "/s2/procurement/rmas", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "requestReturn",
    summary: "The office asks to return part of a received line, with the reason. Never more than was received.",
  }),
  "rmas.respond": op<Wire.RespondToReturnInput, Wire.RespondToReturnOutput>()({
    id: "rmas.respond", method: "POST", path: "/s7/procurement/rmas/respond", kind: "mutation", auth: "bearer",
    surfaces: ["S7"], carrier: "body", sdkMethod: "respondToReturn",
    summary: "The vendor answers a requested return once: authorized with its RMA number, or rejected with a reason.",
  }),
  "rmas.list": op<Wire.ListReturnsInput, Wire.ListReturnsOutput>()({
    id: "rmas.list", method: "GET", path: "/procurement/rmas", kind: "query", auth: "bearer",
    surfaces: ["S2", "S7"], carrier: "query", sdkMethod: "listReturns",
    summary: "Returns — every one for the office, its own for a vendor.",
  }),
  // ---- 0035: company messages. A direct message, or one message to every active company login. ----
  "messages.directory": op<void, Wire.StaffDirectoryOutput>()({
    id: "messages.directory", method: "GET", path: "/messages/directory", kind: "query", auth: "bearer",
    surfaces: COMPANY, carrier: "none", sdkMethod: "listColleagues",
    summary: "Every other active AC Services employee — name, the presence they set, and their roles. Customers, subcontractors and vendors are not in it.",
  }),
  "messages.pending": op<void, Wire.StaffPendingOutput>()({
    id: "messages.pending", method: "GET", path: "/messages/pending", kind: "query", auth: "bearer",
    surfaces: COMPANY, carrier: "none", sdkMethod: "pendingMessages",
    summary: "Messages sent to the caller that they have not dismissed. What the corner pop-ups show. A person's own send is not in this list.",
  }),
  "messages.recent": op<void, Wire.StaffRecentOutput>()({
    id: "messages.recent", method: "GET", path: "/messages/recent", kind: "query", auth: "bearer",
    surfaces: COMPANY, carrier: "none", sdkMethod: "recentMessages",
    summary: "The caller's recent messages, sent and received, newest first.",
  }),
  "messages.send": op<Wire.SendStaffMessageInput, Wire.SendStaffMessageOutput>()({
    id: "messages.send", method: "POST", path: "/messages", kind: "mutation", auth: "bearer",
    surfaces: COMPANY, carrier: "body", sdkMethod: "sendMessage",
    summary: "Send a message to one AC Services employee, or to every active AC Services employee. Customers, subcontractors and vendors are not recipients. The sender does not receive a copy of their own.",
  }),
  "messages.dismiss": op<Wire.DismissStaffMessageInput, Wire.DismissStaffMessageOutput>()({
    id: "messages.dismiss", method: "POST", path: "/messages/dismiss", kind: "mutation", auth: "bearer",
    surfaces: COMPANY, carrier: "body", sdkMethod: "dismissMessage",
    summary: "Dismiss the caller's own copy of a message. It leaves the corner and stays in the recent list.",
  }),
  "system.health": op<void, Wire.HealthOutput>()({
    id: "system.health", method: "GET", path: "/healthz", kind: "system", auth: "none",
    surfaces: ["S1", ...AUTHENTICATED], carrier: "none", sdkMethod: "health",
    summary: "Liveness and the enabled surface list. The shell's degraded probe.",
  }),
} as const satisfies Record<string, OperationSpec>;
