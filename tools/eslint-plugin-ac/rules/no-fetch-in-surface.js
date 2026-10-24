/**
 * Non-negotiable #14 — no surface writes its own fetch call.
 *
 * Every request a surface makes goes through the generated client in
 * packages/sdk, built by the shell against the gateway's origin. A surface
 * that calls fetch can invent a request the gateway never agreed to serve, and
 * can be pointed at a second origin. packages/sdk/src/runtime.ts is the one
 * file allowed to touch the wire; tools/ci/schema-guard.ts checks the same
 * thing with no install.
 */
const WIRE_GLOBALS = new Set(["fetch", "EventSource", "XMLHttpRequest", "WebSocket"]);
/** The objects the wire globals hang off: `globalThis.fetch`, `window.WebSocket`, `self.fetch`. */
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);
const WIRE_IMPORTS = [/^node:http/, /^node:https/, /^http$/, /^https$/, /^undici$/, /^axios$/, /^ky$/, /^got$/, /^node-fetch$/, /^cross-fetch$/, /^eventsource$/, /^ws$/];

export default {
  meta: {
    type: "problem",
    docs: { description: "surfaces and the shell reach the gateway only through the generated SDK client" },
    schema: [],
    messages: {
      global: "{{name}} is called directly. Surfaces reach the gateway through shell.gateway (the generated client); packages/sdk/src/runtime.ts is the only place the wire is touched.",
      imported: "{{name}} is a wire library. A surface that owns a transport can be pointed at a second origin.",
    },
  },
  create(context) {
    const isWireGlobal = (node) => node && node.type === "Identifier" && WIRE_GLOBALS.has(node.name);
    // globalThis.fetch / window["WebSocket"] — called, constructed, or only taken (`const f = globalThis.fetch`).
    const wireOffGlobal = (node) => {
      if (node.type !== "MemberExpression" || node.object.type !== "Identifier" || !GLOBAL_OBJECTS.has(node.object.name)) return null;
      const name = node.computed ? (node.property.type === "Literal" ? node.property.value : null) : node.property.name;
      return WIRE_GLOBALS.has(name) ? name : null;
    };
    // The one sanctioned use: a surface's boot hands the platform's fetch to the shell —
    // `fetch: globalThis.fetch.bind(globalThis)` — which gives it to the SDK runtime and nobody else.
    const handedToShell = (node) => {
      const bind = node.parent;
      if (bind?.type !== "MemberExpression" || bind.object !== node || bind.computed || bind.property.name !== "bind") return false;
      const call = bind.parent;
      const prop = call?.parent;
      return call?.type === "CallExpression" && call.callee === bind && prop?.type === "Property" && prop.value === call &&
        !prop.computed && prop.key.type === "Identifier" && prop.key.name === "fetch";
    };
    return {
      CallExpression(node) {
        if (isWireGlobal(node.callee)) context.report({ node, messageId: "global", data: { name: node.callee.name } });
        // x.fetch(...) — the member call; globalThis.fetch(...) is reported once, below.
        if (node.callee.type === "MemberExpression" && isWireGlobal(node.callee.property) && !wireOffGlobal(node.callee)) {
          context.report({ node, messageId: "global", data: { name: node.callee.property.name } });
        }
      },
      NewExpression(node) {
        if (isWireGlobal(node.callee)) context.report({ node, messageId: "global", data: { name: node.callee.name } });
      },
      MemberExpression(node) {
        const name = wireOffGlobal(node);
        if (name && !handedToShell(node)) context.report({ node, messageId: "global", data: { name } });
      },
      // const f = fetch — an alias of the bare global is a call waiting to happen.
      VariableDeclarator(node) {
        if (isWireGlobal(node.init)) context.report({ node, messageId: "global", data: { name: node.init.name } });
      },
      ImportDeclaration(node) {
        const name = node.source.value;
        if (WIRE_IMPORTS.some((re) => re.test(name))) context.report({ node, messageId: "imported", data: { name } });
      },
    };
  },
};
