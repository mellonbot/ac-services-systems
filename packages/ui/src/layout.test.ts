import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "./testing.ts";
import { pageHead, statStrip } from "./layout.ts";
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

test("every class the layout draws has a rule in UI_CSS", () => {
  for (const cls of ["ac-page-head", "ac-page-head__title", "ac-page-head__lede", "ac-page-head__side", "ac-stats", "ac-stat", "ac-stat__n", "ac-stat__l", "ac-stat__s"]) assert.match(UI_CSS, new RegExp(`\\.${cls}\\b`), cls);
});
