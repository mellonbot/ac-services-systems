/**
 * The worker. Everything that must happen without a user present:
 *
 *  - outbox relay (at-least-once, idempotent consumers)
 *  - credential expiry sweep — the one that emails a firm 30/14/7 days before
 *    an insurance certificate lapses, because the alternative is discovering it
 *    at assignment on the morning it matters
 *  - SLA cascade — timers derived from the RESOLVED contract per site
 *  - warehouse rollups for S4 (Phase 2)
 *
 * It runs as ac_worker, which holds INSERT+SELECT on audit_log like the gateway
 * and no more.
 */
export const JOBS = ["outbox_relay", "credential_expiry_sweep", "sla_cascade", "warehouse_rollup"] as const;
