import type { Density } from "../../tokens/src/index.ts";

/**
 * Every component declares the densities it is CORRECT in. Using one outside
 * its set is a type error, not a visual bug found in the field.
 *
 * The load-bearing example: ComplianceBadge is deliberately unavailable in
 * field density. A crew cannot act on a refusal, and showing them one invites a
 * conversation about overrides that has no good ending — in a parking lot, at
 * 7am, with a customer watching.
 *
 * These are the SPECS. The implementations live beside them in ./components/
 * and are typed against them through `component()` in ./render.ts: a view's
 * `density` prop is exactly the spec's set. The specs stay separate so the
 * guard, the tests and the docs can read a component's contract without
 * loading a renderer.
 */
export type ComponentSpec<D extends Density> = {
  readonly name: string;
  readonly densities: readonly D[];
  readonly notes?: string;
};

export const declare = <D extends Density>(spec: ComponentSpec<D>): ComponentSpec<D> =>
  Object.freeze(spec);

export const DataGridSpec = declare({
  name: "DataGrid",
  densities: ["console", "comfort"] as const,
  notes: "Forty rows scanned with a mouse. There is no field variant; a grid on a 7-inch screen in sunlight is a screenshot of a grid.",
});

export const ComplianceBadgeSpec = declare({
  name: "ComplianceBadge",
  densities: ["console"] as const,
  notes: "Dispatch only. Never field — see above. Never the customer portal either; our crew paperwork is not the customer's business.",
});

export const StatusPillSpec = declare({
  name: "StatusPill",
  densities: ["console", "comfort", "field"] as const,
  notes: "Glyph + word + colour, always all three. Colour alone is a breach nobody escalated.",
});

export const PrimaryActionSpec = declare({
  name: "PrimaryAction",
  densities: ["console", "comfort", "field"] as const,
  notes: "56px and no hover dependency in field density. There is no cursor on a tablet, so a hover-only affordance is an invisible control.",
});

export const RefusalCardSpec = declare({
  name: "RefusalCard",
  densities: ["console"] as const,
  notes: "A refusal rendered as a decision: the axis, the gateway's message verbatim, the permitted tiers, and a route. ComplianceBadge's sibling — the people who can act on a refusal sit at a console.",
});

export const DegradedBannerSpec = declare({
  name: "DegradedBanner",
  densities: ["console", "comfort", "field"] as const,
  notes: "The surface's declared degraded text and the age of the last good answer. Every surface renders this; none writes the flag it reads.",
});

/** Every spec, for the guard and the docs. */
export const COMPONENT_SPECS = Object.freeze([
  DataGridSpec, ComplianceBadgeSpec, StatusPillSpec, PrimaryActionSpec, RefusalCardSpec, DegradedBannerSpec,
] as const);
