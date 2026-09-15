/**
 * THE GENERATED GATEWAY SDK.
 *
 * `src/generated/client.ts` is emitted from the operation catalogue
 * (`packages/contracts/src/operations.ts`) by `tools/ci/emit-sdk.ts`; the
 * schema guard fails the build if it has drifted. `src/runtime.ts` is the one
 * hand-written file, and the one place in the surface layer that calls fetch.
 *
 * The point is not convenience. It is that no surface writes its own fetch
 * call, so there is no place for a surface to invent a request the gateway did
 * not agree to serve — and no surface that can be pointed at a second origin,
 * because the transport is built by the shell with the gateway's URL and no
 * client method takes one.
 *
 *   npm run sdk:generate      regenerate
 *   node tools/ci/emit-sdk.ts --check   what the guard runs
 */
export type { SurfaceId, Principal, WriteEntity, OperationId, OperationIO, HierarchyContext, DomainEvent, Refusal } from "../../contracts/src/index.ts";
export { GatewayRefusal } from "../../contracts/src/refusals.ts";
export { createGatewayClient, GENERATED_METHODS, type GatewayClient } from "./generated/client.ts";
export { httpTransport, type Transport, type FetchLike, type HttpTransportConfig, type StreamState } from "./runtime.ts";
