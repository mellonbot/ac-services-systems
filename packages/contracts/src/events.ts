/**
 * THE EVENT CATALOGUE. Master plan §2.7: "event stream for job, project,
 * contract and SLA state changes, with all three blocks as subscribers";
 * action plan B5 adds credential expiry.
 *
 * Topics are data. An event the unit of work emits with a topic not listed
 * here is refused at emit time — a topic string typed in a handler is a
 * subscriber that never fires and nobody notices.
 */
export const TOPICS = [
  // hierarchy and contract — S2 authors, everything subscribes
  "account.created", "account.updated", "account.deactivated",
  "contract.created", "contract.amended", "contract.term_overridden", "contract.expired",
  // work
  "job.created", "job.assigned", "job.transitioned", "job.reassigned", "job.cancelled", "job.completed",
  "project.created", "project.crew_requested", "project.crew_released", "project.closed",
  // SLA
  "sla.timer_opened", "sla.escalated", "sla.breached", "sla.satisfied",
  // network and compliance
  "credential.verified", "credential.expiring", "credential.expired", "crew.compliance_refused",
  "firm.status_changed",
  // money
  "invoice.issued", "invoice.paid", "settlement.statement_issued",
  // sync
  "sync.conflict_queued",
  // warranty
  "warranty_case.opened", "warranty_case.decided",
] as const;

export type Topic = (typeof TOPICS)[number];

export const isTopic = (s: string): s is Topic => (TOPICS as readonly string[]).includes(s);

/**
 * The envelope every subscriber receives. `regionId` and `orgId` are on the
 * event for the same reason they are on every row: non-negotiable #2 says
 * "audit log and event stream included".
 */
export type DomainEvent = {
  readonly topic: Topic;
  readonly entity: string;
  readonly entityId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly regionId: string;
  readonly orgId: string;
  readonly actorId: string;
  readonly surfaceId: string;
  /** Idempotency key for subscribers. Same as the audit row's; a subscriber that has seen it drops it. */
  readonly eventId: string;
  readonly occurredAt: string;
};

/** Block subscriptions declared, not discovered. */
export const SUBSCRIBERS: Readonly<Record<"OFC" | "FLD" | "INV" | "WORKER", readonly Topic[]>> = {
  OFC: ["job.transitioned", "job.completed", "sla.escalated", "sla.breached", "credential.expiring", "credential.expired", "crew.compliance_refused", "sync.conflict_queued", "contract.amended"],
  FLD: ["job.assigned", "job.reassigned", "job.cancelled", "contract.term_overridden"],
  INV: ["job.completed", "contract.amended", "contract.term_overridden", "sla.breached", "settlement.statement_issued", "firm.status_changed"],
  WORKER: ["job.created", "job.assigned", "sla.timer_opened", "credential.verified"],
};
