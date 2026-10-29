import type { SurfaceId } from "../surfaces.ts";

export type OperationKind = "login" | "query" | "mutation" | "stream" | "system";
export type OperationAuth = "none" | "bearer";
export type InputCarrier = "body" | "query" | "none";

export type OperationSpec = {
  readonly id: string;
  readonly method: "GET" | "POST";
  readonly path: `/${string}`;
  readonly kind: OperationKind;
  readonly auth: OperationAuth;
  readonly surfaces: readonly SurfaceId[];
  readonly carrier: InputCarrier;
  readonly sdkMethod: string;
  readonly summary: string;
};

export const AUTHENTICATED: readonly SurfaceId[] = ["S2", "S3", "S4", "S5", "S6", "S7", "S8"];
/**
 * Surfaces whose principals hold a password at OUR gateway. Devices carry a
 * shift grant; S1 is anonymous.
 *
 * S6 joined this list with item 6 (2026-09-17) as the PHASE 1 DOOR. The
 * registry says "customer IdP + tier claim", and that stays the destination:
 * federation replaces the credential check inside `auth.login` and nothing
 * else — the claims it mints (namespace, org, scope tier, scope node) are the
 * same either way, and everything downstream of the token (RLS, the context
 * walk, the tier scoping the acceptance test measures) is proven against those
 * claims, not against how the password was checked. Building the federation
 * needs a customer's IdP to test against, which is a conversation with
 * Amped's IT, not a diff here; docs/OPEN_DECISIONS.md carries it as OPEN-S6-IDP.
 */
export const PASSWORD_LOGIN: readonly SurfaceId[] = ["S2", "S3", "S4", "S6", "S7", "S8"];
/** The company's own people: service manager, dispatch, HQ, the technician. Not a customer, a vendor, or a firm. */
export const COMPANY: readonly SurfaceId[] = ["S2", "S3", "S4", "S5"];

/**
 * Attaches the wire types to a catalogue row. `_io` is a type witness only:
 * the value returned is the spec, and `OperationIO` is read off the witness
 * so the catalogue and the wire shapes cannot be listed twice.
 */
type Tagged<S, I, O> = S & { readonly _io: { readonly input: I; readonly output: O } };
export const op = <I, O>() => <const S extends OperationSpec>(spec: S): Tagged<S, I, O> => spec as Tagged<S, I, O>;
