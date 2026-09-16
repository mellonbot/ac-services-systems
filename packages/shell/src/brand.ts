import { SURFACES, type SurfaceId } from "../../contracts/src/index.ts";
import { createGatewayClient } from "../../sdk/src/generated/client.ts";
import { httpTransport, type FetchLike } from "../../sdk/src/runtime.ts";

/**
 * S0 — WHITE-LABEL, ON THE SURFACE SIDE.
 *
 * This runs BEFORE login, which is the whole reason it is not part of
 * `connectShell`: a customer portal is branded on its SIGN-IN screen, and a
 * portal that puts on the tenant's colours only after a successful password is
 * a portal that looks like someone else's until you are already inside it.
 *
 * The order the frame is emitted in does the rest (tools/ci/emit-surfaces.ts):
 * Rankine's plate is inline in the document, the tenant's block is an empty
 * `<style id="ac-brand">` after it. So nothing here has to succeed. An
 * unreachable gateway, an unknown host, a tenant with no theme — all of them
 * leave the page in our own livery, which is the right answer to every one of
 * them and is never an unstyled page.
 */

/** What `applyBrand` writes into. The element's shape, not a DOM type, so this runs under `node --test` — the same trick `applyDegraded` uses. */
export type BrandSlot = { textContent: string | null };

/**
 * Install a tenant's block. The css is already scoped by packages/tokens
 * TENANT_SCOPE, so it cannot reach the field frame whatever is done with it
 * here; this function's job is only to put it after the plate, never to decide
 * what it may repaint.
 */
export const applyBrand = (slot: BrandSlot, css: string): void => {
  slot.textContent = css;
};

export type BrandConfig = {
  readonly surfaceId: SurfaceId;
  /** The gateway's origin. As everywhere in the surface layer, named by the shell and never by a surface. */
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  /** The host to ask about. `location.hostname` in a browser; the gateway falls back to the request's own Host header when this is omitted. */
  readonly host?: string;
};

export type BrandResult = {
  /** False when the host has no theme, OR when the gateway did not answer. Either way the page keeps Rankine's plate. */
  readonly tenant: boolean;
  readonly css: string;
  /** Why a theme was not installed, for a console line. Never thrown: branding must not be able to block a boot. */
  readonly unreachable?: boolean;
};

/**
 * Ask the gateway what this host looks like.
 *
 * Unauthenticated by construction: the transport is built with `token: () =>
 * null` and the operation is `auth: "none"`. It is not the shell's live
 * transport and it does not touch the degraded flag — a portal whose branding
 * could not load is not a degraded portal, it is a portal.
 */
export const fetchBrand = (cfg: BrandConfig): Promise<BrandResult> => {
  // Synchronously, before the async boundary. Asking for a theme on a surface
  // no tenant may repaint is a programming error, and a rejected promise is a
  // programming error a stray .catch() can swallow.
  if (!SURFACES[cfg.surfaceId].whiteLabel) {
    throw new Error(
      `${cfg.surfaceId} (${SURFACES[cfg.surfaceId].name}) is not white-label. ` +
      `whiteLabel is declared in packages/contracts/src/surfaces.ts, the gateway serves brand.theme to ` +
      `exactly those surfaces, and the frame emitter gives exactly those a brand slot — so this call would ` +
      `be refused at the gateway and have nowhere to land if it were not.`,
    );
  }
  return ask(cfg);
};

const ask = async (cfg: BrandConfig): Promise<BrandResult> => {
  const client = createGatewayClient(httpTransport({
    baseUrl: cfg.baseUrl, surfaceId: cfg.surfaceId, fetch: cfg.fetch, token: () => null,
  }));
  try {
    const out = await client.brandTheme(cfg.host === undefined ? {} : { host: cfg.host });
    return { tenant: out.tenant, css: out.css };
  } catch {
    // Deliberately swallowed, and the only place in the shell that swallows one.
    // The fallback is correct rather than merely safe: the page is already
    // wearing the plate this would have overridden.
    return { tenant: false, css: "", unreachable: true };
  }
};

/**
 * The whole thing, for a surface's `main.ts`: ask, and fill the slot if there
 * was an answer. Returns what happened so a surface can log it; a surface that
 * ignores the return value still behaves correctly.
 */
export const installBrand = async (cfg: BrandConfig, slot: BrandSlot | null): Promise<BrandResult> => {
  const result = await fetchBrand(cfg);
  if (result.tenant && slot) applyBrand(slot, result.css);
  return result;
};
