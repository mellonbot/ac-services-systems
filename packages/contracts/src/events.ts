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
  // a tenant's white-label. INV subscribes: the portal is the surface it repaints.
  "brand.theme_set",
  "contract.created", "contract.amended", "contract.term_overridden", "contract.expired",
  // work. `service_request.created` is item 6's — the customer asked; OFC
  // subscribes so a dispatcher's board can refetch its intake.
  "service_request.created",
  // a photo sent with a request. OFC subscribes so the request's thumbnails refetch.
  "service_request.photo_attached",
  // the office opened a job against a request. OFC refetches its intake; INV (S6) the customer's work orders.
  "service_request.job_opened",
  // item 9 — the site record. A unit registered at a site, a contact set at a
  // node. INV subscribes: the site card refetches the list the event touched.
  "equipment.registered", "account_contact.set",
  "job.created", "job.assigned", "job.transitioned", "job.reassigned", "job.cancelled", "job.completed",
  // 0015: a note written or the return-trip flag changed. OFC subscribes so
  // every dispatcher's dashboard refetches; nobody outside the office does.
  "job.annotated",
  // 0016: the customer was told something (an update published), or either side
  // wrote in the thread. OFC refetches the job; INV (S6) refetches the conversation.
  "job.update_published", "job.message_posted",
  "project.created", "project.crew_requested", "project.crew_released", "project.closed",
  // SLA
  "sla.timer_opened", "sla.escalated", "sla.breached", "sla.satisfied",
  // network and compliance
  "credential.recorded", "credential.verified", "credential.expiring", "credential.expired", "crew.compliance_refused",
  "crew.created", "crew.updated",
  // 0020: the roster. S2 and S3's board refetch.
  "technician.recorded", "technician.updated",
  // 0024: what an install was sold under, and by whom.
  "project.created",
  "firm.created", "firm.updated", "firm.status_changed",
  // a login added, edited, deactivated or reactivated (AC Logins writes these
  // directly). OFC subscribes: the Manager Dashboard's team list refetches.
  "user.created", "user.updated",
  "rate_card.changed",
  // item 4 — D-2a's primitive, recorded. No subscriber yet; added when a
  // screen needs to react rather than in anticipation of one.
  "device.registered", "device.shift_granted",
  // money
  "invoice.issued", "invoice.paid", "invoice.voided", "settlement.statement_issued",
  // 0030: a part payment, and a payment that came back. invoice.paid is the one that settles it.
  "payment.recorded", "payment.returned",
  // item 7: the firm's position on a statement. The office subscribes to both.
  "settlement.acknowledged", "settlement.disputed",
  // item 8 — S1's intake. Arc 1: a stranger becomes a signed account, and the
  // first half of that arc is an event OFC subscribes to. A lead that lands in
  // PROSPECT and is never looked at is the failure this topic exists to make
  // visible: the row is in the database either way, but only the event reaches
  // a board.
  "lead.captured", "call_record.logged",
  // the office turned a lead into a residential customer (leads.convert) — arc 1's second half.
  "lead.converted",
  // sync
  "sync.conflict_queued",
  // item 11 — purchasing. OFC hears the vendor; INV (S7) hears the office.
  "vendor.created", "vendor.updated", "receiving_point.set", "catalog_item.set",
  "vendor_price.proposed", "vendor_price.withdrawn", "vendor_price.decided",
  "po.created", "po.issued", "po.cancelled", "po.acknowledged", "po.shipped", "po.received",
  "vendor_invoice.submitted", "rma.requested", "rma.responded",
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

/**
 * What actually crosses the wire on NOTIFY and SSE. The NOTIFY payload cap is
 * 8000 bytes, so the relay publishes the envelope — identity, topic, tenancy,
 * time — and a subscriber that needs the payload fetches it by eventId. The
 * shell's subscribe() delivers this, not a DomainEvent, so a surface cannot
 * be written against a field that is never there.
 */
/**
 * What a subscriber receives. Entity, entity id and org are present for an
 * internal subscriber only: outside it they are other tenants' facts, and a
 * subscriber outside it refetches by topic, through row security.
 */
export type EventEnvelope = Pick<DomainEvent, "eventId" | "topic" | "regionId" | "occurredAt"> & Partial<Pick<DomainEvent, "entity" | "entityId" | "orgId">>;

/** Block subscriptions declared, not discovered. */
export const SUBSCRIBERS: Readonly<Record<"OFC" | "FLD" | "INV" | "WORKER", readonly Topic[]>> = {
  OFC: ["lead.captured", "lead.converted", "call_record.logged", "service_request.created", "service_request.photo_attached", "service_request.job_opened", "job.transitioned", "job.annotated", "job.message_posted", "job.completed", "sla.escalated", "sla.breached", "credential.expiring", "credential.expired", "crew.compliance_refused", "sync.conflict_queued", "contract.amended",
        // item 7: a firm's document arrived (to verify), a firm's position on a statement (to act on).
        "credential.recorded", "settlement.acknowledged", "settlement.disputed",
        // item 11: the vendor's side — a proposed price, an acknowledgement, a shipment, an invoice, an answer on a return.
        "vendor_price.proposed", "po.acknowledged", "po.shipped", "vendor_invoice.submitted", "rma.responded"],
  FLD: ["job.assigned", "job.reassigned", "job.cancelled", "contract.term_overridden"],
  // S8 learns of its own verification and its own price the same way S2 does — by refetch.
  INV: ["service_request.job_opened", "job.completed", "job.update_published", "job.message_posted", "contract.amended", "contract.term_overridden", "sla.breached", "settlement.statement_issued", "firm.status_changed", "credential.verified", "rate_card.changed", "brand.theme_set",
        // item 9: the site card's own facts.
        "equipment.registered", "account_contact.set", "invoice.issued",
        // 0030: what was paid against an invoice changes its status on the card.
        "invoice.paid", "invoice.voided", "payment.recorded", "payment.returned",
        // item 11: what S7 refetches on — the office issued, cancelled, received, decided a price, asked for a return.
        "po.issued", "po.cancelled", "po.received", "vendor_price.decided", "rma.requested"],
  WORKER: ["job.created", "job.assigned", "sla.timer_opened", "credential.verified"],
};
