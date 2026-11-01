import {
  brandCss, validateBrandTheme, admitAccent, BRAND_OVERRIDABLE,
  type AccentAdmission,
} from "../../../../packages/tokens/src/index.ts";
import type { AccentAdmissionWire, BrandThemeInput, BrandStylesheetOutput } from "../../../../packages/contracts/src/operations.ts";
import type { UnitOfWork, Tx } from "../unit-of-work.ts";
import { InputRefused } from "../refusals.ts";

/**
 * WHITE-LABEL, END TO END. The caller packages/tokens was written for.
 *
 * `brandCss` and `validateBrandTheme` existed and nothing called them, which
 * made the strongest claim in that module — "validation runs BEFORE storage,
 * not at render, and not in a designer's head" — a sentence about a path that
 * did not exist. This file is the path:
 *
 *   S2 saves     → validate → admit → store the theme AND the verdict
 *   a portal boots → look up by host → brandCss(stored) → the shell installs it
 *
 * The two halves are deliberately asymmetric. The write is a unit of work: a
 * mutation, audited, evented, allowlisted to S2 like every other piece of
 * account truth. The read is unauthenticated and unscoped, because a customer
 * portal is branded on its SIGN-IN screen, before any principal exists.
 */

/** A hostname is a key, so it is normalised once, here, and never at a call site. */
export const normaliseHost = (host: string): string => host.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");

const wire = (a: AccentAdmission): AccentAdmissionWire => ({
  stateSurfaces: a.stateSurfaces, achromatic: a.achromatic,
  // Tenths of a degree. Not toFixed(): the money rule is right that a formatted
  // float in a stored field is a habit, and a hue separation is a number here,
  // not a string the account manager's screen happens to render.
  minSeparation: Math.round(a.minSeparation * 10) / 10, nearestState: a.nearestState,
  tiers: a.tiers, notes: a.notes,
});

/**
 * S2 → gateway: store a tenant's theme.
 *
 * Every refusal carries the number. "Insufficient contrast" starts an argument
 * with a brand team and "3.17:1, needs 4.5:1" ends one — which is why the
 * validator returns ratios and this handler passes them through verbatim
 * rather than summarising them into "invalid theme".
 *
 * Note what is NOT refused: an accent that fails the hue gate or the plate
 * ground. Those narrow where the accent may be PAINTED, and the verdict is
 * stored so the narrowing is visible; a tenant whose brand colour is simply
 * their brand colour is not turned away at the door.
 */
export const setBrandTheme = async (
  uow: UnitOfWork,
  authorId: string,
  input: BrandThemeInput,
): Promise<{ host: string; eventId: string; admission: AccentAdmissionWire }> => {
  const host = normaliseHost(input.host ?? "");
  if (!host) throw new InputRefused("a theme needs the host it answers for", "no_host");
  if (!/^[a-z0-9.-]+$/.test(host)) throw new InputRefused(`"${input.host}" is not a hostname`, "bad_host");
  if (!/^#[0-9a-fA-F]{6}$/.test(input.accent ?? "")) {
    throw new InputRefused(`accent "${input.accent}" must be #rrggbb — the gate measures it, and it cannot measure a name`, "bad_accent");
  }

  const rejections = validateBrandTheme(input.overrides);
  if (rejections.length) {
    // One refusal, every reason, each with its ratio. A brand team that has to
    // come back four times for four numbers stops reading them.
    throw new InputRefused(
      rejections.map((r) => `${r.token}: ${r.reason}`).join(" "),
      "theme_rejected",
    );
  }

  const admission = admitAccent(input.accent);
  // Proves the emitted stylesheet parses and is scoped, before it is a row —
  // it throws on exactly the rejections above, so reaching here means it cannot.
  const css = brandCss(input.overrides);

  const after = { host, accent: input.accent, overrides: input.overrides, slots: BRAND_OVERRIDABLE.length };
  const eventId = await uow.apply(
    {
      entity: "brand_theme", entityId: input.orgId, action: "brand_theme.set", topic: "brand.theme_set",
      before: null, after, orgId: input.orgId, regionId: input.regionId,
      payload: { host, accent: input.accent, stateSurfaces: admission.stateSurfaces, bytes: css.length },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO brand_themes (org_id, region_id, host, accent, overrides, accent_admission, authored_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
         ON CONFLICT (org_id) DO UPDATE SET
           host = EXCLUDED.host, accent = EXCLUDED.accent, overrides = EXCLUDED.overrides,
           accent_admission = EXCLUDED.accent_admission, authored_by = EXCLUDED.authored_by, updated_at = now()`,
        [input.orgId, input.regionId, host, input.accent, JSON.stringify(input.overrides), JSON.stringify(wire(admission)), authorId],
      );
    },
  );
  return { host, eventId, admission: wire(admission) };
};

type ThemeRow = { overrides: Record<string, string>; accent_admission: AccentAdmissionWire };

/**
 * A portal boots: what should it look like?
 *
 * An unknown host gets Rankine's own plate and `tenant: false`. Not a 404 —
 * this route is reachable without a token, so a 404 would answer "is X one of
 * your customers?" for anyone who asks. The honest answer is also the useful
 * one: there is never an unstyled state, only a re-brand.
 *
 * A stored theme has already passed the validator, so this path does not
 * re-validate. It re-EMITS, through the same `brandCss` that refuses — so a
 * row that somehow stopped being valid (a token removed from
 * BRAND_OVERRIDABLE in a later release) fails loudly here rather than
 * silently serving a stylesheet the current schedule would reject.
 */
export const brandStylesheetFor = async (tx: Tx, host: string | undefined): Promise<BrandStylesheetOutput> => {
  const key = normaliseHost(host ?? "");
  const none: BrandStylesheetOutput = { tenant: false, css: "", admission: null };
  if (!key) return none;
  const row = (await tx.query<ThemeRow>("SELECT overrides, accent_admission FROM brand_themes WHERE host = $1", [key]))[0];
  if (!row) return none;
  return { tenant: true, css: brandCss(row.overrides), admission: row.accent_admission };
};
