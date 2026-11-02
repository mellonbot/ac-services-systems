import { html, PrimaryAction, type VNode } from "../../../../packages/ui/src/index.ts";
import { BRAND } from "../../../../packages/tokens/src/brand.ts";
import { refusalView, type DoorState, type Screen, type ScreenContext } from "./common.ts";

/** The site's name, as the visitor reads it in the heading and the tab. */
export const SITE_TITLE = `${BRAND.works.firm} — Service System`;

let stopScene: (() => void) | undefined;

/**
 * The yard's canvas, mounted and unmounted. Module-level so preact sees the
 * same ref on every render and calls it only when the canvas comes or goes;
 * three.js loads in its own chunk, after the page has rendered.
 */
const sceneRef = (canvas: HTMLCanvasElement | null): void => {
  stopScene?.();
  stopScene = undefined;
  if (!canvas) return;
  let stopped = false;
  stopScene = () => { stopped = true; };
  void import("../scene.ts").then(({ mountScene }) => {
    if (!stopped) stopScene = mountScene(canvas);
  });
};

/**
 * THE FRONT DOOR. One form for everyone — staff, dispatch, technicians,
 * customers, firms — and the gateway, not this page, decides where each
 * person belongs (`auth.signIn`). The page never lists the portals for a
 * person to pick from before they have signed in: which ones a login may open
 * is the gateway's answer, and a list here would be a second answer that
 * could disagree with it.
 *
 * It still makes no promise. The copy ceiling (OPEN-S1-CEILING) holds: no
 * response time, no availability figure, no guarantee — app.test.ts and
 * drive-s1.ts fail a page that says one.
 */
export const home: Screen = (ctx: ScreenContext): VNode => {
  const d = ctx.door;
  return html`<section class="s1-home">
    <h1 class="s1-h1 s1-sr-only">${SITE_TITLE}</h1>
    <div class="s1-door">
      <div class="s1-door__panel">
        ${d.step === "choose" ? chooser(ctx, d) : d.step === "going" ? going(d) : signInForm(ctx, d)}
      </div>
      <div class="s1-scene">
        <div class="s1-scene__stage" role="img" aria-label="AC Services service truck, Unit TACLA-14402C, in the service yard"><canvas ref=${sceneRef}></canvas></div>
      </div>
    </div>
  </section>`;
};

const signInForm = (ctx: ScreenContext, d: Extract<DoorState, { step: "form" }>): VNode => {
  const onSubmit = (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const hardwareId = String(f.get("hardwareId") ?? "").trim();
    ctx.signIn({
      email: String(f.get("email") ?? ""),
      password: String(f.get("password") ?? ""),
      ...(d.device && hardwareId ? { hardwareId } : {}),
    });
  };
  return html`
    <h2 class="s1-h2 s1-welcome" id="door-title">Sign in</h2>
    <p class="s1-lede">One sign-in for everyone. We take you to your own workspace.</p>
    <form class="ac-form" id="sign-in-form" aria-labelledby="door-title" onSubmit=${onSubmit}>
      <label class="ac-field"><span>Email</span><input class="ac-input" id="email" name="email" type="email" required autocomplete="username" /></label>
      <label class="ac-field"><span>Password</span><input class="ac-input" id="password" name="password" type="password" required autocomplete="current-password" /></label>
      <label class="s1-check"><input type="checkbox" id="field-device" checked=${d.device} onChange=${(e: Event) => ctx.setDevice((e.currentTarget as HTMLInputElement).checked)} /> <span>Signing in on a field device</span></label>
      ${d.device
        ? html`<label class="ac-field"><span>Device ID</span><input class="ac-input s1-instrument" id="hardware-id" name="hardwareId" required autocomplete="off" spellcheck=${false} /></label>`
        : null}
      ${PrimaryAction({ density: ctx.density, label: d.busy ? "Signing in…" : "Sign in", type: "submit", id: "sign-in" })}
    </form>
    ${d.refusal ? refusalView(ctx, d.refusal) : null}`;
};

const chooser = (ctx: ScreenContext, d: Extract<DoorState, { step: "choose" }>): VNode => html`
  <h2 class="s1-h2 s1-welcome" id="door-title">Where to?</h2>
  <p class="s1-lede">Your sign-in opens more than one workspace. Choose one — you can sign in here again for another.</p>
  <ul class="s1-choices" aria-labelledby="door-title">
    ${d.choices.map((c) => html`<li>
      <button type="button" class="s1-portal" id=${`go-${c.surface}`} disabled=${d.busy} onClick=${() => ctx.choose(c.surface)}>
        <strong>${c.name}</strong>
        <span>${c.path}</span>
      </button>
    </li>`)}
  </ul>
  ${d.refusal ? refusalView(ctx, d.refusal) : null}
  <p><button type="button" class="ac-link ac-link--button" id="start-over" onClick=${ctx.startOver}>Use a different sign-in</button></p>`;

const going = (d: Extract<DoorState, { step: "going" }>): VNode => html`
  <h2 class="s1-h2 s1-welcome" id="door-title">Signed in</h2>
  <p class="s1-lede" role="status" id="going">Opening ${d.name}…</p>
  <p><a class="ac-link" href=${d.path}>Continue to ${d.name}</a></p>`;
