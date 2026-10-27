import { operationalTable } from "../tenancy.ts";

/** Foreman tier: multi-day, multi-location. Requests and releases crews through dispatch. */
export const projects = operationalTable("projects", {
  columns: [
    { name: "contract_id", type: "uuid", references: "contracts(id)" },
    { name: "name", type: "text" },
    { name: "foreman_id", type: "uuid", nullable: true, references: "users(id)" },
    { name: "service_window", type: "tstzrange" },
    { name: "state", type: "text", check: "state IN ('planned','active','closed','cancelled')", default: "'planned'" },
  ],
  indexes: [["contract_id"], ["foreman_id"]],
});

export const JOB_STATES = [
  "created", "assigned", "en_route", "on_site", "in_progress", "awaiting_parts",
  "complete", "reopened", "invoiced", "cancelled", "aborted",
  // 0013: waiting on the customer — a quote before dispatch, an approval or access mid-job.
  "quote_requested", "quote_submitted", "awaiting_customer",
  // 0014: the work is done but the invoice is blocked — pricing, a PO, pictures, or a kicked-back invoice.
  "needs_pricing", "awaiting_po", "awaiting_pictures", "invoice_trouble",
] as const;

/** 0024. Mirrored by JOB_WORK_CLASSES in packages/contracts; a test holds them equal. */
export const JOB_WORK_CLASSES = ["service", "install", "commissioning"] as const;

export const jobs = operationalTable("jobs", {
  columns: [
    { name: "site_id", type: "uuid", references: "accounts(id)", comment: "Work happens at a site. The location, region and parent are its ancestors." },
    { name: "contract_id", type: "uuid", nullable: true, references: "contracts(id)" },
    { name: "project_id", type: "uuid", nullable: true, references: "projects(id)" },
    { name: "service_code", type: "text", references: "service_codes(code)", comment: "0025: a code in the service catalogue; its work class is the job's." },
    { name: "priority", type: "text", check: "priority IN ('emergency','urgent','routine','pm')", default: "'routine'" },
    { name: "service_window", type: "tstzrange", comment: "The gate evaluates the WHOLE window, not the instant of assignment." },
    { name: "state", type: "text", check: `state IN (${JOB_STATES.map((s) => `'${s}'`).join(",")})`, default: "'created'" },
    { name: "version", type: "integer", default: "1", comment: "Optimistic version the sync engine compares against." },
    { name: "opened_at", type: "timestamptz", default: "now()" },
    { name: "return_trip", type: "boolean", default: "false", comment: "0015: a second visit is owed on this job. The office's flag, set by hand — not read out of the notes." },
    {
      name: "work_class", type: "text", check: `work_class IN (${JOB_WORK_CLASSES.map((w) => `'${w}'`).join(",")})`, default: "'service'",
      comment: "0024: install goes to an install crew; service and commissioning go to a technician.",
    },
    {
      name: "job_no", type: "text",
      comment: "0030: what people read — REGION-YYMM-SEQ-CHECK. Assigned at insert, never changed. The id is still what everything references.",
    },
  ],
  indexes: [["site_id"], ["state"], ["project_id"], ["contract_id"]],
  uniques: [["job_no"]],
  constraints: [
    { name: "jobs_install_sits_under_a_project", sql: "CHECK (work_class <> 'install' OR project_id IS NOT NULL)" },
    { name: "jobs_install_is_never_an_emergency", sql: "CHECK (work_class <> 'install' OR priority <> 'emergency')" },
  ],
});

/**
 * 0030: the next job number, one row per region per month. Written only by
 * ac_take_job_seq(); the runtime roles hold no privilege on it.
 */
export const job_number_counters = operationalTable("job_number_counters", {
  columns: [
    { name: "month", type: "text", check: "month ~ '^[0-9]{4}$'", comment: "YYMM, in the region's timezone." },
    { name: "last_seq", type: "integer", comment: "Starts at a random 1000–4999 each month, so a number does not tell a customer the month's volume." },
  ],
  uniques: [["region_id", "month"]],
});

/**
 * The evaluator's output, recorded. Three layers of the gate: the type covers
 * application code, the trigger covers everything else, and this row covers
 * the subrogation conversation afterwards.
 */
export const compliance_clearances = operationalTable("compliance_clearances", {
  columns: [
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    { name: "service_window", type: "tstzrange" },
    { name: "credential_ids", type: "jsonb", comment: "Exactly which documents cleared it, frozen at evaluation." },
    { name: "evaluated_at", type: "timestamptz" },
    { name: "evaluated_by", type: "uuid" },
  ],
  indexes: [["crew_id"]],
});

/**
 * SERVER-AUTHORITATIVE. An offline device holds intent, never an assignment —
 * which is what stops an offline device routing around the compliance gate
 * (non-negotiable #6 meeting non-negotiable #8). Written by S3 only.
 */
export const assignments = operationalTable("assignments", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    {
      name: "clearance_id", type: "uuid", references: "compliance_clearances(id)",
      comment: "NOT NULL, and a trigger re-verifies the clearance covers the job window for this crew.",
    },
    { name: "assigned_by", type: "uuid" },
    { name: "assigned_at", type: "timestamptz", default: "now()" },
    { name: "released_at", type: "timestamptz", nullable: true },
    { name: "release_reason", type: "text", nullable: true },
  ],
  indexes: [["job_id"], ["crew_id"]],
});

/**
 * The append-only record of every job transition. `mutation_id` is client
 * generated (offline replay is idempotent by construction); UNIQUE per job.
 */
export const job_state_events = operationalTable("job_state_events", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "from_state", type: "text", nullable: true },
    { name: "to_state", type: "text" },
    { name: "actor_id", type: "uuid" },
    { name: "surface_id", type: "text" },
    { name: "mutation_id", type: "text" },
    { name: "occurred_at", type: "timestamptz" },
    { name: "recorded_at", type: "timestamptz", default: "now()" },
  ],
  indexes: [["job_id", "occurred_at"]],
  uniques: [["job_id", "mutation_id"]],
});

/** Field artefacts — append-only under sync. */
/**
 * 0015: what the office writes down about a job — append-only, internal
 * only, tenancy inherited from the job. The dashboard shows the latest; the
 * rest is the history of who said what, when.
 */
export const job_notes = operationalTable("job_notes", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "body", type: "text", check: "length(btrim(body)) BETWEEN 1 AND 2000" },
    { name: "author_id", type: "uuid" },
    { name: "kind", type: "text", check: "kind IN ('note','standing')", default: "'note'", comment: "0016: 'standing' is what every tech should know before rolling; the newest one is the job's standing note." },
  ],
  indexes: [["job_id", "created_at"]],
});

/**
 * 0016: what the customer is told. Dispatch writes it — usually from an
 * internal note — as a draft no customer can read, and publishes it. A
 * published update is never edited again.
 */
export const job_updates = operationalTable("job_updates", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "source_note_id", type: "uuid", nullable: true, references: "job_notes(id)" },
    { name: "body", type: "text", check: "length(btrim(body)) BETWEEN 1 AND 2000" },
    { name: "state", type: "text", check: "state IN ('draft','published')", default: "'draft'" },
    { name: "author_id", type: "uuid" },
    { name: "updated_at", type: "timestamptz", default: "now()" },
    { name: "published_at", type: "timestamptz", nullable: true },
    { name: "published_by", type: "uuid", nullable: true },
  ],
  indexes: [["job_id", "created_at"]],
  constraints: [{ name: "job_updates_published_is_stamped", sql: "CHECK ((state = 'published') = (published_at IS NOT NULL AND published_by IS NOT NULL))" }],
});

/** 0016: the customer ↔ dispatch thread on a job. Append-only; who wrote it is the writer's namespace, not a field they choose. */
export const job_messages = operationalTable("job_messages", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "author_kind", type: "text", check: "author_kind IN ('customer','office')" },
    { name: "author_id", type: "uuid" },
    { name: "body", type: "text", check: "length(btrim(body)) BETWEEN 1 AND 2000" },
  ],
  indexes: [["job_id", "created_at"]],
});

export const job_media = operationalTable("job_media", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "storage_key", type: "text" },
    { name: "kind", type: "text", check: "kind IN ('photo','diagnostic_capture','signature','document')" },
    { name: "captured_at", type: "timestamptz" },
    { name: "captured_by", type: "uuid" },
    { name: "mutation_id", type: "text" },
    { name: "meta", type: "jsonb", nullable: true },
  ],
  indexes: [["job_id"]],
  uniques: [["job_id", "mutation_id"]],
});

export const time_entries = operationalTable("time_entries", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    { name: "span", type: "tstzrange" },
    { name: "kind", type: "text", check: "kind IN ('travel','labor','wait')" },
    { name: "mutation_id", type: "text" },
  ],
  indexes: [["job_id"], ["crew_id"]],
  uniques: [["job_id", "mutation_id"]],
});

/**
 * 0033 — a technician's shift clock: one row per clock-in or clock-out, never
 * edited and never deleted. Payroll time, not job time: time_entries costs a
 * job, this pays a person, and a crew clocks in before its first job and
 * keeps the clock running between jobs. The timesheet pairs each in with the
 * next out; a wrong punch is answered by the office, not by rewriting this.
 */
export const shift_punches = operationalTable("shift_punches", {
  columns: [
    { name: "grant_id", type: "uuid", references: "device_grants(id)", comment: "The shift this punch was made on — and the device, crew and technician with it." },
    { name: "technician_id", type: "uuid", references: "users(id)" },
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    { name: "kind", type: "text", check: "kind IN ('in','out')" },
    { name: "punched_at", type: "timestamptz", comment: "The device's clock at the tap — the tablet may have been offline for hours before it synced." },
    { name: "mutation_id", type: "text" },
  ],
  indexes: [["technician_id", "punched_at"], ["grant_id"]],
  uniques: [["grant_id", "mutation_id"]],
});

/** Checklist responses — device-authoritative under sync (the tech was standing in front of it). */
export const checklist_items = operationalTable("checklist_items", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "item_key", type: "text" },
    { name: "response", type: "jsonb" },
    { name: "answered_at", type: "timestamptz" },
    { name: "answered_by", type: "uuid" },
    { name: "version", type: "integer", default: "1" },
  ],
  indexes: [["job_id"]],
  uniques: [["job_id", "item_key"]],
});

export const parts_used = operationalTable("parts_used", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "part_sku", type: "text" },
    { name: "quantity_milli", type: "bigint" },
    { name: "source", type: "text", check: "source IN ('truck','location_stock','regional_hub','national')" },
    { name: "mutation_id", type: "text" },
  ],
  indexes: [["job_id"]],
  uniques: [["job_id", "mutation_id"]],
});

/** Immutable decision log. Office manager resolves routine; principal resolves high value. */
export const warranty_cases = operationalTable("warranty_cases", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "equipment_id", type: "uuid", nullable: true, references: "equipment(id)" },
    { name: "claimed_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "state", type: "text", check: "state IN ('open','approved','denied','escalated')", default: "'open'" },
    { name: "decided_by", type: "uuid", nullable: true },
    { name: "decided_at", type: "timestamptz", nullable: true },
    { name: "decision_note", type: "text", nullable: true },
  ],
  indexes: [["job_id"], ["state"]],
});
