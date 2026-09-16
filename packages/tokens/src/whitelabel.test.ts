import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBrandTheme, contrastRatio, hueOf, hueSeparation, admitAccent, chromaOf, isAchromatic, ACHROMATIC_MAX_CHROMA, ACCENT_GATE, STATUS_GLYPH } from "./whitelabel.ts";
import { SEMANTIC } from "./semantic.ts";
import { PRIMITIVES as P } from "./primitives.ts";

test("a brand theme that would break the portal is rejected with the number", () => {
  const r = validateBrandTheme({ "color.text": "#c8c8c8" });
  // Both grounds are stated, because Rev. A published one and shipped the other.
  assert.ok(r.length >= 1);
  for (const x of r) assert.match(x.reason, /needs 4\.5:1/);
  assert.ok(r.some((x) => /header ground/.test(x.reason)), "the darkest ground governs and must be named");
});

test("structural tokens are not themeable, whatever the brand team wants", () => {
  assert.match(validateBrandTheme({ "color.focus-ring": "#ff00ff" })[0]!.reason, /not overridable/);
  assert.match(validateBrandTheme({ "color.status-ok": "#00ff00" })[0]!.reason, /state ramp/);
});

test("a legitimate brand palette passes", () => {
  assert.deepEqual(validateBrandTheme({ "color.action": "#1b56cc", "color.text": "#101010" }), []);
});

test("the accent gate reproduces Plate 5 — Amped's red is barred, their navy is admitted to the light tiers", () => {
  const red = admitAccent("#E01B24");
  assert.ok(Math.abs(red.minSeparation - 8.8) < 0.2, `hue separation ${red.minSeparation.toFixed(1)}°`);
  assert.equal(red.stateSurfaces, false, "inside the state ramp's hue range");
  assert.ok(Math.abs(red.onLight - 4.09) < 0.02);
  assert.ok(Math.abs(red.onDark - 3.66) < 0.02);

  const navy = admitAccent("#1A4FA0");
  assert.ok(navy.minSeparation >= ACCENT_GATE.minHueSeparation);
  assert.equal(navy.stateSurfaces, true);
  assert.deepEqual(navy.tiers, {
    console: { text: true, fill: true },
    comfort: { text: true, fill: true },
    // 2.24:1 on the plate — it cannot carry a word OR a shape there, so the
    // tablet is barred outright. A dark navy on a dark ground is not a near miss.
    field: { text: false, fill: false },
  });
  assert.ok(navy.notes.some((n) => /barred from the tablet/.test(n)));

  // Amped's red, on the other hand, is a FILL everywhere and a word nowhere —
  // which is exactly the sentence Plate 5 writes about it, and the one the
  // single text threshold could not say.
  assert.deepEqual(red.tiers.field, { text: false, fill: true });
  assert.ok(red.notes.some((n) => /logo, masthead and marketing only/.test(n)));
});

test("the gate asks what the accent will be PAINTED as \u2014 which is why our own copper passes it", () => {
  // It did not. Every tier was gated on 4.5:1, the word threshold, so the house
  // accent scored {console:false, comfort:false, field:false} against a system
  // whose semantic tier spends three roles separating the fill from the word.
  // A gate that rejects the fill it was drawn from is measuring the wrong thing.
  const copper = admitAccent("#A65F2E");
  for (const tier of ["console", "comfort", "field"] as const) {
    assert.equal(copper.tiers[tier].fill, true, `copper is a fill in ${tier} \u2014 4.15:1 light, 3.61:1 plate, both over 3`);
    assert.equal(copper.tiers[tier].text, false, `copper is never a word in ${tier} \u2014 that is what color.action-text is for`);
  }
  assert.ok(copper.notes.some((n) => /never a word/.test(n)));
});

test("a colour with no hue cannot collide with a hue ramp", () => {
  // hueOf returns 0\u00b0 \u2014 pure red \u2014 for any grey, because that is what the HSL
  // formula does when the channels are equal. A tenant whose accent is charcoal
  // was scored 6.1\u00b0 from oxblood and barred from every state surface.
  assert.equal(hueOf("#2E2E2E"), 0);
  for (const grey of ["#000000", "#2E2E2E", "#FFFFFF", "#808080"]) {
    const a = admitAccent(grey);
    assert.equal(isAchromatic(grey), true, grey);
    assert.equal(a.achromatic, true, grey);
    assert.equal(a.stateSurfaces, true, `${grey} has no hue to confuse with the ramp`);
    assert.ok(a.notes.some((n) => /no hue to confuse/.test(n)));
  }
  // The threshold keeps the warm near-neutrals chromatic: these DO read as a
  // colour beside a state chip, and one of them is our own muted ink.
  assert.ok(chromaOf("#4E463A") > ACHROMATIC_MAX_CHROMA, "ink.mid is a colour");
  assert.equal(isAchromatic("#708090"), false, "slate reads blue");
  assert.equal(admitAccent("#E01B24").achromatic, false);
});

test("the gate rejects the slot, never the tenant", () => {
  // A failure is a narrower permission and a note that says so — not an error.
  for (const accent of ["#E01B24", "#1A4FA0", "#00FF00", "#7A2B22"]) {
    const a = admitAccent(accent);
    assert.equal(typeof a.stateSurfaces, "boolean");
    assert.ok(a.nearestState.length > 0);
  }
});

test("the house accent is 16° from ochre and is admitted anyway — because it never enters a state column", () => {
  // Plate 3, Rule Two. The bulletin states this openly; the invariant that makes
  // it safe is enforced in packages/ui/src/styles.test.ts, not here.
  const sep = hueSeparation(SEMANTIC["color.action"], SEMANTIC["color.status-at-risk"]);
  assert.ok(sep < ACCENT_GATE.minHueSeparation, `copper/ochre separation is ${sep.toFixed(1)}°`);
  assert.ok(Math.abs(hueOf(P.copper.fill) - 24.5) < 0.5);
});

test("every status carries a glyph, a word and a form — colour is the third channel, not the first", () => {
  for (const s of Object.values(STATUS_GLYPH)) {
    assert.ok(s.glyph.length > 0);
    assert.ok(s.word.length > 0);
    assert.ok(s.form.length > 0);
  }
  // Greyscale the screen and the order still reads: outline-mute, outline, solid.
  assert.equal(STATUS_GLYPH.breached.form, "solid");
  assert.equal(STATUS_GLYPH.ok.form, "outline-mute");
});

test("contrast maths is right at the extremes", () => {
  assert.equal(Math.round(contrastRatio("#ffffff", "#000000")), 21);
});
