/**
 * Non-negotiable #9 — one field experience regardless of employment.
 *
 * The compliance gate is the only code permitted to read employment shape, and
 * it produces no field-visible difference. A crew that can see it is being told
 * they are a different class of worker, which is the execution-quality gap
 * Model A exists to close.
 */
const BANNED = new Set(["employment_type", "employmentType", "isSubcontracted", "is_subcontractor", "subcontracted"]);

export default {
  meta: {
    type: "problem",
    docs: { description: "employment shape is invisible below the gate" },
    schema: [],
    messages: {
      leaked:
        "'{{name}}' is not available in the field layer. Employed and subcontracted crews get an " +
        "identical experience; the only code that reads employment shape is domain/compliance/gate.ts, " +
        "and its output is a clearance, not a label.",
    },
  },
  create(context) {
    const check = (node, name) => {
      if (BANNED.has(name)) context.report({ node, messageId: "leaked", data: { name } });
    };
    return {
      Identifier: (n) => check(n, n.name),
      Literal: (n) => { if (typeof n.value === "string") check(n, n.value); },
    };
  },
};
