import { html, PrimaryAction, pageHead, panel, shortRef, type VNode } from "../../../../packages/ui/src/index.ts";
import type { JobPriority, ProjectWire, Refusal, SiteWire } from "../../../../packages/contracts/src/index.ts";
import { JOB_WORK_CLASSES, JOB_WORK_CLASS_LABEL, SERVICE_CATALOG, serviceLabel, serviceOf } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, perStore, boundEnd, type Screen, type ScreenContext } from "./common.ts";
import { defaultWindow, JOB_PRIORITIES, PRIORITY_WORD } from "./intake.ts";

/**
 * NEW JOB — a job with no portal request behind it: the customer phoned.
 * `jobs.create` is the same door S2 and Intake use, so the response time is
 * derived from the site's agreed term when the job opens, never typed here.
 * The site list (`sites.list`) is the dispatcher's own region; a site that is
 * not on it is a customer S2 has not signed in yet.
 *
 * A site with no agreed response time opens on the register's default
 * (`sla_response` 4_hour, packages/contracts/src/terms.ts), and the timer's
 * trace says so. A job is refused only when the term cannot be resolved — a
 * looser override under a tighter one, two rows in force at one node, a value
 * off the register — and those are Contracts' to fix. "Hold for Contracts" is
 * offered for a refusal that names a missing term (`no_value`, a term the
 * register gives no default): it records the call as a request at that site
 * (`serviceRequests.hold`), so it waits in Intake instead of being lost.
 *
 * 0024/0025: the service is picked from the catalogue, and its work decides
 * who is sent. Service and commissioning go to a technician; install goes to
 * an install crew, sits under the project of the person who sold it (S2,
 * Projects), and is never an emergency — so an install service asks for the
 * project and drops Emergency from the priorities.
 */
type Call = { readonly siteId: string; readonly serviceCode: string; readonly priority: JobPriority; readonly day: string };
type Submitting = { readonly busy: boolean; readonly refusal: Refusal | null; readonly call: Call | null };
const submittingFor = perStore<Submitting>({ busy: false, refusal: null, call: null });
type Choice = { readonly code: string; readonly siteId: string };
const choiceFor = perStore<Choice>({ code: "", siteId: "" });

const byCustomer = (sites: readonly SiteWire[]): [string, SiteWire[]][] => {
  const m = new Map<string, SiteWire[]>();
  for (const s of sites) m.set(s.orgName, [...(m.get(s.orgName) ?? []), s]);
  return [...m];
};

const create = async (ctx: ScreenContext, form: HTMLFormElement): Promise<void> => {
  const state = submittingFor(ctx.store);
  const f = new FormData(form);
  const work = serviceOf(String(f.get("serviceCode") ?? ""))?.workClass;
  const call: Call = {
    siteId: String(f.get("siteId") ?? ""), serviceCode: String(f.get("serviceCode") ?? "").trim(),
    priority: String(f.get("priority") ?? "routine") as JobPriority, day: String(f.get("start")).slice(0, 10),
  };
  state.value = { busy: true, refusal: null, call };
  try {
    const out = await ctx.shell.gateway.createJob({
      siteId: call.siteId,
      serviceCode: call.serviceCode,
      priority: call.priority,
      ...(work === "install" ? { projectId: String(f.get("projectId") ?? "") } : {}),
      serviceWindowStart: new Date(String(f.get("start"))).toISOString(),
      serviceWindowEnd: new Date(String(f.get("end"))).toISOString(),
    });
    state.value = { busy: false, refusal: null, call: null };
    choiceFor(ctx.store).value = { code: "", siteId: "" };
    ctx.store.notice.value = [`Job ${out.id} is open, response due ${new Date(out.dueAt).toLocaleString()}. Assign a crew below.`];
    ctx.store.invalidate("jobs.list");
    ctx.router.navigate("dispatch", { jobId: out.id });
  } catch (e) {
    state.value = { busy: false, refusal: ctx.shell.refusalOf(e) ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) }, call };
  }
};

/** "Preferred date:" is the line Intake's form reads its window from (defaultWindow). A request has no "pm" priority; planned work is routine. */
export const heldDescription = (c: Call): string => `Phoned in for ${serviceLabel(c.serviceCode)}.\nPreferred date: ${c.day}.`;

const hold = async (ctx: ScreenContext, call: Call): Promise<void> => {
  const state = submittingFor(ctx.store);
  state.value = { ...state.value, busy: true };
  try {
    const out = await ctx.shell.gateway.holdServiceRequest({
      siteId: call.siteId, priority: call.priority === "pm" ? "routine" : call.priority, description: heldDescription(call),
    });
    state.value = { busy: false, refusal: null, call: null };
    ctx.store.notice.value = [`Call held as request ${shortRef(out.id)}. It waits in Portal requests until Contracts sets the missing term, then opens from there.`];
    ctx.store.invalidate("serviceRequests.list");
    ctx.router.navigate("intake", {});
  } catch (e) {
    state.value = { busy: false, refusal: ctx.shell.refusalOf(e) ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) }, call };
  }
};

/** Where a refusal can go from here: a missing term can be held for Contracts; nothing else is the dispatcher's to route. */
const routesFor = (ctx: ScreenContext, s: Submitting) =>
  s.refusal?.kind === "admission" && s.refusal.missingTerm && s.call && !ctx.degraded && !s.busy
    ? [{ label: "Hold for Contracts", primary: true, onSelect: () => void hold(ctx, s.call!) }]
    : [];

const form = (ctx: ScreenContext, sites: readonly SiteWire[]): VNode => {
  const s = submittingFor(ctx.store).value;
  const choice = choiceFor(ctx.store);
  const { code, siteId } = choice.value;
  const work = serviceOf(code)?.workClass;
  const orgOfSite = sites.find((x) => x.id === siteId)?.orgId;
  // Only an install asks for the projects; the list waits until it does.
  const listed = work === "install" ? ctx.store.read(keyOf("projects.list", {}), () => ctx.shell.gateway.listProjects({})) : null;
  const openFor = (projects: readonly ProjectWire[]) => projects.filter((p) => p.orgId === orgOfSite && p.foremanId && (p.state === "planned" || p.state === "active"));
  // An install with no project to sit under can only be refused — say why at the button instead.
  const noProject = work !== "install" ? null
    : !orgOfSite ? "Choose the site first — an install opens under what was sold there."
    : listed?.value.state === "ready" && openFor(listed.value.value.projects).length === 0 ? "Nothing sold to this customer is open, so there is no project to open the install under."
    : null;
  const projectField = (): VNode => {
    return whenReady(ctx, listed!.value, (out) => {
      const open = openFor(out.projects);
      if (!orgOfSite) return html`<p class="s3-muted">Choose the site first — the project is what was sold to that customer.</p>`;
      if (open.length === 0) return html`<p class="s3-muted">Nothing sold to this customer is open. An install is opened under the project it was sold as — Service Manager records the sale.</p>`;
      return html`<label class="ac-field"><span>Project</span>
        <select class="ac-input" name="projectId" id="new-job-project" required>
          ${open.map((p: ProjectWire) => html`<option value=${p.id}>${p.name} — sold by ${p.foremanName}</option>`)}
        </select>
      </label>`;
    });
  };
  if (sites.length === 0) return panel(html`<p class="s3-muted">No sites in this region yet. A customer and its sites are signed in from Service Manager.</p>`, "Job", undefined, undefined, "new-job");
  const w = defaultWindow("", new Date());
  return panel(html`<form class="ac-form" id="new-job-form" onSubmit=${(e: Event) => { e.preventDefault(); if (!ctx.degraded && !s.busy) void create(ctx, e.currentTarget as HTMLFormElement); }}>
      <label class="ac-field"><span>Site</span>
        <select class="ac-input" name="siteId" id="new-job-site" required onChange=${(e: Event) => { choice.value = { ...choice.value, siteId: (e.currentTarget as HTMLSelectElement).value }; }}>
          <option value="">Choose a site</option>
          ${byCustomer(sites).map(([customer, list]) => html`<optgroup label=${customer}>
            ${list.map((site) => html`<option value=${site.id}>${[site.name, site.address?.line1, site.address?.city].filter(Boolean).join(" — ")}</option>`)}
          </optgroup>`)}
        </select>
      </label>
      <label class="ac-field"><span>Service</span>
        <select class="ac-input" name="serviceCode" id="new-job-service" required onChange=${(e: Event) => { choice.value = { ...choice.value, code: (e.currentTarget as HTMLSelectElement).value }; }}>
          <option value="">Choose a service</option>
          ${JOB_WORK_CLASSES.map((w) => html`<optgroup label=${JOB_WORK_CLASS_LABEL[w]}>
            ${SERVICE_CATALOG.filter((x) => x.workClass === w).map((x) => html`<option value=${x.code} selected=${x.code === code}>${x.label}</option>`)}
          </optgroup>`)}
        </select>
        <small>${work === "install" ? "Install work — sent to an install crew." : work ? "Sent to a technician." : "The service decides who is sent: install work to an install crew, the rest to a technician."}</small>
      </label>
      ${work === "install" ? projectField() : null}
      <label class="ac-field"><span>Priority</span>
        <select class="ac-input" name="priority" id="new-job-priority">
          ${JOB_PRIORITIES.filter((p) => !(work === "install" && p === "emergency")).map((p) => html`<option value=${p} defaultSelected=${p === "routine"}>${PRIORITY_WORD[p]}</option>`)}
        </select>
      </label>
      <label class="ac-field"><span>Window from</span><input class="ac-input" type="datetime-local" name="start" id="new-job-start" required defaultValue=${w.start} onInput=${boundEnd("end")} /></label>
      <label class="ac-field"><span>Window to</span><input class="ac-input" type="datetime-local" name="end" id="new-job-end" required defaultValue=${w.end} min=${w.start} /></label>
      <p class="s3-muted">The response time is the site's agreed term — it is derived when the job opens, not chosen here.</p>
      <span class="s3-row-actions">
        ${PrimaryAction({
          density: ctx.density, label: s.busy ? "Opening…" : "Open job", type: "submit", id: "new-job-submit",
          ...(ctx.degraded ? { disabledReason: ctx.shell.degradedNotice } : s.busy ? { disabledReason: "Opening…" } : noProject ? { disabledReason: noProject } : {}),
        })}
        <button type="button" class="s3-act" id="new-job-cancel" onClick=${() => { submittingFor(ctx.store).value = { busy: false, refusal: null, call: null }; choice.value = { code: "", siteId: "" }; ctx.router.navigate("board", {}); }}>Cancel</button>
      </span>
      ${s.refusal ? refusalView(ctx, s.refusal, routesFor(ctx, s)) : null}
    </form>`, "Job", "A call with no portal request behind it", undefined, "new-job");
};

export const newJob: Screen = (ctx) => {
  const sites = ctx.store.read(keyOf("sites.list", {}), () => ctx.shell.gateway.listSites());
  return html`<section class="s3-new-job">
    ${pageHead("New job", "Open a job for a customer who called in. Requests sent from the portal are answered from Portal requests.")}
    ${whenReady(ctx, sites.value, (out) => form(ctx, out.sites), () => ctx.store.invalidate("sites.list"))}
  </section>`;
};
