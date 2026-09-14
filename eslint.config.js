import tseslint from "typescript-eslint";
import ac from "./tools/eslint-plugin-ac/index.js";

/**
 * Rules are scoped to the layer they protect. A rule that fires everywhere gets
 * disabled somewhere, and the disable comment is the erosion.
 */
export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "packages/sdk/src/generated/**"] },
  ...tseslint.configs.recommended,
  {
    plugins: { ac },
    rules: {
      "ac/no-clearance-forgery": "error",
      "ac/no-storage-bypass": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["apps/s*/**/*.ts", "apps/s*/**/*.tsx"],
    rules: { "ac/no-db-in-surface": "error" },
  },
  {
    // The field layer. S5 and, when it lands, the tablet UI.
    files: ["apps/s5-technician/**/*.ts", "packages/ui/src/field/**/*.ts"],
    rules: { "ac/no-employment-type-in-field": "error" },
  },
  {
    files: ["packages/domain/**/*.ts"],
    ignores: ["packages/domain/**/*.test.ts"],
    rules: { "ac/no-clock-in-domain": "error" },
  },
  {
    files: ["packages/domain/src/billing/**/*.ts"],
    rules: { "ac/no-cross-billing-import": "error" },
  },
  {
    // The money path. Scoped deliberately: WCAG contrast ratios and layout
    // maths are genuinely floating point, and a rule that fires there is a rule
    // that gets a disable comment — which is the erosion, one file over.
    files: ["packages/domain/**/*.ts", "apps/gateway/**/*.ts", "apps/worker/**/*.ts"],
    rules: { "ac/no-float-money": "error" },
  },
  {
    // The storage package IS the interface, and build tooling reads the repo by
    // definition. Neither is product code reaching around the abstraction.
    files: ["packages/storage/**/*.ts", "tools/**/*.ts", "tools/**/*.js"],
    rules: { "ac/no-storage-bypass": "off" },
  },
);
