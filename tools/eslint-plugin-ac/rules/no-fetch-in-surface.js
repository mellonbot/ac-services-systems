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
    return {
      CallExpression(node) {
        if (isWireGlobal(node.callee)) context.report({ node, messageId: "global", data: { name: node.callee.name } });
        // globalThis.fetch(...) / window.fetch(...)
        if (node.callee.type === "MemberExpression" && isWireGlobal(node.callee.property)) {
          context.report({ node, messageId: "global", data: { name: node.callee.property.name } });
        }
      },
      NewExpression(node) {
        if (isWireGlobal(node.callee)) context.report({ node, messageId: "global", data: { name: node.callee.name } });
      },
      ImportDeclaration(node) {
        const name = node.source.value;
        if (WIRE_IMPORTS.some((re) => re.test(name))) context.report({ node, messageId: "imported", data: { name } });
      },
    };
  },
};
