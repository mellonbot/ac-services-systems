import { SEMANTIC, BRAND_OVERRIDABLE, type SemanticToken } from "./semantic.ts";

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

export type ThemeRejection = { readonly token: string; readonly reason: string };

/**
 * Validation runs BEFORE storage, not at render, and not in a designer's head.
 *
 * The theme that satisfies a brand team and the theme that breaks the portal
 * are separated by exactly this check. Rejections carry the number, because
 * "insufficient contrast" starts an argument and "3.1:1, needs 4.5:1" ends one.
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
          `not overridable. Seven brand tokens are; structural tokens are not, because a ` +
          `themeable focus ring is an accessibility regression shipped under someone else's logo.`,
      });
    }
  }

  const merged = { ...SEMANTIC, ...overrides } as Record<SemanticToken, string>;
  const pairs: [SemanticToken, SemanticToken, number, string][] = [
    ["color.text", "color.surface", 4.5, "body text on surface"],
    ["color.text-muted", "color.surface", 4.5, "muted text on surface"],
    ["color.action", "color.surface", 3.0, "action against surface"],
    ["color.status-breached", "color.surface", 3.0, "breach indicator against surface"],
  ];
  for (const [fg, bg, min, label] of pairs) {
    const ratio = contrastRatio(merged[fg]!, merged[bg]!);
    if (ratio < min) {
      rejections.push({
        token: fg,
        reason: `${label} is ${ratio.toFixed(2)}:1, needs ${min.toFixed(1)}:1 (WCAG AA).`,
      });
    }
  }
  return rejections;
};

/**
 * Status is NEVER carried by colour alone. A dispatch board is read fast, in
 * peripheral vision, sometimes by someone colour-blind, and a breach that reads
 * as a different shade of grey is a breach nobody escalated.
 */
export const STATUS_GLYPH = Object.freeze({
  ok: { glyph: "●", word: "On track" },
  at_risk: { glyph: "▲", word: "At risk" },
  breached: { glyph: "■", word: "Breached" },
  blocked: { glyph: "✕", word: "Blocked" },
});
