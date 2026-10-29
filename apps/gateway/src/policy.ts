/**
 * Whose org a request is about.
 *
 * Three shapes, on purpose. An internal caller listing accounts may omit the
 * org, and that omission is the request — it is not filled in from the token.
 * Resolving terms is the other way round: an omitted org means the token's
 * org, and a named one is checked as a uuid. A contract list replaces the
 * field on the whole input for anyone who is not internal.
 */

/** `accounts.list`. Internal keeps `requested`, including when it is missing. */
export const namedOrg = <T extends string | undefined>(internal: boolean, requested: T, tokenOrg: string): T | string =>
  internal ? requested : tokenOrg;

/**
 * `terms.resolved`. An internal caller who named an org is held to a uuid;
 * everyone else, and an internal caller who named nothing, is the token's org.
 */
export const optionalOrg = (
  internal: boolean,
  requested: string | undefined,
  tokenOrg: string,
  parse: (v: unknown, field: string) => string,
): string => (internal && requested !== undefined ? parse(requested, "orgId") : tokenOrg);

/** `contracts.list`. The token's org replaces the input's for anyone who is not internal. */
export const withCallerOrg = <T extends { readonly orgId: string }>(internal: boolean, input: T, tokenOrg: string): T =>
  internal ? input : { ...input, orgId: tokenOrg };
