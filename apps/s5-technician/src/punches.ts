import type { ShiftPunchWire } from "../../../packages/contracts/src/index.ts";
import type { QueueEntry } from "./offline.ts";

/**
 * THE SHIFT CLOCK'S ARITHMETIC (0033). Pure, so the timesheet a technician is
 * paid from is tested without a screen. The server keeps punches, never
 * spans: spans are derived here, from the server's punches plus the ones this
 * device has queued, so a clock-in made in a dead zone is already running.
 */
export type Punch = { readonly kind: "in" | "out"; readonly at: string; readonly queued: boolean };
export type Span = { readonly start: string; readonly end: string | null; readonly queued: boolean };

/** The server's punches and this device's queued ones, oldest first. */
export const mergedPunches = (server: readonly ShiftPunchWire[], pending: readonly QueueEntry[]): readonly Punch[] => [
  ...server.map((p) => ({ kind: p.kind, at: p.at, queued: false })),
  ...pending.filter((e) => e.mutation.entityTable === "shift_punches")
    .map((e) => ({ kind: e.mutation.payload.kind as "in" | "out", at: String(e.mutation.payload.at), queued: true })),
].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/**
 * Each in paired with the next out. A second in while one is open, or an out
 * with none open, is a double tap or a second device — it changes nothing
 * here, and the punch itself is still on record for the office.
 */
export const spansOf = (punches: readonly Punch[]): readonly Span[] => {
  const out: Span[] = [];
  let open: Punch | null = null;
  for (const p of punches) {
    if (p.kind === "in" && !open) open = p;
    else if (p.kind === "out" && open) { out.push({ start: open.at, end: p.at, queued: open.queued || p.queued }); open = null; }
  }
  if (open) out.push({ start: open.at, end: null, queued: open.queued });
  return out;
};

export const runningSince = (spans: readonly Span[]): string | null => {
  const last = spans.at(-1);
  return last && last.end === null ? last.start : null;
};

export const spanMs = (s: Span, now: number): number => Math.max(0, (s.end === null ? now : Date.parse(s.end)) - Date.parse(s.start));

/** Monday 00:00 to the next Monday 00:00, in the device's own time zone. */
export const weekOf = (now: number): { readonly from: Date; readonly to: Date } => {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return { from, to: new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7) };
};

export type Day = { readonly date: Date; readonly spans: readonly Span[]; readonly ms: number };
/** The week's seven days, each with the spans that STARTED on it — a shift past midnight is the day it began. */
export const daysOf = (spans: readonly Span[], week: { readonly from: Date }, now: number): readonly Day[] =>
  Array.from({ length: 7 }, (_, i) => {
    const date = new Date(week.from.getFullYear(), week.from.getMonth(), week.from.getDate() + i);
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const mine = spans.filter((s) => { const t = Date.parse(s.start); return t >= date.getTime() && t < next.getTime(); });
    return { date, spans: mine, ms: mine.reduce((n, s) => n + spanMs(s, now), 0) };
  });

/** "8h 34m". Minutes are floored: a timesheet never shows time not yet worked. */
export const hoursText = (ms: number): string => {
  const m = Math.floor(ms / 60_000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

const DONE_FOR_NOW = ["complete", "aborted", "cancelled", "awaiting_parts", "awaiting_customer"];
/**
 * Which punch the shift clock offers, from whether it is running and where
 * this shift's jobs stand (their states with the device's queued moves
 * applied). Partner rules, 2026-10-27: no job moves until the clock is in
 * (the screens gate every move on it), and clocking out is offered once
 * every job is finished or on hold — waiting on parts or on the customer
 * lets the crew clock out. Clocking in is offered whenever the clock is
 * stopped: the gate means a job can only get under way with it running, so
 * a stopped clock with work under way is a job moved before this rule or by
 * the office, and hiding Clock in there would leave a crew with no move at all.
 */
export const clockAction = (running: boolean, jobStates: readonly string[]): "in" | "out" | null =>
  !running ? "in" : jobStates.every((s) => DONE_FOR_NOW.includes(s)) ? "out" : null;
