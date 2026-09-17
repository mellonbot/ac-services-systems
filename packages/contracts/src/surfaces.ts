import type { WriteEntity } from "./entities.ts";
import type { Namespace, Role } from "./scope.ts";

/**
 * THE SURFACE REGISTRY.
 *
 * Eight websites. None owns data. Each is a scoped view onto the same
 * multi-tenant hierarchy, reached only through the gateway.
 *
 * This file is data, and that is the point:
 *   - `writes` is enforced on every mutation by the gateway unit of work.
 *     S4's empty list is not a rule anyone has to remember.
 *   - `phase` + `enabled` make deferring a surface (D9) a data change.
 *   - `density` is checked against each component's declared density set,
 *     so a console-density control cannot compile into the field app.
 *   - `degraded` is S0's per-surface declaration, written down before the
 *     outage rather than discovered during it.
 */
export type SurfaceId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
export type Block = "OFC" | "FLD" | "INV";
export type Density = "console" | "comfort" | "field";
export type Phase = 1 | 2 | 3 | 4;

export type Surface = {
  readonly id: SurfaceId;
  readonly name: string;
  readonly app: string;
  readonly block: Block;
  readonly phase: Phase;
  readonly enabled: boolean;
  readonly namespace: Namespace;
  /** Internal surfaces: the roles that may open a unit of work here. Checked by the gateway before any handler runs. */
  readonly roles?: readonly Role[];
  /** Human statement of the auth scope; the mechanism is `scopeBinding`. */
  readonly authScope: string;
  readonly scopeBinding: "none" | "org" | "region" | "customer_tier" | "firm" | "vendor" | "device_shift";
  readonly writes: readonly WriteEntity[];
  readonly density: Density;
  /** Realtime is a hard requirement, not a nice-to-have, where true. */
  readonly realtime: boolean;
  /** Offline writes. False on S2 by design — it must never fork the truth. */
  readonly offline: boolean;
  /** What this surface does when the backbone is unreachable. S0 obligation. */
  readonly degraded: string;
  /**
   * Does this surface render the state ramp — a status pill, a compliance
   * badge, an SLA figure, a refusal?
   *
   * TRUE bars the brand accent here. Red measures 1.2° from the fault ink, so a
   * red control beside a state chip reads as an alarm; `tokenCss` resolves
   * `color.brand` to Ink Black on these surfaces, exactly as it does for a
   * tenant accent that fails the gate (packages/tokens/src/whitelabel.ts).
   *
   * It is declared here rather than inferred, because "does this screen show
   * state" is a product fact, and the safe answer is the default: a new surface
   * that forgets to say renders in the neutral.
   */
  readonly stateRamp: boolean;
  /**
   * A TENANT MAY REPAINT THIS SURFACE.
   *
   * White-label is a permission, and the permission is declared here rather
   * than decided by whoever writes the frame. Three things read this flag and
   * they must not disagree: the frame emitter (whether the surface carries a
   * brand slot at all), the operation catalogue (which surfaces may ask the
   * gateway for a theme), and the shell (whether to ask).
   *
   * It is false on every internal surface and on the field tablet, and the
   * field case is the load-bearing one: the tablet is an instrument, and a
   * technician reads the board the same way in every tenant or it is not one.
   * packages/tokens TENANT_SCOPE says the same thing as a selector; a test
   * holds the two together.
   */
  readonly whiteLabel: boolean;
};

const REGISTRY = {
  S1: {
    id: "S1", name: "Marketing / lead-gen", app: "s1-marketing",
    block: "OFC", phase: 1, enabled: true,
    namespace: "anonymous", authScope: "none (anonymous)", scopeBinding: "none",
    writes: ["lead", "call_record"],
    density: "comfort", realtime: false, offline: false,
    degraded: "Statically generated; forms queue to a durable buffer and replay. Site stays up when the gateway does not. Coverage map is read from the hierarchy — never hard-coded (D14: supply before signature).",
    // The only surface that shows no state: an anonymous visitor has nothing
    // under SLA and no compliance to read. So it is the only one that wears the
    // brand red, which is also the one place the brand has to do its work.
    stateRamp: false,
    whiteLabel: false,
  },
  S2: {
    id: "S2", name: "Service Manager", app: "s2-service-manager",
    block: "OFC", phase: 1, enabled: true,
    namespace: "internal", authScope: "role-based, org-wide", scopeBinding: "org",
    roles: ["principal", "ops_leadership", "account_owner", "office_manager", "finance", "warehouse"],
    writes: ["account", "contract", "invoice", "warranty_case", "part", "purchase_order",
             // C4: the network registry. `crew` was added 2026-09-16 — the
             // registry listed the firm, the document and the price, and not
             // the crew they all attach to. S8's `crew_roster` is a firm's
             // proposal; the crew row itself is ours to record.
             "subcontractor_firm", "crew", "crew_credential", "rate_card", "brand_theme"],
    density: "console", realtime: false, offline: false,
    degraded: "Read-only from last server state. NO offline writes, ever — this is the only surface that authors hierarchy, contract and subcontractor-network truth, and a forked truth here is unrecoverable.",
    stateRamp: true,
    whiteLabel: false,
  },
  S3: {
    id: "S3", name: "Dispatch Console", app: "s3-dispatch-console",
    block: "OFC", phase: 1, enabled: true,
    namespace: "internal", authScope: "region-scoped", scopeBinding: "region",
    roles: ["dispatcher", "foreman", "ops_leadership", "principal"],
    writes: ["assignment", "job_state", "crew_release", "escalation"],
    density: "console", realtime: true, offline: false,
    degraded: "Board freezes with a visible staleness clock and stops accepting assignments. A dispatcher acting on a stale board is worse than a dispatcher who knows the board is stale. The compliance gate is enforced HERE, at assignment, with no override path.",
    stateRamp: true,
    whiteLabel: false,
  },
  S4: {
    id: "S4", name: "HQ Ops Dashboard", app: "s4-hq-dashboard",
    block: "OFC", phase: 2, enabled: false,
    namespace: "internal", authScope: "org-wide READ only", scopeBinding: "org",
    roles: ["principal", "ops_leadership", "account_owner", "readonly"],
    // Empty by construction. If HQ can reassign a crew from here, regional
    // autonomy is decorative. See OPEN-S4 — 05 Rev B lists annotation and
    // acknowledgement; granting them is one reviewed line, and it is not
    // ours to sign.
    writes: [],
    density: "console", realtime: false, offline: false,
    degraded: "Warehouse-backed and already asynchronous; shows the age of its last rollup and nothing more.",
    stateRamp: true,
    whiteLabel: false,
  },
  S5: {
    id: "S5", name: "Technician web fallback", app: "s5-technician",
    block: "FLD", phase: 1, enabled: true,
    namespace: "device", authScope: "tech credential + shift device grant", scopeBinding: "device_shift",
    writes: ["job_state", "checklist", "photo", "part_used", "time_entry", "signature"],
    density: "field", realtime: false, offline: true,
    degraded: "Offline-first: device holds intent, server holds truth, replay is idempotent by client-generated mutation id. `assignments` is server-authoritative so an offline device cannot route around the compliance gate. IDENTICAL for employed and subcontracted crews.",
    stateRamp: true,
    whiteLabel: false,
  },
  S6: {
    id: "S6", name: "Customer Portal", app: "s6-customer-portal",
    block: "INV", phase: 1, enabled: true,
    namespace: "customer", authScope: "customer IdP + tier claim", scopeBinding: "customer_tier",
    writes: ["service_request", "payment", "contact_update"],
    density: "comfort", realtime: false, offline: false,
    degraded: "Cached read of last known job and invoice state, clearly timestamped; request intake queues. One codebase, four scopes — scoping is enforced at the gateway, never by client-side filtering.",
    stateRamp: true,
    whiteLabel: true,
  },
  S7: {
    id: "S7", name: "Vendor Portal", app: "s7-vendor-portal",
    block: "INV", phase: 4, enabled: false,
    namespace: "vendor", authScope: "separate vendor namespace", scopeBinding: "vendor",
    writes: ["po_ack", "ship_date", "vendor_invoice", "catalog_price", "rma"],
    density: "comfort", realtime: false, offline: false,
    degraded: "Read-only PO list. Vendors see parts, POs and destination tier — never customer names, never job records.",
    stateRamp: true,
    whiteLabel: false,
  },
  S8: {
    id: "S8", name: "Subcontractor Portal", app: "s8-subcontractor-portal",
    block: "INV", phase: 1, enabled: true,
    namespace: "subcontractor", authScope: "subcontractor firm namespace", scopeBinding: "firm",
    // D12 minimum cut: compliance intake + settlement visibility. Widening to
    // assignment/scheduling in Phase 2 is one reviewed line.
    writes: ["compliance_doc", "crew_roster", "settlement_ack", "dispute"],
    density: "comfort", realtime: false, offline: false,
    degraded: "Document upload queues to durable storage and acknowledges on receipt, not on processing. Settlement views serve last statement. A firm sees its own crews, its own jobs, its own compliance, its own money — never another firm's rate card.",
    stateRamp: true,
    whiteLabel: false,
  },
} as const satisfies { readonly [K in SurfaceId]: Surface };

export const SURFACES: { readonly [K in SurfaceId]: Surface } = REGISTRY;

/**
 * The registry row's density, LITERALLY typed: `densityOf("S5")` is `"field"`,
 * not `Density`. This is what lets a component's declared density set be a
 * compile-time check at the call site — a console-only ComplianceBadge handed
 * the S5 density is a type error in the surface, not a screenshot from a
 * parking lot. `SURFACES[id].density` is the same value widened to the union,
 * for the gateway and anything else that indexes by a runtime id.
 */
export type DensityOf<Id extends SurfaceId> = (typeof REGISTRY)[Id]["density"];
export const densityOf = <Id extends SurfaceId>(id: Id): DensityOf<Id> => REGISTRY[id].density;

export const SURFACE_IDS = Object.keys(SURFACES) as readonly SurfaceId[];

export const surfacesInPhase = (phase: Phase): readonly Surface[] =>
  SURFACE_IDS.map((id) => SURFACES[id]).filter((s) => s.phase === phase);

/**
 * The question the gateway asks on every mutation. Not a convention — the
 * unit of work cannot commit without an answer.
 */
export const mayWrite = (id: SurfaceId, entity: WriteEntity): boolean =>
  SURFACES[id].writes.includes(entity);

/**
 * The surfaces a tenant may repaint — derived, never a second list. The
 * operation catalogue serves `brand.theme` to exactly these, the frame emitter
 * gives exactly these a brand slot, and the shell asks for a theme on exactly
 * these. One flag, read three times, so the three cannot drift apart.
 */
export const WHITE_LABEL_SURFACES: readonly SurfaceId[] =
  Object.freeze(SURFACE_IDS.filter((id) => SURFACES[id].whiteLabel));

export const isWhiteLabel = (id: SurfaceId): boolean => SURFACES[id].whiteLabel;
