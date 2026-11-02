import type { MissingTerm } from "../../../../packages/contracts/src/refusals.ts";

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
 * Except a foreign-key or unique refusal: there the database's message and
 * detail name the table and the key values ("Key (lead_id)=(…) is not present
 * in table leads"), which tell a caller what exists. Those go out in general
 * words with the constraint as the code; the detail stays in the server log.
 *
 * And a value the database could not read at all — not a uuid, a number out
 * of range, a date that is not one (22xxx) — is the caller's request being
 * malformed: a 400, never a 500.
 *
 * What stays 500: anything else. A 500 is a bug, and the shell is right to
 * treat it as one.
 */
export class InputRefused extends Error {
  readonly code: string;
  /** Set on a `no_value` refusal, so a surface can say what is missing without parsing the message. */
  readonly missingTerm: MissingTerm | undefined;
  constructor(message: string, code = "input", missingTerm?: MissingTerm) {
    super(message);
    this.name = "InputRefused";
    this.code = code;
    this.missingTerm = missingTerm;
  }
}

/**
 * A request the gateway could not even read as a request: a required field
 * absent, a field of the wrong shape. 400, not 422 — nothing was refused on
 * its merits, because there was nothing to judge. The generated client makes
 * these rare (the input is typed); a curl or a stale bundle makes them possible.
 */
export class BadInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadInput";
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

export type DbRefusal = { readonly status: 400 | 403 | 422; readonly name: string; readonly code: string; readonly message: string };

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
      return { status: 422, name: "ReferenceRefused", code: pg.constraint ?? "foreign_key", message: "this names a record that does not exist, or one that is still in use" };
    // unique_violation
    case code === "23505":
      return { status: 422, name: "DuplicateRefused", code: pg.constraint ?? "unique", message: "this would duplicate a record that already exists" };
    // check_violation
    case code === "23514":
      return { status: 422, name: "CheckRefused", code: pg.constraint ?? "check", message: `${pg.message}${pg.detail ? ` — ${pg.detail}` : ""}` };
    // not_null_violation — a required position not stated (OQ5's boolean, for one).
    case code === "23502":
      return { status: 422, name: "RequiredRefused", code: pg.constraint ?? "not_null", message: `${pg.message}${pg.detail ? ` — ${pg.detail}` : ""}` };
    // data exceptions: invalid text for a type (22P02), out of range (22003), bad datetime (22007/22008).
    case code === "22P02" || code === "22003" || code === "22007" || code === "22008":
      return { status: 400, name: "BadInput", code, message: `a value in the request could not be read: ${pg.message}` };
    default:
      return null;
  }
};
