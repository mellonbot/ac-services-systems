import { html, signal, type VNode } from "../../../../packages/ui/src/index.ts";
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
 * While the gateway is unreachable the submit is refused with the reason
 * (SURFACES.S6.degraded): there is no queue here, by registry (`offline:
 * false`), because a request shown as accepted that nobody received is a
 * customer waiting on nobody.
 */
const PRIORITY_WORD: Readonly<Record<ServiceRequestPriority, string>> = {
  emergency: "Emergency — no heating or cooling, water, smoke or a safety concern",
  urgent: "Urgent — degraded, needs attention this week",
  routine: "Routine — schedule it",
};

type Outcome = { kind: "idle" } | { kind: "busy" } | { kind: "sent"; siteName: string } | { kind: "refused"; refusal: Refusal };
const outcome = signal<Outcome>({ kind: "idle" });
export const resetRequestForm = () => { outcome.value = { kind: "idle" }; };

export const request: Screen = (ctx, params) => {
  const nodes = readNodes(ctx);
  const preselected = params.siteId ?? "";

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded) return;
    const form = e.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    const siteId = String(f.get("siteId") ?? "");
    const priority = String(f.get("priority") ?? "routine") as ServiceRequestPriority;
    const description = String(f.get("description") ?? "");
    outcome.value = { kind: "busy" };
    try {
      await ctx.shell.gateway.createServiceRequest({ siteId, priority, description });
      const name = nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes).byId.get(siteId)?.name ?? "the site" : "the site";
      outcome.value = { kind: "sent", siteName: name };
      ctx.store.invalidate("serviceRequests.list");
      form.reset();
    } catch (err) {
      outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } };
    }
  };

  const o = outcome.value;
  return html`<section class="s6-request">
    <h1 class="s6-h1">Request service</h1>
    ${whenReady(ctx, nodes.value, (out) => {
      const tree = treeOf(out.nodes);
      const sites = tree.ofTier("site");
      if (sites.length === 0) return html`<p class="s6-empty">No sites are in view to request service at.</p>`;
      return html`<form class="s6-form" id="request-form" onSubmit=${submit}>
        <label class="s6-field"><span>Site</span>
          <select class="s6-input" name="siteId" required id="request-site">
            ${sites.map((s) => html`<option value=${s.id} defaultSelected=${s.id === preselected}>${tree.crumbs(s.id).slice(-2).join(" › ")}</option>`)}
          </select>
        </label>
        <fieldset class="s6-fieldset"><legend>Priority</legend>
          ${(Object.keys(PRIORITY_WORD) as ServiceRequestPriority[]).map((p) => html`
            <label class="s6-radio"><input type="radio" name="priority" value=${p} defaultChecked=${p === "routine"} /> <span>${PRIORITY_WORD[p]}</span></label>`)}
        </fieldset>
        <label class="s6-field"><span>What is wrong</span>
          <textarea class="s6-input s6-textarea" name="description" required rows="5" maxlength="2000" id="request-description" placeholder="Where, what you observed, since when."></textarea>
        </label>
        ${submitAction(ctx, o.kind === "busy" ? "Sending…" : "Send request", "request-send", o.kind === "busy")}
      </form>`;
    }, () => ctx.store.invalidate("accounts.list"))}
    ${outcomeView(ctx, o)}
    <p class="s6-actions">${linkTo(ctx, "work", {}, "See your work and requests")}</p>
  </section>`;
};

const outcomeView = (ctx: ScreenContext, o: Outcome): VNode | null => {
  switch (o.kind) {
    case "sent": return html`<p class="s6-sent" role="status" id="request-sent">Received — your request at ${o.siteName} is with the office. It will appear under Work as a job once one is opened against it.</p>`;
    case "refused": return refusalView(ctx, o.refusal, [{ label: "Edit and send again", onSelect: resetRequestForm, primary: true }]);
    default: return null;
  }
};
