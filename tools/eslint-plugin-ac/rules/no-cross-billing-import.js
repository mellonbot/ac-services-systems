/**
 * Four invoicing paths stay four.
 *
 * Catches the relative spelling (`../enterprise_sla/`) an IDE refactor produces
 * on its own, which is how this erosion actually happens — nobody types the
 * package path.
 */
const PATH_DIR = /billing[\\/]paths[\\/]([a-z_]+)/;
// The four are named here so the relative spelling `../enterprise_sla/index.ts`
// is caught too. A rule that only sees the long import path catches nothing —
// nobody types the long import path.
const PATHS = ["one_time", "residential_membership", "enterprise_sla", "project"];

export default {
  meta: {
    type: "problem",
    docs: { description: "billing paths may not import each other" },
    schema: [],
    messages: {
      cross:
        "billing path '{{from}}' imports from '{{to}}'. The moment one path imports another, " +
        "the next edit is `if (isProject)` and eighteen months later residential pricing cannot " +
        "change without regression-testing all four. If the behaviour is genuinely shared, it goes " +
        "in billing/shared/ — and it only qualifies if it serves both paths WITHOUT a flag.",
    },
  },
  create(context) {
    const self = PATH_DIR.exec(context.filename);
    if (!self) return {};
    return {
      ImportDeclaration(node) {
        const spec = node.source.value;
        const direct = PATH_DIR.exec(spec);
        const to = direct?.[1] ?? PATHS.find((p) => p !== self[1] && new RegExp(`(^|[./])${p}/`).test(spec));
        if (to && to !== self[1]) {
          context.report({ node, messageId: "cross", data: { from: self[1], to } });
        }
      },
    };
  },
};
