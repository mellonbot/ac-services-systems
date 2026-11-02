---
target: apps/s2-service-manager
total_score: 34
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-10-13T08-44-58Z
slug: apps-s2-service-manager-src-main-ts
---
Method: dual-agent (A: 360e5b60-65fd-4f3c-a2b7-946fa7663ad6 · B: 28544945-b4be-4bec-9f09-139aa58b097c)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 4 | Busy, degraded, refusal, and lifecycle states are explicit; persistent current-object context is less evident. |
| 2 | Match System / Real World | 4 | Vocabulary and decision structure are strongly grounded in service operations. |
| 3 | User Control and Freedom | 3 | Back, dismiss, and recovery paths exist; confirmation/undo around consequential transitions is not evident. |
| 4 | Consistency and Standards | 4 | Shared components, state semantics, tokens, and routing conventions are coherent. |
| 5 | Error Prevention | 4 | Invalid transitions, unanswered OQ5, and degraded-mode writes are blocked. |
| 6 | Recognition Rather Than Recall | 3 | Labels and rationale help, but parent/customer/object context is not consistently persistent. |
| 7 | Flexibility and Efficiency | 3 | Dense console patterns support operators; shortcuts, saved views, and bulk actions are not evident. |
| 8 | Aesthetic and Minimalist Design | 2 | Policy-heavy forms, flat cross-domain navigation, and dense traces compete with primary tasks. |
| 9 | Error Recovery | 4 | Refusals identify structural/commercial reasons and provide next actions. |
| 10 | Help and Documentation | 3 | Inline policy guidance is useful, but contextual help/glossary and progressive disclosure are limited. |
| **Total** | | **34/40** | **Good** |

## Design Specificity Verdict

**LLM assessment:** Strongly product-specific and domain-coherent. Hierarchy, agreement scope, OQ5 data-rights decisions, contract ladders, degraded read-only mode, and procurement states are not generic dashboard decoration. Arc Foundry alignment is strong in source: console density, semantic roles, and state encoded through more than hue. The main weakness is surface-level information architecture: Accounts, Agreements, Network, and Purchasing are presented as flat peers, while route/object context can be easy to lose.

**Deterministic scan:** One warning, `flat-type-hierarchy`, at `apps/s2-service-manager/frame.html:12`. Detector evidence: 12px, 14px, 18px, and 20px sizes with a 1.7:1 overall ratio; it recommends fewer sizes with greater contrast. No other CLI findings. The browser detector script injected and ran on the initial sign-in view; it produced no visible highlights there. The CLI typography warning remains the only deterministic finding.

**Visual inspection boundary:** The built surface rendered the sign-in screen, but the local gateway was unavailable (`Gateway unreachable` / `Load failed`). That environment failure is not counted as a product defect. Authenticated workflows, live data states, and pixel-level behavior beyond this initial view were reviewed from source rather than a live session.

## Overall Impression

A disciplined, safety-minded service console with unusually specific operational semantics. The next improvement is not more visual decoration: make location and object context persistent, and make consequential mutations unmistakably different from navigation.

## What's Working

1. **Decision safety:** OQ5 blocks submission until answered; contract transitions are limited to admissible next states; degraded mode prevents writes.
2. **State clarity:** Contract, filing, operational, and procurement states remain distinct and use form as well as hue.
3. **Actionable errors:** Refusal cards explain the reason and offer recovery routes instead of leaving users at a dead end.

## Priority Issues

### [P1] Cross-domain navigation loses workflow and object context
**Why it matters:** Operators can switch among customer, firm, agreement, and order work without a persistent frame that makes the active entity and scope obvious. The flat peer navigation makes related commercial workflows feel disconnected.
**Fix:** Keep the current customer/firm/order, scope tier, and parent trail visible. Group related destinations into a small number of operational domains while preserving direct routes. Relevant code: `src/app.ts:152–158`.
**Suggested command:** `/impeccable layout`

### [P1] Consequential transitions lack evident confirmation and impact framing
**Why it matters:** Expire, Terminate, Cancel, and Return can carry commercial or operational consequences. A one-click transition without a clear resulting-state summary invites costly mistakes.
**Fix:** Before committing a high-impact transition, confirm the entity, current state, next state, and downstream consequence; keep the recovery path explicit. Relevant controls include network and contract transitions.
**Suggested command:** `/impeccable harden`

### [P2] Mutating controls look like navigation
**Why it matters:** Link-styled buttons in dense rows make it harder to tell whether an action navigates or changes a record, reducing both discoverability and confidence.
**Fix:** Reserve link styling for navigation and use a consistent compact button style for mutations, with one clearly primary row action. Relevant styling: `src/styles.ts:35–39`.
**Suggested command:** `/impeccable clarify`

### [P2] Policy explanations compete with form decisions
**Why it matters:** Long rationale in contracts, terms, network onboarding, and purchasing can bury required inputs and the next action.
**Fix:** Put required decisions and completion prerequisites first; move supporting rationale into progressive disclosure without removing policy context.
**Suggested command:** `/impeccable distill`

### [P3] Dense traces and wide grids are hard to scan
**Why it matters:** Fixed multi-column traces and horizontal table scanning can hide exceptions and make users work to locate the outcome.
**Fix:** Put rung/date/outcome first, move rationale to a secondary line, and promote unresolved exceptions above the full trace. Relevant trace styles: `src/styles.ts:69–75`.
**Suggested command:** `/impeccable adapt`

## Persona Red Flags

- **Alex, experienced operator:** No evident shortcuts, saved views, or bulk actions; mutating row actions share link-like styling, slowing safe scanning and batch work.
- **Jordan, first-time contract administrator:** OQ5 is correctly explained and guarded, but the app does not make the accountable decision owner or escalation path obvious when the choice is unknown.
- **Procurement clerk:** Held invoices and quantity discrepancies have lifecycle states, but dense order/invoice rows need a stronger “what next?” priority than status plus note.

## Cognitive Load

**4 checklist failures (moderate-to-high):** flat cross-domain navigation; policy copy competing with form tasks; mutation/navigation affordance ambiguity; and dense fixed-column traces/tables. The inspected choice points are generally bounded: OQ5 has three choices, refusal recovery usually has one to three actions, and contract transition options are state-constrained. The primary problem is hierarchy and contextual reading effort, not excessive choice count.

## Minor Observations

- The detector's type-scale warning is mechanically valid for the listed frame sizes, but the captured sign-in view still has a discernible heading/form hierarchy; verify the type ramp against the console density schedule rather than mechanically increasing every size.
- “No screen at…” is an implementation-oriented fallback without a useful recovery action (`src/app.ts:158`).
- “Screens” and a compact joined-role indicator may not communicate workspace purpose or role clearly to a new user.
- The generated login view showed a helpful “Gateway unreachable” heading but only the generic detail “Load failed”; this was observed while the critique environment's gateway was down.

## Questions to Consider

1. Can a returning operator immediately identify the active customer, scope tier, and object without reading a URL?
2. Should Agreements, Terms, and Network be peer destinations, or stages in one commercial workflow?
3. Which transition is most costly to trigger incorrectly, and does its confirmation reflect that risk?
