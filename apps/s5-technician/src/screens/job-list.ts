import { html, statStrip, pageHead, StatusPill, type Status } from "../../../../packages/ui/src/index.ts";
import type { JobPriority } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen } from "./common.ts";

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

export const jobList: Screen = (ctx) => {
  const jobs = ctx.store.read(keyOf("jobs.mine"), () => ctx.shell.gateway.myJobs());
  return html`<section class="s5-jobs">
    ${pageHead(`My jobs — ${ctx.crew.label}`, "This shift's work, in order. Everything you record is saved on this device first and sent when there is a connection.")}
    ${whenReady(ctx, jobs.value, (out) => statStrip([
      { n: out.jobs.length, label: "Assigned" },
      { n: out.jobs.filter((j) => j.priority === "emergency").length, label: "Emergency", ...(out.jobs.some((j) => j.priority === "emergency") ? { tone: "breached" as const } : {}) },
      { n: out.jobs.filter((j) => ["en_route", "on_site", "in_progress"].includes(j.state)).length, label: "Under way", tone: "info" },
    ], "shift-stats"))}
    ${whenReady(ctx, jobs.value, (out) => out.jobs.length === 0
      ? html`<p class="s5-empty">Nothing assigned to this shift right now.</p>`
      : html`<ul class="s5-job-list">
          ${out.jobs.map((j) => html`<li class="s5-job-row" key=${j.id}>
            ${StatusPill({ density: ctx.density, status: priorityStatus(j.priority), label: j.priority })}
            <span class="s5-job-row__service">${j.serviceCode}</span>
            <span class="s5-job-row__state">${j.state.replace(/_/g, " ")}</span>
            ${linkTo(ctx, "job", { jobId: j.id }, "Open", "s5-link s5-link--open")}
          </li>`)}
        </ul>`)}
  </section>`;
};
