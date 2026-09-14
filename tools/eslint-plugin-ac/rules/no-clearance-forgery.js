/**
 * The compliance gate is a type, not a check — so the remaining attack surface
 * is the cast. `{} as ComplianceClearance` is the one-line override this whole
 * mechanism exists to prevent, and it is exactly what a tired person writes at
 * T-4 to make the build go green.
 *
 * Also bars importing the minting function outside the evaluator. It is not
 * exported from the package index; this covers the deep import.
 */
export default {
  meta: {
    type: "problem",
    docs: { description: "a clearance comes from the evaluator or it does not exist" },
    schema: [],
    messages: {
      cast:
        "Casting to ComplianceClearance forges the compliance gate. There is exactly one way to " +
        "hold one: call evaluate() and get a non-refusal. If evaluate() is refusing, the crew is " +
        "not cleared for that service window — that is the gate working, on the day it matters.",
      mint:
        "mintClearance is internal to domain/compliance. Importing it anywhere else recreates the " +
        "override this design removed.",
    },
  },
  create(context) {
    const inEvaluator = /domain[\\/]src[\\/]compliance[\\/]/.test(context.filename);
    return {
      TSAsExpression(node) {
        const t = context.sourceCode.getText(node.typeAnnotation);
        if (/ComplianceClearance/.test(t) && !inEvaluator) {
          context.report({ node, messageId: "cast" });
        }
      },
      ImportDeclaration(node) {
        if (inEvaluator) return;
        if (node.specifiers.some((s) => s.imported?.name === "mintClearance")) {
          context.report({ node, messageId: "mint" });
        }
      },
    };
  },
};
