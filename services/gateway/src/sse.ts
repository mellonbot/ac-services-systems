import type { ServerResponse } from "node:http";
import type { SurfaceId } from "../../../packages/contracts/src/surfaces.ts";

/** Sentinel: the handler owns the response and the dispatcher must not write one. */
export const STREAMING = Symbol("streaming");

export const SSE_SESSION_RECHECK_MS = 60_000;
export const SSE_STREAMS_PER_SESSION = 4;
/** Past this much unsent, a subscriber is not reading: it is closed rather than buffered for without end. */
export const SSE_MAX_BUFFERED_BYTES = 256 * 1024;

export type CrewAudience = { readonly orgId: string | null; readonly firmId: string | null; readonly crewId: string | null };
export type SseClient = {
  res: ServerResponse;
  regionId: string;
  orgScoped: boolean;
  internal: boolean;
  orgId: string | null;
  crew: CrewAudience | null;
  surfaceId: SurfaceId;
  sessionId: string;
};

export const sseClients = new Set<SseClient>();

export const push = (c: SseClient, frame: string): void => {
  if (c.res.writableLength > SSE_MAX_BUFFERED_BYTES) { sseClients.delete(c); c.res.destroy(); return; }
  c.res.write(frame);
};
