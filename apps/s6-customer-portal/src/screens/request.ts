import { html, pageHead, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import { PHOTO_MAX_BYTES, PHOTOS_PER_REQUEST, sniffPhoto, type Refusal, type ServiceRequestPriority } from "../../../../packages/contracts/src/index.ts";
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
 * them — never into a field the wire would drop.
 *
 * Photos go AFTER the request, one `serviceRequests.attachPhoto` each (0017):
 * a photo that is refused, or a store that does not answer, never loses the
 * request it belongs to. Each one is checked here first — its own bytes, its
 * size — so a wrong file is named before it is uploaded, and the gateway
 * checks again because a bundle is not a boundary.
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

/** One photo that did not go, and why — in the gateway's words, or ours when it was refused before sending. */
export type PhotoMiss = { readonly name: string; readonly why: string };
type Outcome =
  | { kind: "idle" } | { kind: "busy"; step: string }
  | { kind: "sent"; siteName: string; ref: string; photos: number; missed: readonly PhotoMiss[] }
  | { kind: "refused"; refusal: Refusal };
const outcome = signal<Outcome>({ kind: "idle" });
const chosen = signal<readonly File[]>([]);
export const resetRequestForm = () => { outcome.value = { kind: "idle" }; chosen.value = []; };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
/** Bytes → base64 in slices, so a 10 MB photo does not overflow the argument list. */
export const toBase64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
/** Why this photo would be refused, before it is sent — or null when it may go. */
export const photoProblem = (bytes: Uint8Array): string | null =>
  bytes.length > PHOTO_MAX_BYTES ? `${mb(bytes.length)} — a photo is at most ${mb(PHOTO_MAX_BYTES)}`
  : sniffPhoto(bytes) ? null : "not a JPEG, PNG or HEIC photo";

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
    const files = chosen.value;
    outcome.value = { kind: "busy", step: "Sending…" };
    let out: Awaited<ReturnType<typeof ctx.shell.gateway.createServiceRequest>>;
    try {
      out = await ctx.shell.gateway.createServiceRequest({ siteId, priority, description });
    } catch (err) {
      outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } };
      return;
    }
    const going = files.slice(0, PHOTOS_PER_REQUEST);
    const missed: PhotoMiss[] = files.slice(PHOTOS_PER_REQUEST).map((f) => ({ name: f.name, why: `over the ${PHOTOS_PER_REQUEST}-photo limit` }));
    let sent = 0;
    for (const [i, file] of going.entries()) {
      outcome.value = { kind: "busy", step: `Sending photo ${i + 1} of ${going.length}…` };
      // Size from the File first: a video picked by mistake is refused without reading it into memory.
      if (file.size > PHOTO_MAX_BYTES) { missed.push({ name: file.name, why: `${mb(file.size)} — a photo is at most ${mb(PHOTO_MAX_BYTES)}` }); continue; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const problem = photoProblem(bytes);
      if (problem) { missed.push({ name: file.name, why: problem }); continue; }
      try {
        await ctx.shell.gateway.attachServiceRequestPhoto({ requestId: out.id, dataBase64: toBase64(bytes) });
        sent += 1;
      } catch (err) {
        missed.push({ name: file.name, why: ctx.shell.refusalOf(err)?.message ?? String(err) });
      }
    }
    const name = nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes).byId.get(siteId)?.name ?? "the site" : "the site";
    outcome.value = { kind: "sent", siteName: name, ref: refOf(out.id), photos: sent, missed };
    chosen.value = [];
    ctx.store.invalidate("serviceRequests.list");
    form.reset();
  };

  const choose = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    chosen.value = Array.from(input.files ?? []);
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
      <div class="ac-field"><span id="request-photos-label">Photos (optional)</span>
        <label class="s6-drop" data-chosen=${chosen.value.length > 0 ? "true" : "false"}>
          <input type="file" name="photos" id="request-photos" multiple accept="image/jpeg,image/png,image/heic,image/heif" aria-labelledby="request-photos-label" onChange=${choose} />
          <span class="s6-drop__glyph" aria-hidden="true">${cameraGlyph()}</span>
          <span>Drag photos here, or tap to choose</span>
          <span class="s6-hint">Up to ${PHOTOS_PER_REQUEST} — JPEG, PNG or HEIC, ${mb(PHOTO_MAX_BYTES)} each</span>
        </label>
        ${chosen.value.length ? html`<ul class="s6-chosen" id="request-chosen">
          ${chosen.value.map((f, i) => html`<li data-over=${i >= PHOTOS_PER_REQUEST || f.size > PHOTO_MAX_BYTES ? "true" : "false"}>
            <span class="s6-chosen__name">${f.name}</span> <span class="ac-num">${mb(f.size)}</span>
            ${i >= PHOTOS_PER_REQUEST ? html` — over the ${PHOTOS_PER_REQUEST}-photo limit, will not be sent` : f.size > PHOTO_MAX_BYTES ? " — too large, will not be sent" : null}
          </li>`)}
        </ul>` : null}
      </div>
      ${submitAction(ctx, o.kind === "busy" ? o.step : "Send request", "request-send", o.kind === "busy")}
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
    case "sent": return html`<div class="ac-notice" data-tone=${o.missed.length ? "at_risk" : "ok"} role="status" id="request-sent">
      <p class="ac-notice__message">Received — your request at ${o.siteName} is with the office, reference <span class="ac-num">${o.ref}</span>${o.photos ? html`, with <span class="ac-num">${o.photos}</span> photo${o.photos === 1 ? "" : "s"}` : null}. It is listed under your work orders and moves as the office opens a job against it.</p>
      ${o.missed.length ? html`<p class="ac-notice__message">${o.missed.length === 1 ? "One photo was" : `${o.missed.length} photos were`} not sent:</p>
        <ul class="s6-missed" id="request-photos-missed">${o.missed.map((m) => html`<li><span class="s6-chosen__name">${m.name}</span> — ${m.why}</li>`)}</ul>` : null}
    </div>`;
    case "refused": return refusalView(ctx, o.refusal, [{ label: "Edit and send again", onSelect: resetRequestForm, primary: true }]);
    default: return null;
  }
};

const cameraGlyph = (): VNode => html`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" focusable="false">
  <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
</svg>`;
