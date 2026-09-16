import { test } from "node:test";
import assert from "node:assert/strict";
import { isBranchDerived, isTruncated, needsTitle, titleFrom, bodyFrom, stripTruncatedTail, retitle } from "./pr-title.ts";

const c = (subject: string, body = "", parents = 1) => ({ subject, body, parents });

test("the case this exists for: GitHub named a rebrand after its branch", () => {
  // PR #6, verbatim. A full identity change sat unmerged behind this title
  // while main moved past it and the branch went red.
  const title = "Claude/site design branding rksmnj";
  const branch = "claude/site-design-branding-rksmnj";
  assert.equal(isBranchDerived(title, branch), true);
  const patch = retitle({ title, body: "", branch }, [
    c("Brand: Arc Foundry — cold palette, two accent layers, script wordmark", "The reference is the electric arc furnace."),
    c("Tokens: point the gate's worst-case fixture at the live fault ink"),
    c("README: name the platform Rankine, and document the brand as a mechanism"),
  ]);
  assert.equal(patch.title, "Brand: Arc Foundry — cold palette, two accent layers, script wordmark");
  assert.match(patch.body ?? "", /electric arc furnace/);
  // The stack is visible without opening the commits tab.
  assert.match(patch.body ?? "", /Also in this branch/);
  assert.match(patch.body ?? "", /point the gate's worst-case fixture/);
});

test("a subject GitHub cut at 72 chars is restored, and its tail unstranded from the body", () => {
  // PR #7, verbatim: the overflow was sitting as the body's first line.
  const full = "Brand: Bulletin No. 1 errata E-09..E-16 — the schedule was right, the cascade was not";
  const title = "Brand: Bulletin No. 1 errata E-09..E-16 — the schedule was right, the…";
  assert.equal(isTruncated(title), true);
  const patch = retitle(
    { title, body: "… cascade was not\r\n\r\nEvery ink ratio in Rev. B holds; I re-measured them.", branch: "claude/amazing-wozniak-qj4koq" },
    [c(full, "Every ink ratio in Rev. B holds; I re-measured them.")],
  );
  assert.equal(patch.title, full);
  assert.ok(!(patch.body ?? "").startsWith("…"), "the stranded tail is gone");
  assert.match(patch.body ?? "", /^Every ink ratio/);
});

test("THE ONE IT MUST NOT TOUCH — a demo whose innocuous commit subject IS the payload", () => {
  // PRs #1 and #2 are deliberate: the title says what is being demonstrated and
  // the commit says "Add crew notes", because the point is that an erosion
  // arrives looking like housekeeping. Retitling these from their commits would
  // destroy the demo AND restate a misleading subject as fact.
  for (const [title, branch, subject] of [
    ["DEMO: the erosion only the database can see", "demo/erosion-only-the-database-sees", "Add crew notes"],
    ["DEMO: two erosions, caught in six seconds", "demo/erosion-caught-in-seconds", "Tidy up two bits of duplication"],
  ] as const) {
    assert.equal(needsTitle(title, branch), false, `${title} must be left alone`);
    assert.deepEqual(retitle({ title, body: "", branch }, [c(subject)]), {}, "no patch at all");
  }
});

test("a title a person typed is never rewritten, however close to its branch it reads", () => {
  assert.equal(needsTitle("Brand: implement Identity Standards Bulletin No. 1, Rev. B", "claude/site-design-branding-rksmnj"), false);
  assert.equal(needsTitle("Step 3 item 4: C1 — hierarchy operations, handlers, S2 screens", "step3/c1"), false);
  // Punctuation and case are not what makes a title branch-derived.
  assert.equal(isBranchDerived("Claude/Site-Design Branding rksmnj", "claude/site-design-branding-rksmnj"), true);
  assert.equal(isBranchDerived("Rework the billing paths", "claude/site-design-branding-rksmnj"), false);
});

test("an empty title is named, and a merge commit is never the headline", () => {
  assert.equal(needsTitle("", "any/branch"), true);
  assert.equal(titleFrom([c("Merge origin/main", "", 2), c("Fix the SLA clock")]), "Fix the SLA clock");
  assert.equal(titleFrom([c("Merge origin/main", "", 2)]), null);
  // Nothing to say and nothing said.
  assert.equal(bodyFrom([c("Fix the SLA clock")]), null);
});

test("stripTruncatedTail only strips a fragment that really is the title's tail", () => {
  assert.equal(stripTruncatedTail("… cascade was not\n\nreal body", "the schedule was right, the cascade was not"), "real body");
  // A body that merely opens with an ellipsis is left intact.
  assert.equal(stripTruncatedTail("… and another thing\n\nreal body", "an unrelated title"), "… and another thing\n\nreal body");
});
