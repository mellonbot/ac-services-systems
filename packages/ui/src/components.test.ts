import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";
import { html, admits } from "./render.ts";
import { StatusPill } from "./components/status-pill.ts";
import { PrimaryAction } from "./components/primary-action.ts";
import { DataGrid } from "./components/data-grid.ts";
import { ComplianceBadge } from "./components/compliance-badge.ts";
import { RefusalCard, refusalHeading, AXIS_SENTENCE } from "./components/refusal-card.ts";
import { DegradedBanner, applyDegraded, ageOf } from "./components/degraded-banner.ts";
import { COMPONENT_SPECS, ComplianceBadgeSpec, DataGridSpec } from "./component.ts";
import { STATUS_GLYPH } from "../../tokens/src/index.ts";
import { SURFACES, densityOf } from "../../contracts/src/index.ts";
import type { Refusal } from "../../contracts/src/index.ts";

// ---------------------------------------------------------------------------
// The density contract, at the type level. These lines are checked by
// `pnpm typecheck`, which includes test files: a line marked ts-expect-error
// that stops erroring fails the build. That is the whole point of the
// component set — a console-only control cannot be written into the field app.
// ---------------------------------------------------------------------------
test("a component outside its declared density is a type error at the call, and a throw if tagged anyway", () => {
  // @ts-expect-error — ComplianceBadge has no field variant to import
  const badge = () => ComplianceBadge({ density: "field", cleared: true });
  // @ts-expect-error — no grid on a 7-inch screen in sunlight
  const grid = () => DataGrid({ density: "field", columns: [], rows: [], rowKey: () => "" });
  // @ts-expect-error — RefusalCard is ComplianceBadge's sibling: console only
  const card = () => RefusalCard({ density: "comfort", refusal: { kind: "no_route", message: "" } });
  // The type system said no; the runtime says the same, loudly, for the template that slipped past it.
  assert.throws(badge, /ComplianceBadge has no field variant/);
  assert.throws(grid, /DataGrid has no field variant/);
  assert.throws(card, /RefusalCard has no comfort variant/);
  // A tagged component is typed as `unknown` in the template — the seam the guard cannot see — but renders through the same wrapper.
  assert.throws(() => render(html`<${ComplianceBadge} density="field" cleared=${true} />`), /no field variant/);

  const ok = StatusPill({ density: "field", status: "ok" });
  assert.ok(ok);
  assert.equal(admits(ComplianceBadgeSpec, "field"), false);
  assert.equal(admits(DataGridSpec, SURFACES.S5.density), false);
  assert.equal(admits(DataGridSpec, SURFACES.S2.density), true);
});

test("densityOf is literal, so the registry's density reaches the component type system without a cast", () => {
  // S2 is console: a console-only component accepts it at compile time.
  const badge = ComplianceBadge({ density: densityOf("S2"), cleared: true });
  assert.ok(badge);
  // @ts-expect-error — S5 is field, literally; ComplianceBadge does not admit it
  const wrong = () => ComplianceBadge({ density: densityOf("S5"), cleared: true });
  assert.throws(wrong, /no field variant/);
});

test("every spec has an implementation carrying it, and no density outside the three", () => {
  const carried = [StatusPill, PrimaryAction, DataGrid, ComplianceBadge, RefusalCard, DegradedBanner].map((c) => c.spec.name).sort();
  assert.deepEqual(carried, [...COMPONENT_SPECS].map((s) => s.name).sort());
  for (const s of COMPONENT_SPECS) for (const d of s.densities) assert.ok(["console", "comfort", "field"].includes(d));
});

// ---------------------------------------------------------------------------
// Rendering — to a string, under node --test, no DOM, no build.
// ---------------------------------------------------------------------------
test("StatusPill carries glyph, word and the status role — never colour alone", () => {
  for (const status of Object.keys(STATUS_GLYPH) as (keyof typeof STATUS_GLYPH)[]) {
    const out = render(html`<${StatusPill} density="console" status=${status} />`);
    assert.ok(out.includes(STATUS_GLYPH[status].glyph), `${status} glyph`);
    assert.ok(out.includes(STATUS_GLYPH[status].word), `${status} word`);
    assert.ok(out.includes(`data-status="${status}"`), `${status} role`);
    assert.doesNotMatch(out, /#[0-9a-f]{3,8}\b|rgb\(/i, "no colour literal reaches the markup");
  }
  assert.match(render(html`<${StatusPill} density="field" status="at_risk" label="Window closing" />`), /Window closing/);
});

test("PrimaryAction disabled WITH a reason keeps focusability and shows the reason where the control is", () => {
  const out = render(html`<${PrimaryAction} density="field" label="Save" disabledReason="Gateway unreachable — read-only from last server state." />`);
  assert.match(out, /aria-disabled="true"/);
  assert.doesNotMatch(out, /\sdisabled(=|>|\s)/, "not natively disabled: a keyboard user must still reach the reason");
  assert.match(out, /Gateway unreachable/);
  assert.match(out, /data-density="field"/);
  const live = render(html`<${PrimaryAction} density="console" label="Save" type="submit" />`);
  assert.match(live, /aria-disabled="false"/);
  assert.match(live, /type="submit"/);
  assert.doesNotMatch(live, /ac-action__reason/);
});

test("DataGrid renders a real table with the caller's row order, empty state, and aria-sort", () => {
  type Row = { id: string; name: string; tier: string };
  const rows: Row[] = [{ id: "a", name: "Amped", tier: "parent" }, { id: "b", name: "Boulder", tier: "location" }];
  const columns = [{ key: "name", header: "Name", sortable: true }, { key: "tier", header: "Tier", align: "end" as const }];
  const out = render(html`<${DataGrid} density="console" columns=${columns} rows=${rows} rowKey=${(r: Row) => r.id} sort=${{ key: "name", dir: "desc" }} onSort=${() => {}} caption="Accounts" />`);
  assert.match(out, /<table class="ac-grid" data-density="console">/);
  assert.match(out, /<caption class="ac-grid__caption">Accounts<\/caption>/);
  assert.match(out, /aria-sort="descending"/);
  assert.ok(out.indexOf("Amped") < out.indexOf("Boulder"), "order is the caller's");
  assert.match(out, /data-align="end">location/);
  const empty = render(html`<${DataGrid} density="comfort" columns=${columns} rows=${[]} rowKey=${(r: Row) => r.id} emptyText="No accounts yet." />`);
  assert.match(empty, /colspan="2">No accounts yet\./);
});

test("ComplianceBadge reports the gate's decision and reason, console only", () => {
  assert.match(render(html`<${ComplianceBadge} density="console" cleared=${true} />`), /●.*Cleared/s);
  assert.match(render(html`<${ComplianceBadge} density="console" cleared=${false} reason="expired_in_window" />`), /✕.*Not cleared — expired in window/s);
});

test("RefusalCard: axis heading, the gateway's message verbatim, the register's authoring tiers, the axis sentence, the routes", () => {
  const structural: Refusal = { kind: "admission", code: "illegal_tier", axis: "structural", message: "payment_terms_days may not be set at location." };
  let routed = 0;
  const out = render(html`<${RefusalCard} density="console" refusal=${structural} termKey="payment_terms_days" tierAttempted="location"
    routes=${[{ label: "Set it at the parent instead", onSelect: () => { routed++; }, primary: true }]} />`);
  assert.match(out, /Refused — structural/);
  assert.match(out, /<p class="ac-refusal__message">payment_terms_days may not be set at location\.<\/p>/, "verbatim, in its own element");
  assert.match(out, /<dt>Authoring tiers<\/dt><dd>parent<\/dd>/, "from the register, not typed into the card");
  assert.match(out, /<dt>Attempted at<\/dt><dd>location<\/dd>/);
  assert.match(out, new RegExp(AXIS_SENTENCE.structural.replace(".", "\\.")));
  assert.match(out, /data-kind="primary"[^>]*>Set it at the parent instead/);
  assert.equal(routed, 0, "rendering routes does not take them");

  const commercial: Refusal = { kind: "admission", code: "ratchet_loosened", axis: "commercial", message: "sla_response = 48_hour at location is LOOSER than 4_hour inherited from parent." };
  const c = render(html`<${RefusalCard} density="console" refusal=${commercial} termKey="sla_response" tierAttempted="location" />`);
  assert.match(c, /Refused — commercial/);
  assert.match(c, /Someone has to agree to this and price it\./);
  assert.match(c, /data-axis="commercial"/);
});

test("RefusalCard renders every refusal kind with a heading — none falls through to a generic error", () => {
  const all: Refusal[] = [
    { kind: "token", code: "expired", message: "expired" },
    { kind: "scope", error: "SurfaceWriteDenied", message: "S3 may not write contract" },
    { kind: "phase_disabled", message: "S4 is Phase 2" },
    { kind: "no_route", message: "no route" },
    { kind: "bad_request", message: "termValue must be a string of minor units" },
    { kind: "transport", status: null, message: "no answer" },
  ];
  for (const r of all) {
    const out = render(html`<${RefusalCard} density="console" refusal=${r} />`);
    assert.match(out, new RegExp(refusalHeading(r).replace(/[—()]/g, (m) => `\\${m}`)), r.kind);
    assert.doesNotMatch(out, /data-axis=/, `${r.kind} has no axis`);
  }
  assert.match(render(html`<${RefusalCard} density="console" refusal=${all[1]!} />`), /<code>SurfaceWriteDenied<\/code>/);
});

test("DegradedBanner is nothing when the flag is down, and the declared text plus the age when up", () => {
  const text = SURFACES.S2.degraded;
  assert.equal(render(html`<${DegradedBanner} density="console" degraded=${false} text=${text} lastOkAt=${0} now=${1000} />`), "");
  const up = render(html`<${DegradedBanner} density="console" degraded=${true} text=${text} lastOkAt=${1_000_000} now=${1_000_000 + 4 * 60_000} />`);
  assert.match(up, /role="alert"/);
  assert.ok(up.includes(text), "the registry's declaration, not a paraphrase");
  assert.match(up, /Last good response 4 min ago\./);
  const never = render(html`<${DegradedBanner} density="field" degraded=${true} text=${SURFACES.S5.degraded} lastOkAt=${null} now=${1} />`);
  assert.match(never, /No response from the gateway yet this session\./);
});

test("the frame's <ac-degraded> slot is driven by the same facts", () => {
  const slot = { hidden: true, textContent: "" as string | null };
  applyDegraded(slot, { degraded: true, text: "Read-only.", lastOkAt: 0, now: 90_000 });
  assert.equal(slot.hidden, false);
  assert.equal(slot.textContent, "Gateway unreachable. Read-only. Last good response 1 min ago.");
  applyDegraded(slot, { degraded: false, text: "Read-only.", lastOkAt: 0, now: 90_000 });
  assert.equal(slot.hidden, true);
});

test("age is coarse on purpose", () => {
  assert.equal(ageOf(12_000), "12 s");
  assert.equal(ageOf(4 * 60_000), "4 min");
  assert.equal(ageOf(2 * 3_600_000), "2 h");
  assert.equal(ageOf(3 * 86_400_000), "3 d");
  assert.equal(ageOf(-5), "0 s");
});
