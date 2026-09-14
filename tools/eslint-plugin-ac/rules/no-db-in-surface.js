/**
 * Non-negotiable #3 — the API gateway is the sole access path.
 *
 * Package isolation (.npmrc node-linker=isolated) already makes `pg`
 * unresolvable inside a surface. This rule is for the case where someone adds
 * the dependency deliberately, at which point the failure should be a review
 * comment rather than a working feature.
 */
const BANNED = [/^pg$/, /^pg-/, /^postgres$/, /^mysql/, /^drizzle-orm/, /^knex$/, /^typeorm$/, /^prisma/, /^@prisma/, /^@ac\/schema$/];

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
    return {
      ImportDeclaration(node) {
        const name = node.source.value;
        if (BANNED.some((re) => re.test(name))) {
          context.report({ node, messageId: "banned", data: { name } });
        }
      },
    };
  },
};
