import { html, mount, spinFavicon, signal, createRouter, browserHistory, driveDegraded, type VNode } from "../../../packages/ui/src/index.ts";
import { gatewayOrigin, type AnonymousShell } from "../../../packages/shell/src/index.ts";
export { gatewayOrigin };
import { densityOf, SURFACES, SURFACE_PATHS, type Refusal, type SignInInput, type SurfaceId } from "../../../packages/contracts/src/index.ts";
import { SURFACE, open } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import type { DoorState, Screen, ScreenContext } from "./screens/common.ts";
import { home } from "./screens/home.ts";
import { missing } from "./screens/missing.ts";
import { S1_CSS } from "./styles.ts";

/**
 * S1 — THE FRONT DOOR. The page everyone starts at.
 *
 * A person signs in once, here; `auth.signIn` checks the credential, works out
 * which surface the login belongs to, mints THAT surface's session as the
 * httpOnly cookie, and answers with its path. The browser goes there and the
 * surface resumes the cookie session it finds (`session.me`), exactly as it
 * does after a reload. When a login opens several surfaces the gateway says
 * so instead, with no session minted, and the person picks one.
 *
 * Still no await before the first render: "the page renders with no gateway
 * call" (SURFACES.S1.degraded). Signing in needs the gateway; reading the page
 * does not.
 */
export const DENSITY = densityOf("S1");

export const SCREEN_VIEWS: Readonly<Record<ScreenId, Screen>> = { home };

const refusalOf = (e: unknown): Refusal =>
  (e as { refusal?: Refusal })?.refusal ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) };

export const createApp = (opts: {
  baseUrl: string;
  fetch: Parameters<typeof open>[0]["fetch"];
  window?: Window;
  /** Where a signed-in person is sent. The browser's location by default; a test passes a spy. */
  go?: (path: string) => void;
  session?: "bearer" | "cookie";
}) => {
  const degraded = signal(false);
  const shell: AnonymousShell = open({
    baseUrl: opts.baseUrl, fetch: opts.fetch, session: opts.session ?? "cookie",
    ...(opts.window ? { page: opts.window } : {}),
  });
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window, SURFACE_PATHS.S1) : { path: () => "/", push: () => {}, onPop: () => () => {} });
  const door = signal<DoorState>({ step: "form", busy: false, refusal: null, device: false });
  const go = opts.go ?? ((path: string) => opts.window?.location.assign(path));

  // The credentials a choice re-sends. Held in this closure for the one step
  // between "choose" and the pick — never in a signal, never in storage — and
  // dropped the moment the person leaves that step either way.
  let held: { email: string; password: string } | null = null;

  const send = async (input: SignInInput, onRefusal: (refusal: Refusal) => DoorState): Promise<void> => {
    try {
      const out = await shell.gateway.signIn(input);
      if (out.kind === "choose") {
        held = { email: input.email, password: input.password };
        door.value = { step: "choose", busy: false, refusal: null, choices: out.choices };
        return;
      }
      held = null;
      door.value = { step: "going", path: out.path, name: SURFACES[out.surface].name };
      go(out.path);
    } catch (e) {
      door.value = onRefusal(refusalOf(e));
    }
  };

  const signIn: ScreenContext["signIn"] = (form) => {
    const d = door.value;
    if (d.step !== "form" || d.busy) return;
    held = null;
    door.value = { ...d, busy: true, refusal: null };
    void send(
      { email: form.email.trim(), password: form.password, ...(form.hardwareId ? { hardwareId: form.hardwareId } : {}) },
      // The box as it stands when the answer comes back — the person may have ticked it while they waited.
      (refusal) => ({ step: "form", busy: false, refusal, device: door.value.step === "form" ? door.value.device : d.device }),
    );
  };

  const choose = (surface: SurfaceId): void => {
    const d = door.value;
    if (d.step !== "choose" || d.busy || !held) return;
    door.value = { ...d, busy: true, refusal: null };
    void send({ ...held, surface }, (refusal) => ({ ...d, busy: false, refusal }));
  };

  const setDevice = (on: boolean): void => {
    const d = door.value;
    if (d.step === "form") door.value = { ...d, device: on, refusal: null };
  };

  const startOver = (): void => {
    held = null;
    door.value = { step: "form", busy: false, refusal: null, device: false };
  };

  const tick = () => { degraded.value = shell.isDegraded(); };

  const view = (): VNode => {
    const ctx: ScreenContext = { shell, router, density: DENSITY, degraded: degraded.value, door: door.value, signIn, choose, setDevice, startOver };
    const loc = router.current.value;
    const screen = loc ? SCREEN_VIEWS[loc.screen] : null;
    return html`<div class="s1-app">
      ${screen ? screen(ctx, loc!.params) : missing(ctx, opts.window?.location.pathname ?? "/")}
    </div>`;
  };

  return { shell, router, degraded, door, view, signIn, choose, setDevice, startOver, tick };
};

// ---------------------------------------------------------------------------
// Browser entry. Guarded so the module is importable under node --test.
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && document.getElementById("mount")) {
  const style = document.createElement("style");
  style.textContent = S1_CSS;
  document.head.appendChild(style);

  const app = createApp({ baseUrl: gatewayOrigin(document), fetch: globalThis.fetch.bind(globalThis), window });
  const el = document.getElementById("mount")!;
  const slot = document.querySelector("ac-degraded") as (HTMLElement | null);
  const Root = () => app.view();
  mount(html`<${Root} />`, el);
  spinFavicon(document);
  const degradedTick = slot ? driveDegraded(slot, () => ({ degraded: app.degraded.value, text: SURFACE.degradedNotice, lastOkAt: null }), Date.now) : () => {};
  app.router.start();
  setInterval(() => { app.tick(); degradedTick(); }, 1000);
}
