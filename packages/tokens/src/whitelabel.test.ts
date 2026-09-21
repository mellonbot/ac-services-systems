import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBrandTheme, contrastRatio, hueOf, hueSeparation, admitAccent, chromaOf, isAchromatic, ACHROMATIC_MAX_CHROMA, ACCENT_GATE, STATUS_GLYPH, HOUSE_BRAND_IS_GATED } from "./whitelabel.ts";
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

test("a legitimate brand palette passes — but re-pointing a fill obliges an ink to go with it", () => {
  assert.deepEqual(validateBrandTheme({
    "color.action": "#1b56cc", "color.action-ink": "#FFFFFF", "color.text": "#101010",
  }), []);
  // The house ink is graphite, which does not clear a dark blue fill. Supplying
  // half a control is the erosion this catches.
  assert.match(validateBrandTheme({ "color.action": "#1b56cc" })[0]!.reason, /the word on the action fill/);
});

test("the accent gate still bars Amped's red and still admits their navy to the light tiers", () => {
  // Measured against Arc Foundry's ramp rather than Bulletin 1's. The verdicts
  // are unchanged; the numbers moved because the ramp did.
  const red = admitAccent("#E01B24");
  assert.ok(red.minSeparation < 1, `0.26° from the field fault fill, not ${red.minSeparation.toFixed(2)}°`);
  assert.equal(red.stateSurfaces, false, "inside the state ramp's hue range");

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

test("the gate asks what the accent will be PAINTED as \u2014 which is why our own red is still a fill", () => {
  // E-15. Every tier was once gated on 4.5:1, the word threshold, so an accent
  // scored the same whether it was about to be set as type or poured as an
  // area \u2014 against a system whose semantic tier spends three roles separating
  // the fill from the word. A gate that rejects the fill it was drawn from is
  // measuring the wrong thing.
  //
  // The fixture is the live brand ink rather than a pinned hex: Bulletin 1's
  // copper is retired, and on the field ground the house red is exactly the
  // split this test exists for \u2014 an area, never a word.
  const red = admitAccent(SEMANTIC["color.brand"]);
  assert.equal(red.tiers.field.fill, true, "the house red is still an area on the plate");
  assert.equal(red.tiers.field.text, false, "the house red is never a word on the plate \u2014 that is what color.brand-text is for");
  // The two verdicts are genuinely independent, not one threshold read twice.
  assert.notEqual(red.tiers.field.fill, red.tiers.field.text);
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
  // The last one is the fault ink itself — the worst case the gate exists for.
  for (const accent of ["#E01B24", "#1A4FA0", "#00FF00", SEMANTIC["color.status-breached"]]) {
    const a = admitAccent(accent);
    assert.equal(typeof a.stateSurfaces, "boolean");
    assert.ok(a.nearestState.length > 0);
  }
});

test("THE HOUSE INSTRUMENT ACCENT PASSES THE GATE IT ENFORCES — copper needed an exemption, arc does not", () => {
  const arc = admitAccent(SEMANTIC["color.action"]);
  assert.ok(arc.minSeparation >= ACCENT_GATE.minHueSeparation,
    `arc is ${arc.minSeparation.toFixed(1)}° from ${arc.nearestState}, and must clear ${ACCENT_GATE.minHueSeparation}°`);
  assert.equal(arc.stateSurfaces, true, "the arc is admitted to the surfaces that render state");
  assert.ok(Math.abs(hueOf(P.arc.fill) - 195) < 1);
  // Bulletin 1's copper sat 16.3° from its warning ink and was exempted by a
  // hand-written rule. A standard the house exempts itself from is a double
  // standard, and Amped is being asked to give up their red on the same test.
  assert.ok(hueSeparation(P.arc.fill, SEMANTIC["color.status-at-risk"]) > 30);
});

test("THE HOUSE BRAND RED FAILS THAT GATE, and is fenced instead of exempted", () => {
  const red = admitAccent(SEMANTIC["color.brand"]);
  assert.equal(red.stateSurfaces, false, "0.55° from the fault ink — it cannot go where state renders");
  assert.ok(red.notes.some((n) => /marketing/.test(n)));
  // What it is fenced BY is the surface flag, resolved in css.ts. No memo.
  assert.equal(HOUSE_BRAND_IS_GATED, true);
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
