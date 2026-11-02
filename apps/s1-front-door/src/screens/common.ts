import { html, RefusalNotice, type VNode, type Router } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import { SURFACE_PATHS, type Refusal, type DensityOf, type SignInDestination, type SurfaceId } from "../../../../packages/contracts/src/index.ts";
import type { SCREENS } from "../screens.ts";
export { linkTo } from "../../../../packages/ui/src/screen-helpers.ts";

/**
 * Where the front door is in one person's sign-in.
 *   form    the sign-in form; `device` shows the device ID field
 *   choose  the login opens several surfaces; the person picks one
 *   going   a session was minted; the browser is on its way to `path`
 */
export type DoorState =
  | { readonly step: "form"; readonly busy: boolean; readonly refusal: Refusal | null; readonly device: boolean }
  | { readonly step: "choose"; readonly busy: boolean; readonly refusal: Refusal | null; readonly choices: readonly SignInDestination[] }
  | { readonly step: "going"; readonly path: string; readonly name: string };

export type SignInForm = { readonly email: string; readonly password: string; readonly hardwareId?: string };

/** What every S1 screen receives. A screen is a function of this and its route params — nothing else. */
export type ScreenContext = {
  readonly shell: Shell;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S1">;
  readonly degraded: boolean;
  /** The device has no network: the form is not offered. */
  readonly offline: boolean;
  /** This tab holds a front-door shift S5 can open with no network. */
  readonly heldShift: boolean;
  readonly door: DoorState;
  readonly signIn: (form: SignInForm) => void;
  readonly choose: (surface: SurfaceId) => void;
  readonly setDevice: (on: boolean) => void;
  readonly startOver: () => void;
};

export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

/**
 * A refusal, as a person who has not signed in reads it. NOT RefusalCard —
 * that component is console-only by spec. The gateway's own message, under
 * the shared heading.
 */
export const refusalView = (ctx: ScreenContext, refusal: Refusal): VNode =>
  RefusalNotice({ density: ctx.density, refusal, routes: [] }) ?? html``;

/** Where a held shift is opened. */
export const S5_PATH = `${SURFACE_PATHS.S5}/`;

export const NO_SIGNAL = "Signing in needs a connection, and this tab holds no shift to open offline. Sign in when you are back in signal.";

/** The offline refusal: what happened, and when it will work. */
export const offlineView = (ctx: ScreenContext): VNode =>
  RefusalNotice({ density: ctx.density, refusal: { kind: "transport", status: null, message: NO_SIGNAL }, message: NO_SIGNAL, routes: [] }) ?? html``;
