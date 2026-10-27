import { html, pageHead, panel, PrimaryAction, type VNode } from "../../../../packages/ui/src/index.ts";
import { serviceLabel, RTU_VOLTAGES, RTU_FUELS, QUOTE_MIN_PHOTOS, WRAP_UP_MIN_PHOTOS, type FieldJobWire, type WrapUpMeasurementsWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { projectedJob } from "../offline.ts";
import { missingFor, type Draft } from "../wrap-ups.ts";
import { photoBase64, signatureBase64 } from "../capture.ts";
import { whenReady, addressLine, flushQueue, type Screen, type ScreenContext } from "./common.ts";

/**
 * WRAP UP — how the visit closes (0034, partner mockup "3 · Wrap up the job").
 * Every field saves to the device as it is typed or taken; Submit moves the
 * draft to the outbox and the job off the crew's working list at once. It
 * stays disabled, with what is missing said under it, until the rules the
 * gateway will check again are met.
 */
const FIELDS: readonly { readonly key: keyof WrapUpMeasurementsWire; readonly label: string; readonly kind: "number" | "text" | "voltage" | "fuel"; readonly step?: string }[] = [
  { key: "tonnage", label: "Tonnage", kind: "number", step: "0.5" },
  { key: "voltage", label: "Voltage / phase", kind: "voltage" },
  { key: "fuel", label: "Fuel", kind: "fuel" },
  { key: "unitLengthIn", label: "Unit length (in)", kind: "number", step: "1" },
  { key: "unitWidthIn", label: "Unit width (in)", kind: "number", step: "1" },
  { key: "unitHeightIn", label: "Unit height (in)", kind: "number", step: "1" },
  { key: "curbLengthIn", label: "Curb length (in)", kind: "number", step: "1" },
  { key: "curbWidthIn", label: "Curb width (in)", kind: "number", step: "1" },
  { key: "oldModel", label: "Old unit model", kind: "text" },
  { key: "oldSerial", label: "Old unit serial", kind: "text" },
];
const FUEL_LABEL: Readonly<Record<string, string>> = { gas: "Gas", electric: "Electric", heat_pump: "Heat pump" };

/**
 * The pad draws in the text ink and hands the whole signature over as a PNG
 * each time a stroke ends — a signature is several strokes, so the pad stays
 * a pad. A signature saved before a reload is drawn back onto it. Set up once
 * per canvas element.
 */
const signaturePad = (saved: string | undefined, onStroke: (png: string) => void) => (canvas: HTMLCanvasElement | null): void => {
  if (!canvas || canvas.dataset.ready) return;
  canvas.dataset.ready = "1";
  const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  const g = canvas.getContext("2d")!;
  g.scale(ratio, ratio);
  g.lineWidth = 2.5; g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = getComputedStyle(canvas).color;
  if (saved) { const img = new Image(); img.onload = () => g.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight); img.src = `data:image/png;base64,${saved}`; }
  let drawing = false;
  const point = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  canvas.addEventListener("pointerdown", (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...point(e)); });
  canvas.addEventListener("pointermove", (e) => { if (!drawing) return; g.lineTo(...point(e)); g.stroke(); });
  canvas.addEventListener("pointerup", () => { if (!drawing) return; drawing = false; onStroke(signatureBase64(canvas)); });
};

const form = (ctx: ScreenContext, job: FieldJobWire, d: Draft): VNode => {
  const w = ctx.wrapUps;
  const edit = (patch: Partial<Draft>) => w.edit(job.id, patch);
  const min = d.outcome === "quote_needed" ? QUOTE_MIN_PHOTOS : WRAP_UP_MIN_PHOTOS;
  const missing = missingFor(d);
  const addPhotos = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) await w.addShot(job.id, "photo", await photoBase64(file));
    input.value = "";
  };
  const submit = () => {
    if (w.submit(job.id).length) return;
    // The job's own time clock stops with the job, as it does on any finish.
    const since = ctx.clock.value[job.id];
    if (since) {
      ctx.queue.enqueue("time_entries", job.id, "insert", { crew_id: ctx.crew.id, start: since, end: new Date().toISOString(), kind: "labor" }, null);
      const rest = { ...ctx.clock.value };
      delete (rest as Record<string, string>)[job.id];
      ctx.clock.value = rest;
      flushQueue(ctx);
    }
    ctx.router.navigate("jobs", {});
  };
  const clearPad = () => {
    const pad = typeof document === "undefined" ? null : document.getElementById("signature-pad") as HTMLCanvasElement | null;
    pad?.getContext("2d")?.clearRect(0, 0, pad.width, pad.height);
    void w.clearSignature(job.id);
  };
  for (const p of d.photos) w.preview(p.id);
  if (d.signature) w.preview(d.signature.id);

  return html`<section class="s5-wrap">
    ${pageHead(`Wrap up — ${job.site?.name ?? serviceLabel(job.serviceCode)}`, addressLine(job.site?.address ?? null) || "Photos, notes and the customer's signature. Everything here is saved on this device until it is sent.")}

    ${panel(html`<div class="ac-seg s5-outcome" role="radiogroup" aria-label="How the visit closes">
        ${(["complete", "quote_needed"] as const).map((o) => html`<button type="button" role="radio" class="ac-seg__item s5-outcome__opt" id=${`outcome-${o}`}
          aria-checked=${d.outcome === o ? "true" : "false"} data-current=${d.outcome === o ? "true" : "false"} onClick=${() => edit({ outcome: o })}>${o === "complete" ? "Complete" : "Quote needed"}</button>`)}
      </div>
      ${d.outcome === "quote_needed" ? html`<p class="s5-muted">The visit completes and the office opens a quote job from it: ${QUOTE_MIN_PHOTOS} photos and the unit's measurements are needed.</p>` : null}`, "Outcome")}

    ${panel(html`<ul class="s5-shots">
        ${d.photos.map((p, i) => html`<li class="s5-shot" key=${p.id}>
          ${w.previews.value[p.id] ? html`<img src=${`data:image/jpeg;base64,${w.previews.value[p.id]}`} alt=${`Photo ${i + 1}`} />` : html`<span class="s5-muted">Photo ${i + 1}</span>`}
          <button type="button" class="s5-shot__remove" id=${`remove-${p.id}`} aria-label=${`Remove photo ${i + 1}`} onClick=${() => void w.removePhoto(job.id, p.id)}>✕</button>
        </li>`)}
        <li class="s5-shot s5-shot--add">
          <label class="s5-shot__take"><input type="file" accept="image/*" capture="environment" multiple class="s5-hidden-input" id="add-photo" onChange=${(e: Event) => void addPhotos(e)} />Add photo</label>
        </li>
      </ul>`, `Photos — ${d.photos.length} of ${min}`)}

    ${panel(html`<label class="ac-field"><span>Notes for the office</span>
      <textarea class="ac-input s5-notes" id="notes" rows="4" maxlength="4000" onInput=${(e: Event) => edit({ notes: (e.currentTarget as HTMLTextAreaElement).value })}>${d.notes}</textarea></label>`, "Completion notes")}

    ${d.outcome === "quote_needed" ? panel(html`<div class="ac-form ac-form--inline">
      ${FIELDS.map((f) => {
        const value = d.measurements[f.key] ?? "";
        const set = (e: Event) => edit({ measurements: { ...d.measurements, [f.key]: (e.currentTarget as HTMLInputElement).value } });
        return html`<label class="ac-field" key=${f.key}><span>${f.label}</span>${
          f.kind === "voltage" || f.kind === "fuel"
            ? html`<select class="ac-input" id=${`m-${f.key}`} value=${value} onChange=${set}>
                <option value="">Choose…</option>
                ${(f.kind === "voltage" ? RTU_VOLTAGES : RTU_FUELS).map((o) => html`<option value=${o}>${f.kind === "fuel" ? FUEL_LABEL[o] : o}</option>`)}
              </select>`
            : html`<input class="ac-input" id=${`m-${f.key}`} type=${f.kind === "number" ? "number" : "text"} inputmode=${f.kind === "number" ? "decimal" : undefined} step=${f.step} value=${value} onInput=${set} />`
        }</label>`;
      })}
    </div>`, "Unit measurements") : null}

    ${panel(html`${d.absent ? null : html`<canvas class="s5-pad" id="signature-pad" aria-label="Customer signs here with a finger"
          ref=${signaturePad(d.signature ? w.previews.value[d.signature.id] : undefined, (png) => void w.addShot(job.id, "signature", png))}></canvas>
        ${d.signature ? html`<div class="s5-signed"><span class="s5-check__done"><span aria-hidden="true">■</span> Signed</span>
          ${PrimaryAction({ density: ctx.density, label: "Clear", id: "signature-clear", kind: "quiet", onClick: clearPad })}</div>` : null}`}
      <label class="s5-absent"><input type="checkbox" id="absent" checked=${d.absent} onChange=${(e: Event) => edit({ absent: (e.currentTarget as HTMLInputElement).checked })} /> No one on site to sign</label>
      ${d.absent ? html`<label class="ac-field"><span>Why no one could sign</span><input class="ac-input" id="absent-reason" maxlength="500" value=${d.absentReason} onInput=${(e: Event) => edit({ absentReason: (e.currentTarget as HTMLInputElement).value })} /></label>` : null}`,
      "Customer signature")}

    <div class="s5-submit">${PrimaryAction({
      density: ctx.density, label: "Submit & complete job", id: "submit-wrap-up", onClick: submit,
      ...(missing.length ? { disabledReason: `Still needed: ${missing.join(" · ")}.` } : {}),
    })}</div>
  </section>`;
};

export const wrapUp: Screen = (ctx, params) => {
  const jobId = params.jobId!;
  const jobs = ctx.store.read(keyOf("jobs.mine"), () => ctx.shell.gateway.myJobs());
  return whenReady(ctx, jobs.value, (out) => {
    const job = out.jobs.find((j) => j.id === jobId);
    if (!job) return html`<p class="s5-empty">Job ${jobId} is not on this shift's board.</p>`;
    if (ctx.wrapUps.pendingFor(job.id)) return html`<p class="s5-empty" role="status">This job is wrapped up and waiting to be sent.</p>`;
    if (projectedJob(job, ctx.queue.pending.value).state !== "in_progress") return html`<p class="s5-empty">A job is wrapped up while it is in progress.</p>`;
    return form(ctx, job, ctx.wrapUps.draftFor(job.id));
  });
};
