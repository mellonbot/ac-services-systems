import { html, statStrip, pageHead, PrimaryAction, StatusPill, type Status, type VNode } from "../../../../packages/ui/src/index.ts";
import { serviceLabel } from "../../../../packages/contracts/src/index.ts";
import type { FieldJobWire, JobPriority } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { nextDeviceStates, projectedJob } from "../offline.ts";
import { whenReady, linkTo, flushQueue, ACTION_LABEL, stateText, addressLine, directionsHref, telHref, windowText, type Screen, type ScreenContext } from "./common.ts";

/**
 * A priority glyph, not a job-state one. `StatusPill`'s three-state ramp is a
 * health signal (on track / at risk / breached), and a job's workflow state
 * ("en_route", "awaiting_parts", …) is not health — it is just where the job
 * is, the same distinction S3's board draws between a job's state column and
 * its SLA pill. What IS urgency on this list is the priority a dispatcher
 * set, so that is what earns the ramp; the raw state is shown as plain text
 * beside it.
 */
export const priorityStatus = (priority: JobPriority): Status => {
  switch (priority) {
    case "emergency": return "breached";
    case "urgent": return "at_risk";
    case "routine": case "pm": return "ok";
  }
};

/**
 * The one move a card offers: the job's next step forward. Completing or
 * aborting is not a tap from a list — the job detail is where the work is
 * wrapped up — so a job in progress offers no button here, only its title.
 */
const FORWARD: Readonly<Record<string, string>> = {
  assigned: "en_route", en_route: "on_site", on_site: "in_progress",
  awaiting_parts: "in_progress", awaiting_customer: "in_progress", reopened: "in_progress",
};
export const forwardState = (state: string): string | null => {
  const to = FORWARD[state];
  return to && nextDeviceStates(state).includes(to) ? to : null;
};

const UNDER_WAY = ["en_route", "on_site", "in_progress", "awaiting_parts", "awaiting_customer"];

const card = (ctx: ScreenContext, j: FieldJobWire, current: boolean): VNode => {
  const projected = projectedJob(j, ctx.queue.pending.value);
  const to = forwardState(projected.state);
  const where = addressLine(j.site?.address ?? null);
  const directions = directionsHref(j.site);
  const contact = j.site?.contact ?? null;
  const title = `${j.site?.name ?? "Site not on record"} — ${serviceLabel(j.serviceCode)}`;
  const move = () => { ctx.queue.enqueue("jobs", j.id, "transition", { state: to! }, projected.version); flushQueue(ctx); };
  return html`<li class="ac-panel s5-card" data-current=${current ? "true" : "false"} key=${j.id}>
    <p class="s5-card__when"><span class="ac-num s5-nowrap">${windowText(j.serviceWindowStart, j.serviceWindowEnd, Date.now())}</span>
      ${StatusPill({ density: ctx.density, status: priorityStatus(j.priority), label: j.priority })}</p>
    <h2 class="s5-card__title">${linkTo(ctx, "job", { jobId: j.id }, title, "s5-card__link")}</h2>
    ${where ? html`<p class="s5-card__where">${where}</p>` : null}
    <p class="s5-card__state">${stateText(projected.state)}${projected.queued > 0 ? " (queued)" : ""}${j.jobNo ? html` · <span class="ac-num">${j.jobNo}</span>` : null}</p>
    <div class="s5-card__actions">
      ${directions ? html`<a class="ac-action s5-link--action" data-kind="quiet" data-density=${ctx.density} href=${directions} target="_blank" rel="noopener">Directions</a>` : null}
      ${contact?.phone ? html`<a class="ac-action s5-link--action" data-kind="quiet" data-density=${ctx.density} href=${telHref(contact.phone)} aria-label=${`Call ${contact.name}`}>Call</a>` : null}
      ${to ? PrimaryAction({ density: ctx.density, label: ACTION_LABEL[to] ?? stateText(to), id: `card-${j.id}-${to}`, onClick: move }) : null}
    </div>
  </li>`;
};

/** TODAY — the shift's jobs as cards, the one under way marked, each with the way there, the person to call and the next move. */
export const jobList: Screen = (ctx) => {
  const jobs = ctx.store.read(keyOf("jobs.mine"), () => ctx.shell.gateway.myJobs());
  return html`<section class="s5-jobs">
    ${pageHead(`Today — ${ctx.crew.label}`, "This shift's work, in order. Everything you record is saved on this device first and sent when there is a connection.")}
    ${whenReady(ctx, jobs.value, (out) => statStrip([
      { n: out.jobs.length, label: "Assigned" },
      { n: out.jobs.filter((j) => j.priority === "emergency").length, label: "Emergency", ...(out.jobs.some((j) => j.priority === "emergency") ? { tone: "breached" as const } : {}) },
      { n: out.jobs.filter((j) => UNDER_WAY.includes(j.state)).length, label: "Under way" },
    ], "shift-stats"))}
    ${whenReady(ctx, jobs.value, (out) => {
      if (out.jobs.length === 0) return html`<p class="s5-empty">Nothing assigned to this shift right now.</p>`;
      const current = out.jobs.find((j) => UNDER_WAY.includes(projectedJob(j, ctx.queue.pending.value).state)) ?? out.jobs[0]!;
      return html`<ul class="s5-cards">${out.jobs.map((j) => card(ctx, j, j.id === current.id))}</ul>`;
    })}
  </section>`;
};
