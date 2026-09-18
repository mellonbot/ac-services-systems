import { html, ComplianceBadge, PrimaryAction, type VNode } from "../../../../packages/ui/src/index.ts";
import type { JobWire, CandidateCrewWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, type Screen } from "./common.ts";

/**
 * THE ONE GATED DOOR, at a screen. `dispatch.candidates` is read here for
 * every active crew in the job's region — a DRY RUN of the exact gate
 * `dispatch.assign` enforces (assignment.ts's own comment: "not a second gate
 * with its own opinion") — so what a dispatcher sees here and what happens
 * when they click Assign cannot legally disagree. `ComplianceBadge` is
 * console-only for exactly this reason: this is the one screen in the whole
 * system where a crew's document standing is shown to a person who can act
 * on it, and it is shown as a badge with a reason, not a checkbox to
 * override — there is no override path, here or at the gateway.
 */
export const dispatch: Screen = (ctx, params) => {
  const jobId = params.jobId!;
  const jobsList = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));

  const renderForJob = (jobs: { jobs: readonly JobWire[] }): VNode => {
    const job = jobs.jobs.find((j) => j.id === jobId);
    if (!job) return html`<p class="s3-empty">Job ${jobId} is not on this board.</p>`;

    const candidatesKey = keyOf("dispatch.candidates", { jobId });
    const candidates = ctx.store.read(candidatesKey, () => ctx.shell.gateway.candidateCrews({ jobId, orgId: job.orgId, regionId: job.regionId }));

    const assign = async (crew: CandidateCrewWire) => {
      if (!crew.cleared) return; // the button for an uncleared crew is not rendered; this is belt-and-suspenders against a stale re-render
      const out = await ctx.shell.gateway.assignCrew({ jobId: job.id, crewId: crew.crewId, orgId: job.orgId, regionId: job.regionId });
      if (out.ok) {
        ctx.store.notice.value = [`${crew.label} assigned to ${job.serviceCode}.`];
        ctx.store.invalidate("jobs.list");
        ctx.router.navigate("board", {});
      } else {
        // The same verdict candidateCrews already showed — a race (someone else assigned in the meantime, or a
        // document expired between the read and the click) rather than a surprise, but it is reported the same way.
        ctx.store.notice.value = [`${crew.label} was refused at assignment: ${out.refusal.reason.replace(/_/g, " ")} — ${out.refusal.detail}`];
        ctx.store.invalidate(candidatesKey);
      }
    };

    return html`<section class="s3-dispatch">
      <h1 class="s3-h1">Dispatch — ${job.serviceCode}</h1>
      <dl class="s3-job-facts">
        <dt>Site</dt><dd><code>${job.siteId}</code></dd>
        <dt>Priority</dt><dd>${job.priority}</dd>
        <dt>Window</dt><dd>${new Date(job.serviceWindowStart).toLocaleString()} → ${new Date(job.serviceWindowEnd).toLocaleString()}</dd>
      </dl>
      <h2 class="s3-h2">Candidate crews</h2>
      ${whenReady(ctx, candidates.value, (out) => out.candidates.length === 0
        ? html`<p class="s3-empty">No active crews in this job's region.</p>`
        : html`<ul class="s3-candidates">
            ${out.candidates.map((c) => html`<li class="s3-candidate" key=${c.crewId}>
              <span class="s3-candidate__label">${c.label} <span class="s3-muted">(${c.employmentType})</span></span>
              ${ComplianceBadge({
                density: "console", cleared: c.cleared,
                ...(c.refusal ? { reason: c.refusal.reason, detail: c.refusal.detail } : {}),
              })}
              ${c.cleared
                ? PrimaryAction({
                    density: ctx.density, label: "Assign", id: `assign-${c.crewId}`, onClick: () => void assign(c),
                    ...(ctx.degraded ? { disabledReason: `Gateway unreachable — ${ctx.shell.degradedMode}` } : {}),
                  })
                : null}
            </li>`)}
          </ul>`)}
    </section>`;
  };

  return whenReady(ctx, jobsList.value, renderForJob);
};
