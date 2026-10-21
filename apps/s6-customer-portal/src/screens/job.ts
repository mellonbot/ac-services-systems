import { html, pageHead, panel, signal, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { JobWire, JobMessageWire, JobUpdateWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readNodes, treeOf, submitAction, refusalView, linkTo, when, type Screen, type ScreenContext } from "./common.ts";
import { STATE_WORD, STEPS, stepOf, slaStatus } from "./work.ts";

/**
 * ONE JOB, AS THE CUSTOMER READS IT. Where the work stands, what the office
 * has PUBLISHED about it, and the thread with the office — all three from
 * `jobs.list` and `jobs.conversation`, whose rows 0016 has already narrowed:
 * a draft, an internal note, a crew, a photo key or an office user's name
 * never reaches this screen, so nothing here filters them out.
 *
 * The reply is the customer's one write on a job. Which side wrote it is the
 * caller's namespace at the gateway, never a field this form sends.
 */
type Outcome = { kind: "idle" } | { kind: "busy" } | { kind: "sent" } | { kind: "refused"; refusal: Refusal };
const outcome = signal<Outcome>({ kind: "idle" });
export const resetReplyForm = () => { outcome.value = { kind: "idle" }; };

/** Newest first: the update a customer opens the page for is the latest one. */
export const publishedNewestFirst = (updates: readonly JobUpdateWire[]): readonly JobUpdateWire[] =>
  updates.filter((u) => u.state === "published" && u.publishedAt).sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!));

/** Who a message is from, in the customer's words: the office is "AC Services"; a customer is named, or "You" when unnamed. */
export const authorWord = (m: JobMessageWire): string => (m.authorKind === "office" ? "AC Services" : m.authorName ?? "You");

export const job: Screen = (ctx, params) => {
  const jobId = params.jobId!;
  const nodes = readNodes(ctx);
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const convo = ctx.store.read(keyOf("jobs.conversation", { jobId }), () => ctx.shell.gateway.jobConversation({ jobId }));
  const now = Date.now();

  const send = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded) return;
    const form = e.currentTarget as HTMLFormElement;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    outcome.value = { kind: "busy" };
    try {
      await ctx.shell.gateway.postJobMessage({ jobId, body });
      outcome.value = { kind: "sent" };
      form.reset();
      ctx.store.invalidate("jobs.conversation");
    } catch (err) {
      outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } };
    }
  };

  return whenReady(ctx, jobs.value, (out) => {
    const j = out.jobs.find((x) => x.id === jobId);
    if (!j) return html`<section class="s6-job">
      ${pageHead("Job not found", "This job is not at a site in your view, or it no longer exists.")}
      <p class="s6-actions">${linkTo(ctx, "work", {}, "Back to your work")}</p>
    </section>`;
    const siteName = (nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes).byId.get(j.siteId)?.name : undefined) ?? j.siteName ?? "your site";
    const o = outcome.value;
    return html`<section class="s6-job" data-job=${j.id}>
      ${pageHead(html`${j.serviceCode.replace(/[_-]/g, " ")} at ${siteName}`, html`Job <span class="s6-num">${j.id}</span> · ${STATE_WORD[j.state]}`)}
      ${panel(factsView(ctx, j, siteName, now), "Where it stands")}
      <div class="s6-job__grid">
        ${panel(whenReady(ctx, convo.value, (c) => updatesView(publishedNewestFirst(c.updates)), () => ctx.store.invalidate("jobs.conversation")),
          "Updates from AC Services", "What the office has told you about this job, newest first.", undefined, "job-updates")}
        ${panel(html`
          ${whenReady(ctx, convo.value, (c) => threadView(c.messages), () => ctx.store.invalidate("jobs.conversation"))}
          <form class="ac-form s6-reply" id="reply-form" onSubmit=${send}>
            <label class="ac-field"><span>Message the office</span>
              <textarea class="ac-input ac-textarea" name="body" required rows="3" maxlength="2000" id="reply-body" placeholder="A question, access details, a time that suits you."></textarea>
            </label>
            ${submitAction(ctx, o.kind === "busy" ? "Sending…" : "Send", "reply-send", o.kind === "busy")}
          </form>
          ${o.kind === "sent" ? html`<p class="ac-notice" data-tone="ok" role="status" id="reply-sent">Sent — the office sees it on this job.</p>` : null}
          ${o.kind === "refused" ? refusalView(ctx, o.refusal, [{ label: "Edit and send again", onSelect: resetReplyForm, primary: true }]) : null}`,
          "Messages", "Between you and the office about this job.", undefined, "job-thread")}
      </div>
      <p class="s6-actions">${linkTo(ctx, "work", {}, "Back to your work")} ${linkTo(ctx, "site", { siteId: j.siteId }, `${siteName} site card`)}</p>
    </section>`;
  }, () => ctx.store.invalidate("jobs.list"));
};

const factsView = (ctx: ScreenContext, j: JobWire, siteName: string, now: number): VNode => {
  const at = stepOf({ jobState: j.state });
  return html`<div class="s6-job__facts">
    ${at >= 0 ? html`<ol class="s6-steps" aria-label="Where this job stands">
      ${STEPS.map((label, i) => html`<li class="s6-step" data-state=${i < at ? "done" : i === at ? "current" : "todo"} aria-current=${i === at ? "step" : undefined}><span class="s6-step__dot" aria-hidden="true"></span><span class="s6-step__label">${label}</span></li>`)}
    </ol>` : null}
    <dl class="ac-facts">
      <div><dt>Site</dt><dd>${linkTo(ctx, "site", { siteId: j.siteId }, siteName)}</dd></div>
      <div><dt>Status</dt><dd>${STATE_WORD[j.state]}</dd></div>
      <div><dt>Window</dt><dd class="s6-num">${when(j.serviceWindowStart)} – ${when(j.serviceWindowEnd)}</dd></div>
      <div><dt>Response</dt><dd>${StatusPill({ density: ctx.density, status: slaStatus(j, now), label: j.slaSatisfiedAt ? `Responded ${when(j.slaSatisfiedAt)}` : j.slaDueAt ? `Due ${when(j.slaDueAt)}` : "No commitment on file" })}</dd></div>
    </dl>
  </div>`;
};

const updatesView = (updates: readonly JobUpdateWire[]): VNode => updates.length === 0
  ? html`<p class="s6-empty">No updates yet. When the office has news about this job, it appears here.</p>`
  : html`<ol class="s6-updates">${updates.map((u) => html`<li class="s6-update" data-update=${u.id}>
      <p class="s6-update__body">${u.body}</p>
      <p class="s6-update__when">AC Services · <span class="s6-num">${when(u.publishedAt!)}</span></p>
    </li>`)}</ol>`;

const threadView = (messages: readonly JobMessageWire[]): VNode => messages.length === 0
  ? html`<p class="s6-empty">No messages yet. Ask the office anything about this job below.</p>`
  : html`<ol class="s6-thread">${messages.map((m) => html`<li class="s6-msg" data-side=${m.authorKind} data-message=${m.id}>
      <span class="s6-msg__who">${authorWord(m)} · <span class="s6-num">${when(m.at)}</span></span>
      <p class="s6-msg__body">${m.body}</p>
    </li>`)}</ol>`;
