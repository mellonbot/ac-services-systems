/**
 * A timestamptz on the wire, as UTC ISO-8601 with a Z.
 *
 * `to_char` on a timestamptz formats in the session's zone. Gluing a Z onto
 * that clock is wrong by the cluster's offset — found by
 * test/integration/s6-site-card.test.ts on a Chicago cluster. Date-only
 * `to_char` and the session-local `HH24:MI:SSOF` form are different shapes
 * and do not go through here.
 */
export const iso = (col: string): string =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
