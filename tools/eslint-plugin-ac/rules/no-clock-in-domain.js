/**
 * packages/domain has no I/O — and a clock is I/O.
 *
 * Every domain function takes the instant it is evaluating at. That is what
 * makes "does a certificate expiring Tuesday clear a job on Thursday" a 40ms
 * unit test instead of a staging exercise nobody runs twice.
 */
export default {
  meta: {
    type: "problem",
    docs: { description: "no ambient clock in the domain layer" },
    schema: [],
    messages: {
      clock:
        "{{what}} is ambient state. Domain functions take the instant they evaluate at as a " +
        "parameter — otherwise the compliance window, SLA cascade and billing period tests are " +
        "all untestable at the boundaries that matter.",
    },
  },
  create(context) {
    return {
      "CallExpression[callee.object.name='Date'][callee.property.name='now']"(node) {
        context.report({ node, messageId: "clock", data: { what: "Date.now()" } });
      },
      "NewExpression[callee.name='Date']"(node) {
        if (node.arguments.length === 0) {
          context.report({ node, messageId: "clock", data: { what: "new Date()" } });
        }
      },
      "MemberExpression[object.name='Math'][property.name='random']"(node) {
        context.report({ node, messageId: "clock", data: { what: "Math.random()" } });
      },
    };
  },
};
