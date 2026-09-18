import { html, PrimaryAction, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { FieldJobWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { nextDeviceStates } from "../offline.ts";
import { whenReady, type Screen } from "./common.ts";

/**
 * A small, fixed checklist. Nothing in the schema names a per-service-code
 * template yet (checklist_items just carries a job_id + a free item_key), so
 * this is the same three questions on every job until a real template exists
 * to read instead — a placeholder stated as one, not a table pretending to
 * be configuration.
 */
const CHECKLIST: readonly { readonly key: string; readonly label: string }[] = [
  { key: "ppe_donned", label: "PPE donned" },
  { key: "safety_briefing", label: "Site safety briefing given" },
  { key: "work_verified", label: "Work verified with the customer" },
];

const PART_SOURCES = ["truck", "location_stock", "regional_hub", "national"] as const;

/**
 * THE JOB DETAIL — transitions, the checklist, the time clock, and a parts
 * quick-add, every one of them a call to `ctx.queue.enqueue` followed by a
 * best-effort `ctx.queue.flush`. Enqueue never fails and never waits on the
 * network — that is the whole point of an offline-first field screen — so a
 * tech's tap always registers instantly; flush is what actually walks
 * `sync.replay`, and if it cannot reach the gateway right now the mutation
 * simply stays queued for the next tick or the next screen open.
 *
 * What this screen does NOT do: show the job as already transitioned the
 * moment a button is tapped. The displayed state is always the last thing
 * `jobs.mine` actually returned — "device holds intent, server holds truth"
 * means this screen does not invent a truth of its own to display while
 * waiting, only a queued-count so the tech knows the tap was taken.
 */
export const jobDetail: Screen = (ctx, params) => {
  const jobId = params.jobId!;
  const jobsKey = keyOf("jobs.mine");
  const jobs = ctx.store.read(jobsKey, () => ctx.shell.gateway.myJobs());

  const flush = () => {
    void ctx.queue.flush((mutations) =>
      ctx.shell.gateway.replaySync({ orgId: ctx.shell.principal.orgId, regionId: ctx.shell.principal.regionId, mutations }),
    ).then(() => ctx.store.invalidate("jobs.mine"));
  };

  const renderForJob = (out: { jobs: readonly FieldJobWire[] }): VNode => {
    const job = out.jobs.find((j) => j.id === jobId);
    if (!job) return html`<p class="s5-empty">Job ${jobId} is not on this shift's board.</p>`;

    const transition = (to: string) => { ctx.queue.enqueue("jobs", job.id, "transition", { state: to }, job.version); flush(); };
    const markDone = (key: string) => { ctx.queue.enqueue("checklist_items", job.id, "insert", { item_key: key, response: { done: true, at: new Date().toISOString() } }, null); flush(); };

    const runningSince = ctx.clock.value[job.id];
    const clockToggle = () => {
      if (runningSince) {
        ctx.queue.enqueue("time_entries", job.id, "insert", { crew_id: ctx.crew.id, start: runningSince, end: new Date().toISOString(), kind: "labor" }, null);
        const rest = { ...ctx.clock.value };
        delete (rest as Record<string, string>)[job.id];
        ctx.clock.value = rest;
        flush();
      } else {
        ctx.clock.value = { ...ctx.clock.value, [job.id]: new Date().toISOString() };
      }
    };

    const addPart = (e: Event) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget as HTMLFormElement);
      const sku = String(f.get("partSku") ?? "").trim();
      const qty = Number(f.get("quantity") ?? "0");
      const source = String(f.get("source") ?? "truck");
      if (!sku || !Number.isFinite(qty) || qty <= 0) return;
      ctx.queue.enqueue("parts_used", job.id, "insert", { part_sku: sku, quantity_milli: Math.round(qty * 1000), source }, null);
      flush();
      (e.currentTarget as HTMLFormElement).reset();
    };

    const jobAttention = ctx.queue.attention.value.filter((a) => a.entityId === job.id);
    const jobPending = ctx.queue.pending.value.filter((p) => p.mutation.entityId === job.id).length;

    return html`<section class="s5-job">
      <h1 class="s5-h1">${job.serviceCode}</h1>
      <p class="s5-job__state">State: <strong>${job.state.replace(/_/g, " ")}</strong> · Priority: ${job.priority}</p>
      <p class="s5-job__window">${new Date(job.serviceWindowStart).toLocaleString()} → ${new Date(job.serviceWindowEnd).toLocaleString()}</p>
      ${jobPending > 0 ? html`<p class="s5-queued" role="status">${jobPending} change${jobPending === 1 ? "" : "s"} waiting to sync${ctx.degraded ? " — offline" : ""}.</p>` : null}
      ${jobAttention.map((a) => html`<div class="s5-attention" role="alert" key=${a.mutationId}>
        ${StatusPill({ density: ctx.density, status: "blocked", label: a.kind.replace(/_/g, " ") })}
        <p>${a.note}</p>
        <button type="button" class="s5-link" onClick=${() => ctx.queue.dismissAttention(a.mutationId)}>Dismiss</button>
      </div>`)}

      <h2 class="s5-h2">Move job to</h2>
      <div class="s5-actions">
        ${nextDeviceStates(job.state).map((to) => PrimaryAction({ density: ctx.density, label: to.replace(/_/g, " "), id: `to-${to}`, onClick: () => transition(to) }))}
        ${nextDeviceStates(job.state).length === 0 ? html`<p class="s5-muted">No further state change is this shift's to make from here.</p>` : null}
      </div>

      <h2 class="s5-h2">Checklist</h2>
      <ul class="s5-checklist">
        ${CHECKLIST.map((c) => html`<li key=${c.key}>${PrimaryAction({ density: ctx.density, label: c.label, id: `check-${c.key}`, onClick: () => markDone(c.key) })}</li>`)}
      </ul>

      <h2 class="s5-h2">Time clock</h2>
      <p class="s5-job__clock">${runningSince ? `Running since ${new Date(runningSince).toLocaleTimeString()}` : "Not running"}</p>
      ${PrimaryAction({ density: ctx.density, label: runningSince ? "Stop" : "Start", id: "clock-toggle", onClick: clockToggle, kind: runningSince ? "danger" : "primary" })}

      <h2 class="s5-h2">Parts used</h2>
      <form class="s5-form" id="parts-form" onSubmit=${addPart}>
        <label class="s5-field"><span>Part SKU</span><input class="s5-input" name="partSku" type="text" required /></label>
        <label class="s5-field"><span>Quantity</span><input class="s5-input" name="quantity" type="number" step="0.001" min="0" required /></label>
        <label class="s5-field"><span>Source</span>
          <select class="s5-input" name="source">
            ${PART_SOURCES.map((s) => html`<option value=${s}>${s.replace(/_/g, " ")}</option>`)}
          </select>
        </label>
        ${PrimaryAction({ density: ctx.density, label: "Add part", type: "submit", id: "add-part" })}
      </form>
    </section>`;
  };

  return whenReady(ctx, jobs.value, renderForJob);
};

// Exported so the test can check the checklist's fixed keys and the source enum against the schema's own CHECK constraint.
export { CHECKLIST, PART_SOURCES };
