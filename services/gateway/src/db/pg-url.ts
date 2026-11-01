/**
 * A connection string written for libpq, made safe for node `pg`.
 *
 * Managed Postgres providers hand out strings for psql, and PlanetScale's
 * ends in `sslmode=verify-full&sslrootcert=system`. To libpq, `system` means
 * "verify against the OS trust store". To pg-connection-string every
 * `sslrootcert` is a file path: it opens a file named `system`, gets ENOENT,
 * and the gateway dies constructing its first Client — before it listens, so
 * the container exits and the Worker only ever sees "not ready".
 *
 * Node already verifies against its bundled roots under `sslmode=verify-full`,
 * so `sslrootcert=system` asks for what pg does by default. Drop exactly that
 * pair and nothing else: a real path still names a file, and every other
 * parameter is pg's business. The string is edited as text, never re-encoded
 * through URL, so a password's percent-escapes reach pg untouched.
 */
export const forNodePg = (connectionString: string): string => {
  const q = connectionString.indexOf("?");
  if (q < 0) return connectionString;
  const kept = connectionString.slice(q + 1).split("&").filter((pair) => {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const value = eq < 0 ? "" : pair.slice(eq + 1);
    return !(key === "sslrootcert" && value === "system");
  });
  return kept.length ? `${connectionString.slice(0, q)}?${kept.join("&")}` : connectionString.slice(0, q);
};
