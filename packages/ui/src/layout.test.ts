import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "./testing.ts";
import { pageHead, statStrip, panel, notice } from "./layout.ts";
import { UI_CSS } from "./styles.ts";

test("the page head is the name, one sentence, and an optional side slot", () => {
  const out = render(pageHead("Dispatch board", "Every job in your region.", "side"));
  assert.match(out, /<h1 class="ac-page-head__title">Dispatch board<\/h1>/);
  assert.match(out, /ac-page-head__lede">Every job in your region\./);
  assert.match(out, /ac-page-head__side/);
  assert.doesNotMatch(render(pageHead("Only a title")), /lede|__side/);
});

test("a stat tile carries a tone only when given one — a plain count stays ink", () => {
  const out = render(statStrip([{ n: 3, label: "Open jobs" }, { n: 1, label: "At risk", tone: "breached" }], "s"));
  assert.match(out, /<div class="ac-stat"><span class="ac-stat__n">3<\/span>/);
  assert.match(out, /data-tone="breached"/);
});

test("a panel draws its head only when titled", () => {
  const out = render(panel("body", "Crews", "Who can be sent today."));
  assert.match(out, /<section class="ac-panel"><header class="ac-panel__head"><div><h2 class="ac-panel__title">Crews<\/h2><p class="ac-panel__sub">Who can be sent today\.<\/p>/);
  assert.doesNotMatch(render(panel("body")), /ac-panel__head/);
  assert.match(render(panel("body", "Crews", undefined, undefined, "crews")), /<section class="ac-panel" id="crews" aria-labelledby="crews__title">.*<h2 class="ac-panel__title" id="crews__title">Crews/s);
});

test("nothing inside a panel draws a second card", () => {
  assert.match(UI_CSS, /\.ac-panel \.ac-grid\{box-shadow:none/);
  assert.match(UI_CSS, /\.ac-panel \.ac-stat\{padding:0;background:transparent;border:0/);
  assert.match(UI_CSS, /\.ac-panel \.ac-form\{padding:0;background:transparent;border:0/);
});

test("a stat figure is a numeral, so it is set in the instrument face", () => {
  assert.match(UI_CSS, /\.ac-stat__n\{font-family:var\(--font-instrument\)/);
});

test("every class the layout draws has a rule in UI_CSS", () => {
  for (const cls of ["ac-page-head", "ac-page-head__title", "ac-page-head__lede", "ac-page-head__side", "ac-stats", "ac-stat", "ac-stat__n", "ac-stat__l", "ac-stat__s", "ac-panel", "ac-panel__head", "ac-panel__title", "ac-panel__sub"]) assert.match(UI_CSS, new RegExp(`\\.${cls}\\b`), cls);
});

test("a notice is one sentence with a tone — a status line, never a toast", () => {
  assert.equal(render(notice("ok", "Filed — with the office.", "doc-outcome")), `<p class="ac-notice" role="status" data-tone="ok" id="doc-outcome">Filed — with the office.</p>`);
  assert.match(render(notice("at_risk", "Queued.")), /data-tone="at_risk"/);
  for (const cls of ["ac-notice"]) assert.match(UI_CSS, new RegExp(`\\.${cls}(?![\\w-])`), cls);
});
