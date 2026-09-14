/**
 * Money is integer minor units as bigint, end to end. Quantities are integer
 * thousandths. There is no float in the money path.
 *
 * Floats in money do not fail loudly. They fail as a one-cent discrepancy on an
 * enterprise invoice, eleven months later, in front of a facilities director.
 */
const MONEY = /(_minor|Minor|_bps|Bps|_milli|Milli)$/;

export default {
  meta: {
    type: "problem",
    docs: { description: "no floating point anywhere near money" },
    schema: [],
    messages: {
      float: "'{{name}}' holds integer minor units. Use a bigint literal (0n), not {{got}}.",
      coerce: "{{fn}}() puts a float in the money path. Use BigInt() and keep the units integral.",
    },
  },
  create(context) {
    return {
      "AssignmentExpression, VariableDeclarator, Property"(node) {
        const key = node.left?.name ?? node.id?.name ?? node.key?.name;
        const val = node.right ?? node.init ?? node.value;
        if (!key || !val || !MONEY.test(key)) return;
        if (val.type === "Literal" && typeof val.value === "number") {
          context.report({ node: val, messageId: "float", data: { name: key, got: String(val.value) } });
        }
      },
      CallExpression(node) {
        const fn = node.callee.name;
        if (fn === "parseFloat" || fn === "parseInt") {
          context.report({ node, messageId: "coerce", data: { fn } });
        }
        if (node.callee.type === "MemberExpression" && node.callee.property.name === "toFixed") {
          context.report({ node, messageId: "coerce", data: { fn: "toFixed" } });
        }
      },
    };
  },
};
