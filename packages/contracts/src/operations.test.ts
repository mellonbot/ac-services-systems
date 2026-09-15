import { test } from "node:test";
import assert from "node:assert/strict";
import { OPERATIONS, OPERATION_IDS, routeKey, surfacesFor, isOperationId } from "./operations.ts";
import { SURFACES, SURFACE_IDS } from "./surfaces.ts";
import { classifyRefusal, admissionAxis } from "./refusals.ts";

/**
 * The catalogue is data, and data has invariants. These are the ones that,
 * if broken, make the generated client and the gateway disagree silently.
 */

test("every operation's id is its key", () => {
  for (const id of OPERATION_IDS) assert.equal(OPERATIONS[id].id, id);
});

test("routes are unique — two operations on one METHOD path would be dispatched to whichever the Map kept", () => {
  const keys = OPERATION_IDS.map((id) => routeKey(OPERATIONS[id]));
  assert.equal(new Set(keys).size, keys.length, `duplicate route among ${keys}`);
});

test("sdk method names are unique and are identifiers", () => {
  const names = OPERATION_IDS.map((id) => OPERATIONS[id].sdkMethod);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-z][A-Za-z0-9]*$/);
});

test("every surface an operation names exists in the registry, and every enabled authenticated surface can at least ask who it is", () => {
  for (const id of OPERATION_IDS) {
    assert.ok(OPERATIONS[id].surfaces.length > 0, `${id} is callable by nobody`);
    for (const s of OPERATIONS[id].surfaces) assert.ok(SURFACE_IDS.includes(s), `${id} names unknown surface ${s}`);
  }
  for (const s of SURFACE_IDS) {
    if (!SURFACES[s].enabled || SURFACES[s].namespace === "anonymous") continue;
    assert.ok(OPERATIONS["session.me"].surfaces.includes(s), `${s} cannot call session.me`);
    assert.ok(OPERATIONS["events.stream"].surfaces.includes(s), `${s} cannot subscribe to events`);
  }
});

test("carrier follows method — a GET has no body, a POST is not a query string", () => {
  for (const id of OPERATION_IDS) {
    const op = OPERATIONS[id];
    if (op.method === "GET") assert.notEqual(op.carrier, "body", `${id} is GET with a body`);
    if (op.method === "POST") assert.notEqual(op.carrier, "query", `${id} is POST with a query string`);
  }
});

test("mutations require a token, and the only unauthenticated operations are login and health", () => {
  for (const id of OPERATION_IDS) {
    const op = OPERATIONS[id];
    if (op.kind === "mutation" || op.kind === "query" || op.kind === "stream") assert.equal(op.auth, "bearer", `${id} is ${op.kind} without auth`);
    if (op.auth === "none") assert.ok(op.kind === "login" || op.kind === "system", `${id} is unauthenticated and ${op.kind}`);
  }
});

test("the gated door is callable by S3 alone; term authoring by S2 alone", () => {
  assert.deepEqual([...OPERATIONS["dispatch.assign"].surfaces], ["S3"]);
  assert.deepEqual([...OPERATIONS["terms.authorOverride"].surfaces], ["S2"]);
  assert.deepEqual([...OPERATIONS["sync.replay"].surfaces], ["S5"]);
});

test("S4 can call no mutation — read-only by construction reaches the catalogue too (ending its own session is not a write)", () => {
  for (const id of OPERATION_IDS) {
    if (OPERATIONS[id].kind !== "mutation" || id === "auth.logout") continue;
    assert.ok(!(OPERATIONS[id].surfaces as readonly string[]).includes("S4"), `S4 may call mutation ${id}`);
  }
});

test("surfacesFor narrows by namespace — an internal principal resolving terms is S2, a customer is S6", () => {
  const ns = (s: (typeof SURFACE_IDS)[number]) => SURFACES[s].namespace;
  assert.deepEqual([...surfacesFor("terms.resolved", ns, "internal")], ["S2"]);
  assert.deepEqual([...surfacesFor("terms.resolved", ns, "customer")], ["S6"]);
  assert.deepEqual([...surfacesFor("terms.resolved", ns, "subcontractor")], []);
});

test("isOperationId is a real guard", () => {
  assert.ok(isOperationId("dispatch.assign"));
  assert.ok(!isOperationId("dispatch.force"));
  assert.ok(!isOperationId("constructor"));
});

// ---------------------------------------------------------------------------
// Refusal classification — the shell's one table of reasons.
// ---------------------------------------------------------------------------
test("the ratchet is commercial in both directions; authoring tier and overlap are structural", () => {
  assert.equal(admissionAxis("ratchet_loosened"), "commercial");
  assert.equal(admissionAxis("would_orphan_descendants"), "commercial");
  assert.equal(admissionAxis("illegal_tier"), "structural");
  assert.equal(admissionAxis("overlap"), "structural");
  assert.equal(admissionAxis("bad_value"), "structural");
  assert.equal(admissionAxis(undefined), "structural");
  assert.equal(admissionAxis("something_new"), "structural", "an unknown code is not a commercial conversation by default");
});

test("classifyRefusal maps the gateway's statuses onto the taxonomy", () => {
  assert.deepEqual(classifyRefusal(401, { error: "AuthError", code: "expired", message: "token expired" }),
    { kind: "token", code: "expired", message: "token expired" });
  assert.equal(classifyRefusal(403, { error: "SurfaceWriteDenied", message: "S3 may not write contract" }).kind, "scope");
  assert.equal(classifyRefusal(404, { error: "SurfaceDisabled", message: "S4 is Phase 2" }).kind, "phase_disabled");
  assert.equal(classifyRefusal(404, { error: "Error", message: "no route GET /x" }).kind, "no_route");
  const adm = classifyRefusal(422, { error: "AdmissionRefused", code: "ratchet_loosened", message: "looser than inherited" });
  assert.equal(adm.kind, "admission");
  if (adm.kind === "admission") assert.equal(adm.axis, "commercial");
  assert.equal(classifyRefusal(400, { message: "email required" }).kind, "bad_request");
  assert.deepEqual(classifyRefusal(503, null), { kind: "transport", status: 503, message: "HTTP 503" });
  assert.equal(classifyRefusal(500, { error: "Error", message: "internal error" }).kind, "transport");
});
