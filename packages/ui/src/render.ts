import { h, render as preactRender, type VNode, type ComponentChildren } from "preact";
import htmImport from "htm";
import { signal, computed, effect, batch, type Signal, type ReadonlySignal } from "@preact/signals";
import type { Density } from "../../tokens/src/index.ts";
import type { ComponentSpec } from "./component.ts";

/**
 * THE RENDERER BOUNDARY. This file and its sibling tests are the only places
 * in the repository that import preact, htm or @preact/signals; the guard
 * fails any `apps/s*` file that names them (09 §3.10). Everything above holds
 * `html`, `mount` and the signal primitives from here, so a renderer swap is
 * this file plus the templates — the count of files outside packages/ui that
 * would change is the number the guard keeps at zero.
 *
 * No JSX anywhere: Node's type stripping cannot erase it, and the discipline
 * that has caught every defect so far (tests that need nothing installed but
 * the repo's own dependencies) would be the first casualty. `htm` is a tagged
 * template; it erases fine.
 */
// htm ships one .d.ts for both module systems; under nodenext it types as the
// CJS namespace while the runtime import is the ESM function. Name the shape we use.
type Htm = { bind<R>(h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => R): (strings: TemplateStringsArray, ...values: unknown[]) => R | R[] };
const htm = htmImport as unknown as Htm;
export const html = htm.bind(h as Parameters<Htm["bind"]>[0]) as (strings: TemplateStringsArray, ...values: unknown[]) => VNode;

export type { VNode, ComponentChildren, Signal, ReadonlySignal };
export { signal, computed, effect, batch };

/** Render a tree into a mount point. The frame's `<main id="mount">` is the one a surface uses. */
export const mount = (tree: VNode, into: Element): void => preactRender(tree, into);

/** The density a component may be handed: its spec's declared set, and nothing wider. */
export type Admitted<S extends ComponentSpec<Density>> = S["densities"][number];

export type ViewProps<S extends ComponentSpec<Density>, P> = P & { readonly density: Admitted<S> };

/**
 * A component is its spec plus a view whose `density` prop is typed to the
 * spec's admitted set — and a runtime check of the same fact, because a tagged
 * template cannot carry a type: `html\`<${ComplianceBadge} density="field"/>\``
 * type-checks (the values slot is `unknown`), so the TYPED seam is the call:
 *
 *   html\`<div>${ComplianceBadge({ density, cleared })}</div>\`   // density: "field" → type error
 *
 * That is the convention: components are CALLED, elements are tagged. A
 * surface that tags a component anyway still cannot render it outside its
 * densities — the wrapper throws, loudly, at first render, which is the
 * nearest thing to a type error a template can offer.
 */
export const component = <S extends ComponentSpec<Density>, P>(
  spec: S,
  view: (props: ViewProps<S, P>) => VNode | null,
): ((props: ViewProps<S, P>) => VNode | null) & { readonly spec: S } => {
  const guarded = (props: ViewProps<S, P>): VNode | null => {
    if (!admits(spec, props.density)) {
      throw new Error(`${spec.name} has no ${String(props.density)} variant — admitted: ${spec.densities.join(", ")}. See packages/ui/src/component.ts.`);
    }
    return view(props);
  };
  return Object.assign(guarded, { spec });
};

/** Runtime twin of the type: for the guard, tests, and a surface that receives a density it did not choose. */
export const admits = (spec: ComponentSpec<Density>, density: Density): boolean =>
  (spec.densities as readonly Density[]).includes(density);
