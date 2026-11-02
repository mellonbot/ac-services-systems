import { test } from "node:test";
import assert from "node:assert/strict";
import { revokeUserSessions } from "./sessions.ts";

const fake = (rows: number) => {
  const seen: { sql: string; params: readonly unknown[] | undefined }[] = [];
  const q = async <R>(sql: string, params?: readonly unknown[]): Promise<readonly R[]> => {
    seen.push({ sql, params });
    return Array.from({ length: rows }, (_, i) => ({ id: `s${i}` }) as R);
  };
  return { q, seen };
};

test("a password change keeps the current session and ends the rest", async () => {
  const { q, seen } = fake(2);
  const n = await revokeUserSessions(q, "user-1", "session-9");
  assert.equal(n, 2);
  assert.equal(seen.length, 1);
  assert.match(seen[0]!.sql, /\$2::uuid IS NULL OR id <> \$2/);
  assert.match(seen[0]!.sql, /principal_kind = 'device_grant'/);
  assert.match(seen[0]!.sql, /device_grants WHERE technician_id = \$1/);
  assert.deepEqual(seen[0]!.params, ["user-1", "session-9"]);
});

test("a login reset passes no session to keep", async () => {
  const { q, seen } = fake(0);
  const n = await revokeUserSessions(q, "user-1", null);
  assert.equal(n, 0);
  assert.deepEqual(seen[0]!.params, ["user-1", null]);
});
