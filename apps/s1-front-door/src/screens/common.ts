import { html, RefusalNotice, type VNode, type Router } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf, SignInDestination, SurfaceId } from "../../../../packages/contracts/src/index.ts";
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
