import { ResolutionError } from "../../inheritance/resolve.ts";

/**
 * A path's term, or a refusal. PathContext's rule is "never a default": an
 * absent fee read as zero is an invoice that bills nothing and looks fine.
 * Admitted to shared/ because every path that reads a term reads it this way.
 */
export const requireTerm = (terms: Readonly<Record<string, unknown>>, key: string, path: string): string => {
  const v = terms[key];
  if (v === undefined || v === null || v === "") {
    throw new ResolutionError(`[billing:${path}] no value for "${key}" on this contract — the invoice is refused, not billed at zero.`, key, "no_value");
  }
  return String(v);
};
