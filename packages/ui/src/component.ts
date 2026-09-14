import type { Density } from "@ac/tokens";

/**
 * Every component declares the densities it is CORRECT in. Using one outside
 * its set is a type error, not a visual bug found in the field.
 *
 * The load-bearing example: ComplianceBadge is deliberately unavailable in
 * field density. A crew cannot act on a refusal, and showing them one invites a
 * conversation about overrides that has no good ending — in a parking lot, at
 * 7am, with a customer watching.
 */
export type ComponentSpec<D extends Density> = {
  readonly name: string;
  readonly densities: readonly D[];
  readonly notes?: string;
};

export const declare = <D extends Density>(spec: ComponentSpec<D>): ComponentSpec<D> =>
  Object.freeze(spec);

export const DataGrid = declare({
  name: "DataGrid",
  densities: ["console", "comfort"] as const,
  notes: "Forty rows scanned with a mouse. There is no field variant; a grid on a 7-inch screen in sunlight is a screenshot of a grid.",
});

export const ComplianceBadge = declare({
  name: "ComplianceBadge",
  densities: ["console"] as const,
  notes: "Dispatch only. Never field — see above. Never the customer portal either; our crew paperwork is not the customer's business.",
});

export const StatusPill = declare({
  name: "StatusPill",
  densities: ["console", "comfort", "field"] as const,
  notes: "Glyph + word + colour, always all three. Colour alone is a breach nobody escalated.",
});

export const PrimaryAction = declare({
  name: "PrimaryAction",
  densities: ["console", "comfort", "field"] as const,
  notes: "56px and no hover dependency in field density. There is no cursor on a tablet, so a hover-only affordance is an invisible control.",
});
