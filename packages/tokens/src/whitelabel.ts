import { SEMANTIC, BRAND_OVERRIDABLE, STATE_ROLES, type SemanticToken } from "./semantic.ts";
import { PRIMITIVES as P } from "./primitives.ts";
import { MARK_GLYPHS as M } from "./type.ts";

/** WCAG relative luminance. No dependency — this must run at authoring time. */
const luminance = (hex: string): number => {
  const v = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
};

export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Hue in degrees. The accent gate's first question, and the one a ratio cannot answer. */
export const hueOf = (hex: string): number => {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
};

/** Shortest angular distance between two hues. */
export const hueSeparation = (a: string, b: string): number => {
  const d = Math.abs(hueOf(a) - hueOf(b));
  return Math.min(d, 360 - d);
};

/** Max channel minus min, 0..1. The question `hueOf` cannot answer: is there a hue here at all? */
export const chromaOf = (hex: string): number => {
  const v = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  return Math.max(...ch) - Math.min(...ch);
};

/**
 * Below this there is no hue to collide with, and `hueOf` says 0° — pure red —
 * because that is what the HSL formula returns when the channels are equal.
 * A tenant whose accent is charcoal was being read as 6.1° from oxblood and
 * barred from every state surface for a hue it does not have.
 *
 * 0.06 keeps the warm near-neutrals chromatic on purpose: our own `ink.mid`
 * measures 0.078 and slate blue 0.125, and both DO read as a colour next to a
 * state chip.
 */
export const ACHROMATIC_MAX_CHROMA = 0.06;

export const isAchromatic = (hex: string): boolean => chromaOf(hex) <= ACHROMATIC_MAX_CHROMA;

export type ThemeRejection = { readonly token: string; readonly reason: string };

/**
 * THE ACCENT GATE — bulletin Plate 5, errata E-04.
 *
 * White-label ends in a token: a tenant supplies a logo, a domain and an
 * accent, and the structure is untouched. The accent was the hole. Every
 * guarantee in the ink schedule assumes the state ramp is the only meaningful
 * colour on the surface — and then hands a customer's marketing department a
 * colour slot on that same surface, with no gate.
 *
 * A tenant accent inside the state ramp's hue range does not break the theme.
 * It does something worse: it converts decoration into apparent state. A
 * dispatcher learns that red-ish means breached, then opens a tenant portal
 * where red-ish means their logo.
 */
export const ACCENT_GATE = Object.freeze({
  /** Degrees of separation required from every state hue, in both stocks. */
  minHueSeparation: 30,
  /** The light ground an accent must clear as text. */
  lightGround: P.stock.surface,
  /** The field ground. Failing this bars the tablet, not the tenant. */
  darkGround: P.plate.ground,
  /** The accent as a WORD. */
  textContrast: 4.5,
  /** The accent as a FILL, a rule or a mark — WCAG 1.4.11. The threshold our own copper is admitted at. */
  nonTextContrast: 3.0,
});

/** Every state hue an accent must stand clear of — both stocks, because a tenant portal renders in more than one. */
export const STATE_HUES: readonly { readonly role: string; readonly hex: string }[] = Object.freeze([
  ...STATE_ROLES.map((role) => ({ role, hex: SEMANTIC[role] })),
  { role: "color.status-ok (field)", hex: P.plate.jade },
  { role: "color.status-at-risk (field)", hex: P.plate.amber },
  { role: "color.status-breached (field)", hex: P.plate.oxide },
]);

/**
 * What a tier may paint the accent AS. Two verdicts, because the semantic tier
 * already split them: `color.action` is a fill at 3:1 and `color.action-text`
 * is the word at 4.5:1, and an accent measured only as a word is an accent
 * judged by a threshold it was never going to be used at.
 */
export type SlotAdmission = {
  /** 4.5:1 — the accent as a word, at any size. */
  readonly text: boolean;
  /** 3:1, WCAG 1.4.11 — the accent as a fill, a rule or a mark carrying shape. */
  readonly fill: boolean;
};

export type AccentAdmission = {
  readonly accent: string;
  readonly minSeparation: number;
  readonly nearestState: string;
  readonly onLight: number;
  readonly onDark: number;
  /** False → barred from every surface that renders a state ramp; the accent falls back to Ink Black there. */
  readonly stateSurfaces: boolean;
  /** True when the accent has no hue to confuse with the ramp — `stateSurfaces` is then unconditional. */
  readonly achromatic: boolean;
  /** What each density tier may paint this accent as. */
  readonly tiers: Readonly<Record<"console" | "comfort" | "field", SlotAdmission>>;
  readonly notes: readonly string[];
};

/**
 * Two independent verdicts, two independent permissions — and it never rejects
 * the tenant, only the slot.
 *
 * An accent that fails hue separation is admitted for logo, masthead and
 * marketing surfaces and barred from every surface that renders a state ramp.
 * An accent that passes hue but fails the dark ground is admitted for the
 * comfort and console tiers and barred from the field tablet.
 *
 * Amped keeps their red on their portal masthead. The dispatch board inside it
 * stays in Rankine's ramp, because the board is an instrument the technician
 * has to read the same way in every tenant, and a tenant does not get to re-key
 * an instrument. That is the compliance gate's argument applied to colour:
 * enforced at the table, not by policy.
 */
export const admitAccent = (accent: string): AccentAdmission => {
  const achromatic = isAchromatic(accent);
  let nearest = 360, nearestState = "";
  for (const s of STATE_HUES) {
    const sep = hueSeparation(accent, s.hex);
    if (sep < nearest) { nearest = sep; nearestState = s.role; }
  }
  // A colour with no hue cannot be mistaken for a hue-coded state. 180° is the
  // maximum separation there is, and it is the honest answer, not a pass granted.
  const minSeparation = achromatic ? 180 : nearest;
  if (achromatic) nearestState = "— (achromatic)";

  const onLight = contrastRatio(accent, ACCENT_GATE.lightGround);
  const onDark = contrastRatio(accent, ACCENT_GATE.darkGround);
  const slot = (ratio: number): SlotAdmission =>
    Object.freeze({ text: ratio >= ACCENT_GATE.textContrast, fill: ratio >= ACCENT_GATE.nonTextContrast });
  const light = slot(onLight), dark = slot(onDark);
  const stateSurfaces = achromatic || minSeparation >= ACCENT_GATE.minHueSeparation;

  const notes: string[] = [];
  if (achromatic)
    notes.push(`chroma ${chromaOf(accent).toFixed(3)} — no hue to confuse with the state ramp, so the hue gate does not apply.`);
  if (!stateSurfaces)
    notes.push(`${minSeparation.toFixed(1)}° from ${nearestState}, needs ${ACCENT_GATE.minHueSeparation}° — admitted for logo, masthead and marketing only; falls back to Ink Black wherever a state ramp renders.`);
  if (!light.text && light.fill)
    notes.push(`${onLight.toFixed(2)}:1 on the light ground — a fill, a rule or a mark in the console and comfort tiers, never a word. Our own copper sits here.`);
  if (!light.fill)
    notes.push(`${onLight.toFixed(2)}:1 on the light ground, needs ${ACCENT_GATE.nonTextContrast} — it cannot carry shape there either; the light tiers fall back to Ink Black.`);
  if (!dark.text && dark.fill)
    notes.push(`${onDark.toFixed(2)}:1 on the field ground — a fill only on the tablet, never a word.`);
  if (!dark.fill)
    notes.push(`${onDark.toFixed(2)}:1 on the field ground, needs ${ACCENT_GATE.nonTextContrast} — barred from the tablet, which is a permission and not a rejection.`);

  return Object.freeze({
    accent, minSeparation, nearestState, onLight, onDark, stateSurfaces, achromatic,
    tiers: Object.freeze({ console: light, comfort: light, field: dark }),
    notes,
  });
};

/**
 * Validation runs BEFORE storage, not at render, and not in a designer's head.
 *
 * The theme that satisfies a brand team and the theme that breaks the portal
 * are separated by exactly this check. Rejections carry the number, because
 * "insufficient contrast" starts an argument and "3.17:1, needs 4.5:1" ends one.
 *
 * Note what is NOT a rejection: an accent that fails the hue gate, or the dark
 * ground. Those narrow where the accent may be painted (`admitAccent`), and a
 * tenant whose brand colour is simply their brand colour is not turned away.
 *
 * Every pair below is measured on the LIGHT STOCK, and the rejection says so,
 * because that is the only stock a tenant theme is permitted to reach:
 * `brandCss` emits it under `TENANT_SCOPE`, which the field frame is outside.
 */
export const validateBrandTheme = (
  overrides: Readonly<Record<string, string>>,
): readonly ThemeRejection[] => {
  const rejections: ThemeRejection[] = [];
  const allowed = new Set<string>(BRAND_OVERRIDABLE);

  for (const token of Object.keys(overrides)) {
    if (!allowed.has(token)) {
      rejections.push({
        token,
        reason:
          `not overridable. The accent slots are; the state ramp and the structural tokens are not, because a ` +
          `themeable focus ring is an accessibility regression shipped under someone else's logo, and a themeable ` +
          `state ramp is an instrument a tenant re-keyed.`,
      });
    }
  }

  const merged = { ...SEMANTIC, ...overrides } as Record<SemanticToken, string>;
  const pairs: [SemanticToken, SemanticToken, number, string][] = [
    ["color.text", "color.surface", 4.5, "body text on the panel ground"],
    ["color.text", "color.surface-sunken", 4.5, "body text on the header ground"],
    ["color.text-muted", "color.surface", 4.5, "muted text on the panel ground"],
    ["color.text-muted", "color.surface-sunken", 4.5, "muted text on the header ground"],
    ["color.action-text", "color.surface", 4.5, "an accent word under 24px"],
    // The FILL is not measured against the ground: it carries salience, its rule
    // carries shape and its ink carries the word. A tenant re-pointing the fill
    // must therefore also supply an ink that clears it — the next pair — which
    // is why overriding `color.action` on its own is rejected.
    ["color.action-ink", "color.action", 4.5, "the word on the action fill"],
    ["color.brand-text", "color.surface", 4.5, "a brand word under 24px"],
    ["color.brand-ink", "color.brand", 4.5, "the word on the brand fill"],
    ["color.status-breached", "color.surface", 3.0, "breach indicator against the panel ground"],
  ];
  for (const [fg, bg, min, label] of pairs) {
    if (merged[bg] === "transparent") continue;
    const ratio = contrastRatio(merged[fg]!, merged[bg]!);
    if (ratio < min) {
      rejections.push({
        token: fg,
        reason: `${label} is ${ratio.toFixed(2)}:1 on the light stock, needs ${min.toFixed(1)}:1 (WCAG AA).`,
      });
    }
  }
  return rejections;
};

/**
 * Status is NEVER carried by colour alone. A dispatch board is read fast, in
 * peripheral vision, sometimes by someone colour-blind, and a breach that reads
 * as a different shade of grey is a breach nobody escalated.
 *
 * The glyph is `MARK_GLYPHS`, not a literal, so the subset that has to carry it
 * is checkable — the four characters this channel is drawn with were not in
 * SUBSET_GLYPHS, which left the fallback chain deciding what the channel that
 * exists for the case where colour fails would look like.
 *
 * `form` is the second channel, and the load-bearing one on the field ground:
 * greyscale the screen and the order still reads outline-mute, outline-bright,
 * solid. Hue only confirms what form already said.
 */
/**
 * THE HOUSE RED SITS BEHIND THIS SAME GATE. It measures 1.2° from the fault ink
 * and fails outright, so it is admitted for the wordmark, the livery, the badge
 * and marketing, and barred from every surface that renders a state ramp — see
 * `neutralBrand` in ./css.ts, which is where the fallback actually happens.
 *
 * That is the point of running the gate on ourselves: Amped gives up #E01B24 on
 * the dispatch board, and the argument only holds because we gave up ours.
 */
export const HOUSE_BRAND_IS_GATED = true;

export const STATUS_GLYPH = Object.freeze({
  ok: { glyph: M.ok, word: "On track", form: "outline-mute" },
  at_risk: { glyph: M.atRisk, word: "At risk", form: "outline" },
  breached: { glyph: M.fault, word: "Breached", form: "solid" },
  blocked: { glyph: M.blocked, word: "Blocked", form: "outline-mute" },
});
