/**
 * Non-negotiable #3 — the API gateway is the sole access path.
 *
 * Package isolation (.npmrc node-linker=isolated) already makes `pg`
 * unresolvable inside a surface. This rule is for the case where someone adds
 * the dependency deliberately, at which point the failure should be a review
 * comment rather than a working feature.
 */
import { dirname, resolve } from "node:path";

const BANNED = [/^pg$/, /^pg-/, /^postgres$/, /^mysql/, /^drizzle-orm/, /^knex$/, /^typeorm$/, /^prisma/, /^@prisma/, /^@ac\/schema$/];

/** The repo imports by relative .ts path, so `@ac/schema` alone never matches: a relative path that lands in packages/schema is the same import. */
const intoSchema = (filename, name) =>
  name.startsWith(".") && /(^|\/)packages\/schema(\/|$)/.test(resolve(dirname(filename), name).replace(/\\/g, "/"));

export default {
  meta: {
    type: "problem",
    docs: { description: "surfaces reach the data layer only through the gateway SDK" },
    schema: [],
    messages: {
      banned:
        "{{name}} cannot be imported from a surface. Every surface reaches data through @ac/sdk via @ac/shell. " +
        "A surface holding a database credential is how the gateway stops being the sole access path.",
    },
  },
  create(context) {
    const check = (node, source) => {
      // A dynamic import with a computed specifier is not a name this rule can read.
      if (!source || source.type !== "Literal" || typeof source.value !== "string") return;
      const name = source.value;
      if (BANNED.some((re) => re.test(name)) || intoSchema(context.filename, name)) {
        context.report({ node, messageId: "banned", data: { name } });
      }
    };
    return {
      ImportDeclaration(node) { check(node, node.source); },
      ExportNamedDeclaration(node) { check(node, node.source); },
      ExportAllDeclaration(node) { check(node, node.source); },
      // await import("pg") is the same credential, loaded later.
      ImportExpression(node) { check(node, node.source); },
    };
  },
};
