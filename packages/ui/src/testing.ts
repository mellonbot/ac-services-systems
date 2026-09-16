/**
 * The string renderer, for tests above this package. A surface's screen test
 * renders through here rather than importing preact-render-to-string itself:
 * under .npmrc isolation the package is resolvable from packages/ui alone,
 * and the guard keeps every renderer import behind this boundary. Not on the
 * package index — a bundle never needs it.
 */
export { render as renderToString } from "preact-render-to-string";
