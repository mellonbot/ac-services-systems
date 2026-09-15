import type { Transport, StreamState } from "../../sdk/src/runtime.ts";
import { GatewayRefusal } from "../../contracts/src/refusals.ts";
import type { DegradedState } from "./internal.ts";

/**
 * The shell's view of the wire. Not on the package's exports map.
 *
 * Wraps any Transport so that the degraded flag is driven by what actually
 * happened on the wire and by nothing a surface can call:
 *   - a `transport` refusal (no answer, or 5xx) sets it;
 *   - any answer at all — including a 403 or a 422 — clears it, because a
 *     gateway that refuses you is a gateway that is up;
 *   - an SSE stream opening clears it; a stream failing sets it.
 *
 * This is the whole of "declared degraded mode per surface" made mechanical:
 * the surface declares the mode (in SURFACES), the shell carries the flag,
 * and only this file writes it.
 */
export const guardedTransport = (inner: Transport, state: DegradedState): Transport => ({
  request: async (op, input) => {
    try {
      const out = await inner.request(op, input);
      state.degraded = false;
      return out;
    } catch (e) {
      if (e instanceof GatewayRefusal) state.degraded = e.refusal.kind === "transport";
      throw e;
    }
  },
  stream: (op, onEvent, onState) =>
    inner.stream(op, onEvent, (s: StreamState) => {
      if (s === "open") state.degraded = false;
      if (s === "failed") state.degraded = true;
      onState(s);
    }),
});

/** A transport for a shell that has none: every call is a transport refusal, so the flag goes up and the surface renders its degraded mode. */
export const unconnectedTransport = (): Transport => ({
  request: async () => { throw new GatewayRefusal({ kind: "transport", status: null, message: "shell has no transport — boot it with connectShell()" }); },
  stream: (_op, _onEvent, onState) => { onState("failed"); return () => {}; },
});
