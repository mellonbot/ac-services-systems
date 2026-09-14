import type { ComplianceClearance } from "./clearance.ts";

export type Assignment = {
  readonly jobId: string;
  readonly crewId: string;
  readonly clearance: ComplianceClearance;
  readonly assignedBy: string;
};

/**
 * There is no second way to create an assignment, and no argument to this
 * function that can be set to skip the gate. The clearance is positional: you
 * either hold one the evaluator minted, or you do not call this.
 */
export const buildAssignment = (
  jobId: string,
  crewId: string,
  clearance: ComplianceClearance,
  assignedBy: string,
): Assignment => {
  // Defence in depth: a clearance for a different crew is a programming error,
  // not a policy decision, so it throws rather than refusing politely.
  if (clearance.crewId !== crewId) {
    throw new Error(`clearance was minted for crew ${clearance.crewId}, not ${crewId}`);
  }
  return Object.freeze({ jobId, crewId, clearance, assignedBy });
};
