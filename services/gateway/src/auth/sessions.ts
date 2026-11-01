/**
 * End every session a person holds: their user sessions, and a technician's
 * device sessions. `exceptSessionId` keeps the caller's own session (a
 * password change from the account button). Null ends all of them (a reset,
 * an edit, or a deactivation in AC Logins).
 *
 * Logout of the one session in hand is a different statement: it names that
 * session id and does not look at the person.
 */
export const revokeUserSessions = async (
  q: <R>(sql: string, params?: readonly unknown[]) => Promise<readonly R[]>,
  userId: string,
  exceptSessionId: string | null,
): Promise<number> =>
  (await q<{ id: string }>(
    `UPDATE sessions SET revoked_at = now()
      WHERE revoked_at IS NULL
        AND ($2::uuid IS NULL OR id <> $2)
        AND ((principal_kind = 'user' AND principal_id = $1)
          OR (principal_kind = 'device_grant' AND principal_id IN (SELECT id FROM device_grants WHERE technician_id = $1)))
      RETURNING id`,
    [userId, exceptSessionId],
  )).length;
