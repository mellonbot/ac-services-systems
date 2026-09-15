/**
 * REFUSALS THAT DO NOT COME FROM THE DOMAIN.
 *
 * Two kinds of "no" used to reach the surface as 500 "internal error", which
 * the shell reads as a transport failure and answers by flipping the surface
 * degraded (09 §3.7):
 *
 *   1. the database refusing a row — a trigger (AC422 / AC403 after migration
 *      0004), an EXCLUDE constraint (23P01), a foreign key (23503), a unique
 *      (23505) or a CHECK (23514);
 *   2. a handler refusing an input it cannot resolve — a scope node that is
 *      not in the org, a job or crew that is not in scope.
 *
 * Both are the caller's row being wrong, not the gateway being broken. They
 * are 422 (or 403 for a policy refusal) with the reason in plain words — the
 * database's own message, which was written for a human — and a stable `code`
 * the shell can classify: the trigger function name, the constraint name, or
 * the handler's code.
 *
 * What stays 500: anything else. A 500 is a bug, and the shell is right to
 * treat it as one.
 */
export class InputRefused extends Error {
  readonly code: string;
  constructor(message: string, code = "input") {
    super(message);
    this.name = "InputRefused";
    this.code = code;
  }
}

/** The fields node-postgres puts on a DatabaseError. Typed here so this module needs no driver import. */
export type PgErrorLike = {
  readonly code?: string;
  readonly message: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly where?: string;
};

export type DbRefusal = { readonly status: 403 | 422; readonly name: string; readonly code: string; readonly message: string };

const functionFrom = (where: string | undefined): string | undefined =>
  where ? /function (ac_\w+)\(/.exec(where)?.[1] : undefined;

/** SQLSTATE → refusal, or null when the error is not a refusal we recognise (and so stays a 500). */
export const dbRefusal = (e: unknown): DbRefusal | null => {
  const pg = e as PgErrorLike;
  if (!pg || typeof pg !== "object" || typeof pg.code !== "string") return null;
  const code = pg.code;
  const trigger = functionFrom(pg.where);
  switch (true) {
    // Migration 0004: refused by an invariant of the data.
    case code === "AC422":
      return { status: 422, name: "TriggerRefused", code: trigger ?? "AC422", message: pg.message };
    // Migration 0004: refused by policy — audit and job_state_events immutability.
    case code === "AC403":
      return { status: 403, name: "PolicyRefused", code: trigger ?? "AC403", message: pg.message };
    // exclusion_violation: two rows in effect at once. The EXCLUDE constraint is the second layer under domain admission.
    case code === "23P01":
      return { status: 422, name: "OverlapRefused", code: pg.constraint ?? "exclusion", message: `${pg.message}${pg.detail ? ` — ${pg.detail}` : ""}` };
    // foreign_key_violation: the row names something that does not exist.
    case code === "23503":
      return { status: 422, name: "ReferenceRefused", code: pg.constraint ?? "foreign_key", message: `${pg.message}${pg.detail ? ` — ${pg.detail}` : ""}` };
    // unique_violation
    case code === "23505":
      return { status: 422, name: "DuplicateRefused", code: pg.constraint ?? "unique", message: `${pg.message}${pg.detail ? ` — ${pg.detail}` : ""}` };
    // check_violation
    case code === "23514":
      return { status: 422, name: "CheckRefused", code: pg.constraint ?? "check", message: `${pg.message}${pg.detail ? ` — ${pg.detail}` : ""}` };
    // not_null_violation — a required position not stated (OQ5's boolean, for one).
    case code === "23502":
      return { status: 422, name: "RequiredRefused", code: pg.constraint ?? "not_null", message: `${pg.message}${pg.detail ? ` — ${pg.detail}` : ""}` };
    default:
      return null;
  }
};
