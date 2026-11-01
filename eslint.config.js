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
    // Non-negotiable #14. The surface layer, the shell and the component set
    // never touch the wire; packages/sdk/src/runtime.ts is the one file that does.
    files: ["apps/s*/**/*.ts", "apps/s*/**/*.tsx", "packages/shell/**/*.ts", "packages/ui/**/*.ts"],
    // Tests fake the wire on purpose; the guard skips them for the same reason.
    ignores: ["**/*.test.ts"],
    rules: { "ac/no-fetch-in-surface": "error" },
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
    files: ["packages/domain/**/*.ts", "services/gateway/**/*.ts", "services/worker/**/*.ts"],
    rules: { "ac/no-float-money": "error" },
  },
  {
    // The storage package IS the interface, and build tooling reads the repo by
    // definition. Neither is product code reaching around the abstraction.
    files: ["packages/storage/**/*.ts", "tools/**/*.ts", "tools/**/*.js", "tools/**/*.mjs"],
    rules: { "ac/no-storage-bypass": "off" },
  },
  {
    // Electron loads this smoke script as CommonJS; require() is how it imports.
    files: ["tools/logins-app/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // figures.test.ts reads docs/BRAND.md and brand.ts to prove the prose
    // quotes the measurement. That is the same category as build tooling
    // reading the repo — it checks repository TEXT, not product data — and the
    // exemption is scoped to this one package's tests rather than to tests in
    // general, because a surface test reaching for node:fs is the thing the
    // rule exists to catch.
    files: ["packages/tokens/**/*.test.ts"],
    rules: { "ac/no-storage-bypass": "off" },
  },
);
