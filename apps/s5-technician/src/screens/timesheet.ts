import { html, pageHead, panel, PrimaryAction, type VNode } from "../../../../packages/ui/src/index.ts";
import type { FieldJobWire, MyPunchesOutput } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Resource } from "../state.ts";
import { mergedPunches, spansOf, runningSince, spanMs, weekOf, daysOf, hoursText, clockAction, type Span } from "../punches.ts";
import { whenReady, flushQueue, deviceState, type Screen, type ScreenContext } from "./common.ts";

/**
 * This week's punches — one read the clock panel, the timesheet and the job
 * gate share. It starts a day before Monday, so a shift clocked in on Sunday
 * night is still running on Monday morning; the timesheet's days only count
 * spans that started inside the week.
 */
const weekPunches = (ctx: ScreenContext): Resource<MyPunchesOutput> => {
  const week = weekOf(ctx.now);
  const from = new Date(week.from.getFullYear(), week.from.getMonth(), week.from.getDate() - 1);
  const input = { from: from.toISOString(), to: week.to.toISOString() };
  return ctx.store.read(keyOf("punches.mine", input), () => ctx.shell.gateway.myPunches(input)).value;
};

/**
 * Whether the shift clock is running, with this device's queued punches
 * counted; null while the punches are not in hand. Partner rule, 2026-10-27:
 * a job does not move until the clock is in. Null does not gate — a tablet
 * that cannot reach the gateway still has to be able to work.
 */
export const shiftRunning = (ctx: ScreenContext): boolean | null => {
  const r = weekPunches(ctx);
  return r.state === "ready" ? runningSince(spansOf(mergedPunches(r.value.punches, ctx.queue.pending.value))) !== null : null;
};
export const CLOCK_IN_FIRST = "Clock in first — the shift clock is at the top of Today.";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const isToday = (d: Date, now: number) => d.toDateString() === new Date(now).toDateString();

/**
 * THE SHIFT CLOCK, on Today. A punch is queued like every other tap and
 * counts at once; which punch is offered follows the jobs (`clockAction`),
 * and when neither is, the panel says why rather than leaving a gap.
 */
export const shiftClock = (ctx: ScreenContext, jobs: readonly FieldJobWire[]): VNode =>
  whenReady(ctx, weekPunches(ctx), (out) => {
    const spans = spansOf(mergedPunches(out.punches, ctx.queue.pending.value));
    const since = runningSince(spans);
    const today = spans.filter((s) => isToday(new Date(s.start), ctx.now));
    const action = clockAction(since !== null, jobs.map((j) => deviceState(ctx, j)));
    const punch = (kind: "in" | "out") => {
      // Stamp with the surface clock (injected in tests; Date.now() in production).
      // Wall-clock Date() here would put a queued punch on the wrong day when
      // isToday filters spans, and "waiting to sync" would never show.
      ctx.queue.enqueue("shift_punches", ctx.shell.principal.shiftId!, "insert", { kind, at: new Date(ctx.now).toISOString() }, null);
      flushQueue(ctx);
    };
    const last = today.at(-1);
    const queued = today.some((s) => s.queued);
    return panel(html`<div class="s5-clock" data-running=${since ? "true" : "false"}>
      <p class="s5-clock__label">${since ? "Clocked in" : "Clocked out"}</p>
      <p class="s5-clock__figure ac-num">${hoursText(today.reduce((n, s) => n + spanMs(s, ctx.now), 0))}</p>
      <p class="s5-clock__note">${since
        ? html`Since <span class="ac-num">${time(since)}</span>`
        : last?.end ? html`Out at <span class="ac-num">${time(last.end)}</span>` : "Not clocked in today"}${queued ? " — waiting to sync" : ""}</p>
      ${action === "in" ? PrimaryAction({ density: ctx.density, label: "Clock in", id: "clock-in", onClick: () => punch("in") }) : null}
      ${action === "out" ? PrimaryAction({ density: ctx.density, label: "Clock out", id: "clock-out", onClick: () => punch("out"), kind: "quiet" }) : null}
      ${action === null && since ? html`<p class="s5-muted" id="clock-out-closed">Clock out opens when every job is complete or on hold.</p>` : null}
    </div>`, "Shift clock");
  });

const spanLine = (s: Span): VNode =>
  html`<span class="s5-punch ac-num"><span class="s5-nowrap">${time(s.start)}</span> → <span class="s5-nowrap">${s.end ? time(s.end) : "running"}</span>${s.queued ? html`<span class="s5-muted"> (waiting to sync)</span>` : null}</span>`;

/** TIMESHEET — every clock-in and clock-out this week, and the running total. Nothing to fill in by hand. */
export const timesheet: Screen = (ctx) => {
  const week = weekOf(ctx.now);
  const last = new Date(week.to.getFullYear(), week.to.getMonth(), week.to.getDate() - 1);
  const label = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric" });
  return html`<section class="s5-timesheet">
    ${pageHead("Timesheet", "This week's clock-ins and clock-outs and the running total — nothing to fill in by hand.")}
    ${whenReady(ctx, weekPunches(ctx), (out) => {
      const spans = spansOf(mergedPunches(out.punches, ctx.queue.pending.value));
      const days = daysOf(spans, week, ctx.now);
      return html`
        ${panel(html`<p class="s5-clock__label">${label(week.from)} – ${label(last)}</p>
          <p class="s5-clock__figure ac-num" id="week-total">${hoursText(days.reduce((n, d) => n + d.ms, 0))}</p>
          <p class="s5-clock__note">Hours logged so far</p>`)}
        ${panel(html`<ul class="s5-days">${days.map((d) => html`<li class="s5-day" data-today=${isToday(d.date, ctx.now) ? "true" : "false"} key=${d.date.toISOString()}>
          <span class="s5-day__name">${d.date.toLocaleDateString([], { weekday: "short" })}${isToday(d.date, ctx.now) ? html` <span class="s5-day__today">today</span>` : null}</span>
          <span class="s5-day__spans">${d.spans.length ? d.spans.map(spanLine) : html`<span class="s5-muted">—</span>`}</span>
          <span class="s5-day__total ac-num">${d.spans.length ? hoursText(d.ms) : "—"}</span>
        </li>`)}</ul>`, "Daily punches")}`;
    })}
  </section>`;
};
