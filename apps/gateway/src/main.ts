import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { beginTx, bindSystem, listenEvents } from "./pg-tx.ts";
import { AuthError } from "./auth.ts";
import { ScopeResolutionError } from "./context.ts";
import { SurfaceWriteDenied, TenancyMismatch, SurfaceDisabled, RoleDenied } from "./unit-of-work.ts";
import { InputRefused, BadInput, dbRefusal } from "./refusals.ts";
import { cors, applyHeaders } from "./session.ts";
import { HttpError } from "./http.ts";
import { ANONYMOUS_BY_ADDRESS, DATABASE_URL, LOGIN_BY_ADDRESS, ORIGINS, addressOf, pool, throttled } from "./env.ts";
import { callerOf } from "./open-tx.ts";
import { handlers } from "./routes.ts";
import { STREAMING, push, sseClients, type SseClient } from "./sse.ts";
import { AdmissionRefused } from "../../../packages/domain/src/inheritance/admit.ts";
import { ResolutionError } from "../../../packages/domain/src/inheritance/resolve.ts";
import { SURFACES } from "../../../packages/contracts/src/surfaces.ts";
import { OPERATIONS, OPERATION_IDS, PHOTO_MAX_BYTES, routeKey, type OperationId, type OperationIO } from "../../../packages/contracts/src/operations.ts";
import type { MissingTerm } from "../../../packages/contracts/src/refusals.ts";

/**
 * THE GATEWAY — B3. The sole access path.
 *
 * Every route: verify token → principal → open a transaction for the declared
 * surface → handler → commit or roll back. The handler never sees a
 * connection; it sees a Tx that is already scope-bound. The route table is
 * `handlers` in routes.ts, typed over OperationId, so a catalogue row without
 * a handler fails typecheck and a handler without a row cannot be keyed.
 * tools/ci/schema-guard.ts checks the same parity textually with no install.
 * The generated SDK is emitted from the same catalogue. There is no route
 * that is not an operation, and no operation a surface can call that is not
 * a route.
 *
 * Phase 1 transport is plain node:http + JSON, and SSE for the event stream.
 * A framework would add nothing the frame needs and one more place a
 * middleware could be forgotten.
 */
const PORT = Number(process.env.PORT ?? 8080);

type Json = Record<string, unknown>;
/**
 * The most a request body may be, by who can send it. A photo is the largest
 * thing an operation carries — PHOTO_MAX_BYTES as base64 plus its envelope —
 * and only the photo upload is given that. A signed-in request (a sync batch
 * is the largest) gets a megabyte; a door anyone can knock on — sign-in, the
 * anonymous mint, a lead — gets 64 KB, so a stranger cannot make the gateway
 * hold fourteen megabytes per request.
 */
const PHOTO_BODY_BYTES = Math.ceil(PHOTO_MAX_BYTES / 3) * 4 + 64 * 1024;
const SIGNED_IN_BODY_BYTES = 1024 * 1024;
const OPEN_DOOR_BODY_BYTES = 64 * 1024;
const bodyLimitOf = (opId: OperationId): number =>
  opId === "serviceRequests.attachPhoto" || opId === "jobs.attachMedia" ? PHOTO_BODY_BYTES
    : OPERATIONS[opId].auth === "none" || OPERATIONS[opId].surfaces.every((s) => SURFACES[s].namespace === "anonymous") ? OPEN_DOOR_BODY_BYTES
      : SIGNED_IN_BODY_BYTES;
const readJson = (req: IncomingMessage, limit: number): Promise<Json> =>
  new Promise((resolve, reject) => {
    const tooLarge = () => new HttpError(413, `request body over ${limit} bytes`);
    // Declared too large: refused before a byte is read.
    if (Number(req.headers["content-length"] ?? 0) > limit) { reject(tooLarge()); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (c: Buffer) => {
      size += c.length;
      // Stop reading and holding it; the server closes the connection after the 413 rather than drain the rest.
      if (size > limit) { chunks.length = 0; req.off("data", onData); req.pause(); reject(tooLarge()); return; }
      chunks.push(c);
    };
    req.on("data", onData);
    req.on("end", () => {
      let body: unknown;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch { reject(new HttpError(400, "the request body is not JSON")); return; }
      // Every operation's input is an object; `null`, a number or a list is a malformed request, not a 500.
      if (body === null || typeof body !== "object" || Array.isArray(body)) { reject(new HttpError(400, "the request body must be a JSON object")); return; }
      resolve(body as Json);
    });
    req.on("error", reject);
  });
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.setHeader("content-type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};

/**
 * Every refusal has a status, a name, a code and a message a human can read.
 * 500 is reserved for bugs: the shell treats it as a transport failure and
 * flips the surface degraded, which is the right response to a bug and the
 * wrong response to a refused row — so a refused row must never be a 500.
 */
const describe = (e: unknown): { status: number; name: string; code?: string | undefined; message: string; missingTerm?: MissingTerm | undefined } => {
  const err = e as Error & { code?: string };
  if (e instanceof HttpError) return { status: e.status, name: err.name, message: err.message };
  if (e instanceof BadInput) return { status: 400, name: err.name, message: err.message };
  if (e instanceof AuthError) return { status: 401, name: err.name, code: err.code, message: err.message };
  if (e instanceof SurfaceWriteDenied || e instanceof TenancyMismatch || e instanceof ScopeResolutionError || e instanceof RoleDenied) return { status: 403, name: err.name, message: err.message };
  if (e instanceof SurfaceDisabled) return { status: 404, name: err.name, message: err.message };
  if (e instanceof InputRefused) return { status: 422, name: err.name, code: err.code, message: err.message, missingTerm: e.missingTerm };
  if (e instanceof AdmissionRefused || e instanceof ResolutionError) return { status: 422, name: err.name, code: err.code, message: err.message };
  const db = dbRefusal(e);
  // The caller gets general words for these; what the database said is kept here.
  if (db && (err.code === "23503" || err.code === "23505")) console.warn(`gateway: ${db.name} ${db.code} — ${err.message}${(e as { detail?: string }).detail ? ` — ${(e as { detail?: string }).detail}` : ""}`);
  if (db) return db;
  return { status: 500, name: "InternalError", message: "internal error" };
};

/** `METHOD /path` → operation id. Built from the catalogue; a route not in the catalogue does not exist. */
const ROUTES: ReadonlyMap<string, OperationId> = new Map(OPERATION_IDS.map((id) => [routeKey(OPERATIONS[id]), id]));

/**
 * What is checked before a body is read: the per-address throttle on the doors
 * anyone can knock on, and the token on the routes that take megabytes.
 * Read first, a body is held in memory by a request that was going to be refused.
 */
const beforeBody: Partial<Record<OperationId, (req: IncomingMessage) => void>> = {
  "auth.login": (req) => throttled(LOGIN_BY_ADDRESS.hit(addressOf(req)), "sign-in attempts"),
  "auth.deviceLogin": (req) => throttled(LOGIN_BY_ADDRESS.hit(addressOf(req)), "sign-in attempts"),
  "auth.anonymousSession": (req) => throttled(ANONYMOUS_BY_ADDRESS.hit(addressOf(req)), "visits from this address"),
  "leads.submit": (req) => throttled(ANONYMOUS_BY_ADDRESS.hit(addressOf(req)), "submissions from this address"),
  "callRecords.record": (req) => throttled(ANONYMOUS_BY_ADDRESS.hit(addressOf(req)), "submissions from this address"),
  "serviceRequests.attachPhoto": (req) => { callerOf(req); },
  "jobs.attachMedia": (req) => { callerOf(req); },
};

/** Read an operation's input from where the catalogue says it travels. */
const inputOf = async (req: IncomingMessage, url: URL, opId: OperationId): Promise<unknown> => {
  switch (OPERATIONS[opId].carrier) {
    case "body": {
      // A cross-site <form> can POST text/plain or form-encoded to any of these
      // with no preflight — enctype="text/plain" can even spell a JSON object —
      // and sign the victim's browser into the sender's session. It cannot send
      // application/json without a preflight, which CORS refuses for any origin
      // not in the registry. So a body route takes JSON said as JSON, or nothing.
      const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (type !== "application/json") throw new HttpError(415, "the request body must be sent as content-type: application/json");
      return readJson(req, bodyLimitOf(opId));
    }
    case "query": return Object.fromEntries(url.searchParams.entries());
    case "none": return undefined;
  }
};

/**
 * The crews (and their firms) ever sent to the job an event is about — the
 * job is the entity, or an SLA timer's. This is what a firm or a device can
 * see of another tenant's job (0007, 0028), asked once per event and only
 * when such a subscriber is listening in its region.
 */
const crewsOnJobOf = async (entityId: string): Promise<{ crew_id: string; firm_id: string | null }[]> => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) return [];
  const tx = await beginTx(pool, "ac_gateway");
  try {
    await bindSystem(tx);
    return [...await tx.query<{ crew_id: string; firm_id: string | null }>(
      `SELECT DISTINCT a.crew_id, c.firm_id FROM assignments a JOIN crews c ON c.id = a.crew_id
        WHERE a.job_id = COALESCE((SELECT t.job_id FROM sla_timers t WHERE t.id = $1::uuid), $1::uuid)`, [entityId])];
  } finally { await tx.rollback().catch(() => {}); }
};
// Crew-scoped deliveries wait on a read; chained, so they still go out in the order they came in.
let crewDeliveries: Promise<void> = Promise.resolve();

await listenEvents(DATABASE_URL, (payload) => {
  let env: { eventId: string; topic: string; entityId: string; regionId: string; orgId: string; occurredAt: string };
  // A malformed NOTIFY payload is dropped, not thrown: this runs inside the
  // listener's callback, where a throw takes the gateway down.
  try { env = JSON.parse(payload); } catch { console.error("gateway: dropped a malformed event envelope"); return; }
  // Outside the internal namespace an envelope names nothing: entity, entity
  // id and org are other tenants' facts. The topic is enough to refetch on,
  // and the refetch goes through row security like every other read.
  const blind = `event: domain\ndata: ${JSON.stringify({ eventId: env.eventId, topic: env.topic, regionId: env.regionId, occurredAt: env.occurredAt })}\n\n`;
  const waiting: SseClient[] = [];
  for (const c of sseClients) {
    if (!(c.orgScoped || c.regionId === env.regionId)) continue;
    if (c.orgId && c.orgId !== env.orgId) continue;
    if (c.crew) {
      // A firm's own facts are its own org's; anything else is heard only if one of its crews was sent to the job.
      if (c.crew.orgId && c.crew.orgId === env.orgId) push(c, blind);
      else waiting.push(c);
      continue;
    }
    push(c, c.internal ? `event: domain\ndata: ${payload}\n\n` : blind);
  }
  if (!waiting.length) return;
  crewDeliveries = crewDeliveries.then(async () => {
    const crews = await crewsOnJobOf(env.entityId);
    for (const c of waiting) {
      if (!sseClients.has(c)) continue;
      if (crews.some((r) => (c.crew!.crewId && r.crew_id === c.crew!.crewId) || (c.crew!.firmId && r.firm_id === c.crew!.firmId))) push(c, blind);
    }
  }).catch((e) => { console.warn("gateway: could not decide who hears an event; dropped for crew subscribers —", (e as Error).message); });
});

/** JSON is `unknown`. The catalogue says which input this operation takes; the handler is already that operation's. */
const call = <K extends OperationId>(opId: K, req: IncomingMessage, input: unknown, res: ServerResponse) =>
  handlers[opId](req, input as OperationIO[K]["input"], res);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // CORS first, on every response including refusals and the stream: a browser
  // surface at a listed origin gets the credentialed allow-headers; anyone else
  // gets `Vary: Origin` and nothing, and the browser refuses on its side.
  const c = cors(req, ORIGINS);
  applyHeaders(res, c.headers);
  if (req.method === "OPTIONS") {
    res.writeHead(c.allowed ? 204 : 403);
    return res.end();
  }
  const opId = ROUTES.get(`${req.method} ${url.pathname}`);
  try {
    if (!opId) return send(res, 404, { error: "NoRoute", message: `no route ${req.method} ${url.pathname} — not in the operation catalogue` });
    beforeBody[opId]?.(req);
    const input = await inputOf(req, url, opId);
    const out = await call(opId, req, input, res);
    if (out !== STREAMING) send(res, 200, out);
  } catch (e) {
    const d = describe(e);
    if (d.status === 500) console.error(e);
    // An oversized body is not drained: answer, then close the connection under it.
    if (d.status === 413) { res.setHeader("connection", "close"); res.once("finish", () => req.destroy()); }
    send(res, d.status, { error: d.name, code: d.code, message: d.message, missingTerm: d.missingTerm });
  }
});

server.listen(PORT, () => console.log(`gateway listening on :${PORT} — the sole access path`));
