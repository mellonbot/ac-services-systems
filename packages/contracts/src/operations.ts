/**
 * THE OPERATION CATALOGUE.
 *
 * Every request a surface may make of the gateway, as data. The gateway's
 * route table is built from this constant and nothing else; the SDK client is
 * generated from it (tools/ci/emit-sdk.ts); the guard fails the build if the
 * two disagree or the generated client has drifted.
 *
 * That is the whole mechanism behind master plan non-negotiable #14 — "no
 * surface writes its own fetch call". Before this file existed the sentence
 * was enforced by nothing: `packages/sdk` was a type with a header promising a
 * generator that did not exist. A surface could invent a request the gateway
 * never agreed to serve, and a surface could be pointed at a second origin.
 * Now a request that is not a row here has no method on the client and no
 * route at the gateway — the same move the term register made for terms and
 * the surface registry made for writes.
 *
 * What a row declares:
 *   - `method` + `path`: the wire. Paths are literal; no path parameters, so
 *     the gateway's lookup is a Map hit and a typo is a 404 in the smoke test.
 *   - `kind`: `query` opens a read-only transaction; `mutation` opens a unit of
 *     work; `stream` is the SSE feed; `login` and `system` run unscoped.
 *   - `auth`: `bearer` requires a verified token; `none` does not.
 *   - `surfaces`: which surfaces may call it. The client sends `x-ac-surface`;
 *     the gateway refuses a surface not on the list (403) and then opens the
 *     unit of work FOR THAT SURFACE, so the write allowlist and role admission
 *     in SURFACES apply. The header selects; the token authorizes. A surface
 *     that lies about its id gains a surface whose roles its token lacks.
 *   - `carrier`: where the input travels — JSON body, query string, or nowhere.
 *   - `sdkMethod`: the generated client's method name. Stable; renaming one is
 *     a breaking change for every surface, which is the point of naming it here.
 *
 * The wire shapes live on each row. `OperationIO` is derived from them, so
 * there is no second map to keep in step with the catalogue.
 */
import type { SurfaceId } from "./surfaces.ts";
import { OPERATIONS as CATALOGUE } from "./operations/catalogue.ts";

export type { OperationKind, OperationAuth, InputCarrier } from "./operations/define.ts";
export * from "./operations/wire.ts";

export const OPERATIONS = CATALOGUE;
export type OperationId = keyof typeof OPERATIONS;
export type Operation = (typeof OPERATIONS)[OperationId];
export const OPERATION_IDS = Object.freeze(Object.keys(OPERATIONS)) as readonly OperationId[];

type IoOf<T> = T extends { readonly _io: { readonly input: infer I; readonly output: infer O } } ? { readonly input: I; readonly output: O } : never;
export type OperationIO = { [K in OperationId]: IoOf<(typeof OPERATIONS)[K]> };

/** A row written without `op<Input, Output>()` makes this alias fail: the missing id does not extend `never`. */
type _MissingIo = { [K in OperationId]: (typeof OPERATIONS)[K] extends { readonly _io: unknown } ? never : K }[OperationId];
type _AssertNone<T extends never> = T;
export type _EveryOperationCarriesIo = _AssertNone<_MissingIo>;

/**
 * The mutations that write the caller's own session or users row and nothing
 * of the business's: ending a session, and the Account button (0033).
 * A company message is the other thing a read-only surface (S4) may call.
 */
export const OWN_IDENTITY_MUTATIONS: readonly OperationId[] = ["auth.logout", "account.update", "account.setAvatar", "account.changePassword"];

/**
 * A message between company people. Not a write of a job, a crew, a contract
 * or money, so the read-only dashboard (S4) may send and dismiss one. The
 * copies are the gateway's, the way the Account button's row is.
 */
export const STAFF_MESSAGE_MUTATIONS: readonly OperationId[] = ["messages.send", "messages.dismiss"];

export const isOperationId = (s: string): s is OperationId => Object.hasOwn(OPERATIONS, s);

/** `METHOD /path` → operation. The gateway's dispatcher and the generator both index by this. */
export const routeKey = (op: Pick<Operation, "method" | "path">): string => `${op.method} ${op.path}`;

/** Which of an operation's surfaces a principal of this namespace may call it as. */
export const surfacesFor = (
  id: OperationId,
  namespaceOf: (s: SurfaceId) => string,
  namespace: string,
): readonly SurfaceId[] => OPERATIONS[id].surfaces.filter((s) => namespaceOf(s) === namespace);
