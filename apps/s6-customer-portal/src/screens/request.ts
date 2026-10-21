import { html, pageHead, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { Refusal, ServiceRequestPriority } from "../../../../packages/contracts/src/index.ts";
import { whenReady, readNodes, treeOf, submitAction, refusalView, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * REQUEST SERVICE — S6's one write. The site list is the visible sites and
 * nothing else, so the form cannot offer a site the gateway would refuse; the
 * gateway refuses it anyway if a request arrives for one (unknown_site — the
 * row is not there from inside the customer's scope), and the refusal is
 * rendered as the card, with the axis, the way every other surface does it.
 *
 * Priority is the customer's declaration. The office may re-grade it, and the
 * response the customer is owed comes from the agreement's resolved term,
 * not from this field — the Terms screen is one link away for exactly that
 * reason.
 *
 * `serviceRequests.create` carries a site, a priority and a description, and
 * nothing else. What the customer picks as "what's going on" and the date
 * they would prefer are written INTO the description, where the office reads
 * them — never into a field the wire would drop. There is no photo upload
 * because there is no operation that takes one.
 *
 * While the gateway is unreachable the submit is refused with the reason
 * (SURFACES.S6.degraded): there is no queue here, by registry (`offline:
 * false`), because a request shown as accepted that nobody received is a
 * customer waiting on nobody.
 */
const PRIORITY_WORD: Readonly<Record<ServiceRequestPriority, string>> = {
  routine: "Standard",
  urgent: "Urgent",
  emergency: "Emergency",
};
const PRIORITY_HINT = "Urgent — degraded, needs attention this week. Emergency — no heating or cooling, water, smoke or a safety concern. If anyone is at risk, call your office as well: a form is not an alarm.";

export const PROBLEMS = ["No cooling", "No heating", "Noise / smell", "Routine maintenance", "Other"] as const;

/** What the office reads: the customer's pick, their words, and the day they would prefer — one description, nothing dropped. */
export const describe = (problem: string, details: string, preferred: string): string => {
  const head = problem && problem !== "Other" ? `${problem} — ` : "";
  const when = preferred ? `\nPreferred date: ${preferred}.` : "";
  return `${head}${details.trim()}${when}`;
};

/** A short reference the customer can read back to the office: the first block of the id, which both sides hold. */
export const refOf = (id: string): string => id.slice(0, 8).toUpperCase();

type Outcome = { kind: "idle" } | { kind: "busy" } | { kind: "sent"; siteName: string; ref: string } | { kind: "refused"; refusal: Refusal };
const outcome = signal<Outcome>({ kind: "idle" });
export const resetRequestForm = () => { outcome.value = { kind: "idle" }; };

/** The form itself — drawn on its own screen and beside the work orders, one form either way. */
export const requestForm = (ctx: ScreenContext, preselected = ""): VNode => {
  const nodes = readNodes(ctx);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded) return;
    const form = e.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    const siteId = String(f.get("siteId") ?? "");
    const priority = String(f.get("priority") ?? "routine") as ServiceRequestPriority;
    const description = describe(String(f.get("problem") ?? ""), String(f.get("description") ?? ""), String(f.get("preferred") ?? ""));
    outcome.value = { kind: "busy" };
    try {
      const out = await ctx.shell.gateway.createServiceRequest({ siteId, priority, description });
      const name = nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes).byId.get(siteId)?.name ?? "the site" : "the site";
      outcome.value = { kind: "sent", siteName: name, ref: refOf(out.id) };
      ctx.store.invalidate("serviceRequests.list");
      form.reset();
    } catch (err) {
      outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } };
    }
  };

  const o = outcome.value;
  return whenReady(ctx, nodes.value, (out) => {
    const tree = treeOf(out.nodes);
    const sites = tree.ofTier("site");
    if (sites.length === 0) return html`<p class="s6-empty">No sites are in view to request service at.</p>`;
    return html`<form class="ac-form" id="request-form" onSubmit=${submit}>
      <label class="ac-field"><span>Site</span>
        <select class="ac-input" name="siteId" required id="request-site">
          ${sites.map((s) => html`<option value=${s.id} defaultSelected=${s.id === preselected}>${tree.crumbs(s.id).slice(-2).join(" › ")}</option>`)}
        </select>
      </label>
      <fieldset class="s6-fieldset"><legend>What's going on?</legend>
        <span class="s6-choices">${PROBLEMS.map((p) => html`
          <label class="ac-chip s6-choice"><input type="radio" name="problem" value=${p} defaultChecked=${p === "Other"} /><span>${p}</span></label>`)}
        </span>
      </fieldset>
      <label class="ac-field"><span>Details</span>
        <textarea class="ac-input ac-textarea" name="description" required rows="4" maxlength="1900" id="request-description" placeholder="Where, what you observed, since when."></textarea>
      </label>
      <fieldset class="s6-fieldset"><legend>How urgent is this?</legend>
        <span class="s6-choices">${(Object.keys(PRIORITY_WORD) as ServiceRequestPriority[]).map((p) => html`
          <label class="ac-chip s6-choice"><input type="radio" name="priority" value=${p} defaultChecked=${p === "routine"} /><span>${PRIORITY_WORD[p]}</span></label>`)}
        </span>
        <span class="s6-hint">${PRIORITY_HINT}</span>
      </fieldset>
      <label class="ac-field"><span>Preferred date (optional)</span>
        <input class="ac-input" type="date" name="preferred" id="request-preferred" />
      </label>
      ${submitAction(ctx, o.kind === "busy" ? "Sending…" : "Send request", "request-send", o.kind === "busy")}
    </form>`;
  }, () => ctx.store.invalidate("accounts.list"));
};

export const request: Screen = (ctx, params) => html`<section class="s6-request">
  ${pageHead("Request service", "Tell us which site and what is wrong. It goes straight to the office for that region, and you can follow it under Work orders.")}
  ${requestForm(ctx, params.siteId ?? "")}
  ${outcomeView(ctx)}
  <p class="s6-actions">${linkTo(ctx, "work", {}, "See your work orders")}</p>
</section>`;

export const outcomeView = (ctx: ScreenContext): VNode | null => {
  const o = outcome.value;
  switch (o.kind) {
    case "sent": return html`<p class="ac-notice" data-tone="ok" role="status" id="request-sent">Received — your request at ${o.siteName} is with the office, reference <span class="ac-num">${o.ref}</span>. It is listed under your work orders and moves as the office opens a job against it.</p>`;
    case "refused": return refusalView(ctx, o.refusal, [{ label: "Edit and send again", onSelect: resetRequestForm, primary: true }]);
    default: return null;
  }
};
