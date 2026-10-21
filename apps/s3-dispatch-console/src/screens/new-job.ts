import { html, PrimaryAction, pageHead, panel, type VNode } from "../../../../packages/ui/src/index.ts";
import type { JobPriority, Refusal, SiteWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, type Screen, type ScreenContext } from "./common.ts";
import { perStore, defaultWindow, JOB_PRIORITIES, PRIORITY_WORD } from "./intake.ts";

/**
 * NEW JOB — a job with no portal request behind it: the customer phoned.
 * `jobs.create` is the same door S2 and Intake use, so the response time is
 * derived from the site's agreed term when the job opens, never typed here.
 * The site list (`sites.list`) is the dispatcher's own region; a site that is
 * not on it is a customer S2 has not signed in yet.
 */
type Submitting = { readonly busy: boolean; readonly refusal: Refusal | null };
const submittingFor = perStore<Submitting>({ busy: false, refusal: null });

const byCustomer = (sites: readonly SiteWire[]): [string, SiteWire[]][] => {
  const m = new Map<string, SiteWire[]>();
  for (const s of sites) m.set(s.orgName, [...(m.get(s.orgName) ?? []), s]);
  return [...m];
};

const create = async (ctx: ScreenContext, form: HTMLFormElement): Promise<void> => {
  const state = submittingFor(ctx.store);
  const f = new FormData(form);
  state.value = { busy: true, refusal: null };
  try {
    const out = await ctx.shell.gateway.createJob({
      siteId: String(f.get("siteId") ?? ""),
      serviceCode: String(f.get("serviceCode") ?? "").trim(),
      priority: String(f.get("priority") ?? "routine") as JobPriority,
      serviceWindowStart: new Date(String(f.get("start"))).toISOString(),
      serviceWindowEnd: new Date(String(f.get("end"))).toISOString(),
    });
    state.value = { busy: false, refusal: null };
    ctx.store.notice.value = [`Job ${out.id} is open, response due ${new Date(out.dueAt).toLocaleString()}. Assign a crew below.`];
    ctx.store.invalidate("jobs.list");
    ctx.router.navigate("dispatch", { jobId: out.id });
  } catch (e) {
    state.value = { busy: false, refusal: ctx.shell.refusalOf(e) ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) } };
  }
};

const form = (ctx: ScreenContext, sites: readonly SiteWire[]): VNode => {
  const s = submittingFor(ctx.store).value;
  if (sites.length === 0) return panel(html`<p class="s3-muted">No sites in this region yet. A customer and its sites are signed in from Service Manager.</p>`, "Job", undefined, undefined, "new-job");
  const w = defaultWindow("", new Date());
  return panel(html`<form class="ac-form" id="new-job-form" onSubmit=${(e: Event) => { e.preventDefault(); if (!ctx.degraded && !s.busy) void create(ctx, e.currentTarget as HTMLFormElement); }}>
      <label class="ac-field"><span>Site</span>
        <select class="ac-input" name="siteId" id="new-job-site" required>
          <option value="">Choose a site</option>
          ${byCustomer(sites).map(([customer, list]) => html`<optgroup label=${customer}>
            ${list.map((site) => html`<option value=${site.id}>${[site.name, site.address?.line1, site.address?.city].filter(Boolean).join(" — ")}</option>`)}
          </optgroup>`)}
        </select>
      </label>
      <label class="ac-field"><span>Service</span>
        <input class="ac-input" name="serviceCode" id="new-job-service" required maxlength="80" placeholder="e.g. repairs, rtu_changeout, pm_route" />
      </label>
      <label class="ac-field"><span>Priority</span>
        <select class="ac-input" name="priority" id="new-job-priority">
          ${JOB_PRIORITIES.map((p) => html`<option value=${p} defaultSelected=${p === "routine"}>${PRIORITY_WORD[p]}</option>`)}
        </select>
      </label>
      <label class="ac-field"><span>Window from</span><input class="ac-input" type="datetime-local" name="start" id="new-job-start" required defaultValue=${w.start} /></label>
      <label class="ac-field"><span>Window to</span><input class="ac-input" type="datetime-local" name="end" id="new-job-end" required defaultValue=${w.end} /></label>
      <p class="s3-muted">The response time is the site's agreed term — it is derived when the job opens, not chosen here.</p>
      <span class="s3-row-actions">
        ${PrimaryAction({
          density: ctx.density, label: s.busy ? "Opening…" : "Open job", type: "submit", id: "new-job-submit",
          ...(ctx.degraded ? { disabledReason: ctx.shell.degradedNotice } : s.busy ? { disabledReason: "Opening…" } : {}),
        })}
        <button type="button" class="s3-act" id="new-job-cancel" onClick=${() => { submittingFor(ctx.store).value = { busy: false, refusal: null }; ctx.router.navigate("board", {}); }}>Cancel</button>
      </span>
      ${s.refusal ? refusalView(ctx, s.refusal) : null}
    </form>`, "Job", "A call with no portal request behind it", undefined, "new-job");
};

export const newJob: Screen = (ctx) => {
  const sites = ctx.store.read(keyOf("sites.list", {}), () => ctx.shell.gateway.listSites());
  return html`<section class="s3-new-job">
    ${pageHead("New job", "Open a job for a customer who called in. Requests sent from the portal are answered from Intake.")}
    ${whenReady(ctx, sites.value, (out) => form(ctx, out.sites), () => ctx.store.invalidate("sites.list"))}
  </section>`;
};
