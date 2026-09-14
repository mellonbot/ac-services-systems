/**
 * GENERATED from packages/contracts. Never hand-written.
 *
 * The point is not convenience. It is that no surface writes its own fetch
 * call, so there is no place for a surface to invent a request the gateway did
 * not agree to serve — and no surface that can be pointed at a second origin.
 *
 * `pnpm sdk:generate` regenerates src/generated/. CI fails if it drifts.
 */
export type { SurfaceId, Principal, WriteEntity } from "@ac/contracts";

export type GatewayClient = {
  query<T>(operation: string, input: Readonly<Record<string, unknown>>): Promise<T>;
  mutate<T>(operation: string, input: Readonly<Record<string, unknown>>): Promise<T>;
  subscribe(topic: string, handler: (event: unknown) => void): () => void;
};
