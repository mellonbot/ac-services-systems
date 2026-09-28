/**
 * ITEM 10 — THE HQ METRIC REGISTER (S4).
 *
 * What Rankine's leadership reads, as data. The worker computes one value per
 * (metric, region, day) into `hq_metrics` (migration 0010); the gateway reads
 * that table and nothing else; S4 draws the screens FROM this list, so a new
 * figure is a row here plus its SQL in apps/worker/src/rollup.ts — and a unit
 * test fails until both exist.
 *
 * Every value is ADDITIVE across regions — a count or an integer sum of minor
 * units — so the company figure is the sum of the region rows and no screen
 * ever averages an average. A DISTINCT count is not additive (a customer served
 * in three regions is one customer), so a company-wide distinct figure is its
 * own key, written on the UNASSIGNED row alone and zero elsewhere: summing the
 * regions still gives the right answer. A rate (SLA met %) is derived on the screen from
 * two counts that are both here.
 *
 * `window` says what the number covers: `now` is the state at the rollup's
 * moment; `30d` is the thirty days ending then.
 */
export const HQ_AREAS = ["service", "money", "network", "growth"] as const;
export type HqArea = (typeof HQ_AREAS)[number];

export const HQ_AREA_TITLES: Readonly<Record<HqArea, string>> = {
  service: "Service & SLA",
  money: "Revenue & money",
  network: "Network & compliance",
  growth: "Growth & web",
};

export type HqUnit = "count" | "minor";
export type HqWindow = "now" | "30d";

export type HqMetric = {
  readonly area: HqArea;
  readonly label: string;
  readonly unit: HqUnit;
  readonly window: HqWindow;
  /** One sentence a board member can hold the number to. */
  readonly means: string;
};

export const HQ_METRICS = {
  // ---- service & SLA ----
  jobs_opened_30d: { area: "service", label: "Jobs opened", unit: "count", window: "30d", means: "Jobs opened in the thirty days, any state." },
  jobs_completed_30d: { area: "service", label: "Jobs completed", unit: "count", window: "30d", means: "Jobs that reached complete or invoiced, opened in the thirty days." },
  jobs_open_now: { area: "service", label: "Open jobs", unit: "count", window: "now", means: "Jobs not yet complete, invoiced, cancelled or aborted." },
  jobs_unassigned_now: { area: "service", label: "Unassigned", unit: "count", window: "now", means: "Open jobs with no crew holding them." },
  jobs_at_risk_now: { area: "service", label: "At risk", unit: "count", window: "now", means: "Open response clocks that have escalated or fall due within the hour." },
  sla_closed_30d: { area: "service", label: "Response clocks closed", unit: "count", window: "30d", means: "Response clocks opened in the thirty days that have been answered or have breached." },
  sla_met_30d: { area: "service", label: "Answered in time", unit: "count", window: "30d", means: "Of those, the ones answered by their due time." },
  sla_breached_30d: { area: "service", label: "Breached", unit: "count", window: "30d", means: "Response clocks opened in the thirty days that ran past due unanswered, or were answered late." },
  sla_escalated_30d: { area: "service", label: "Escalated", unit: "count", window: "30d", means: "Response clocks opened in the thirty days that reached any escalation stage." },

  // ---- revenue & money ----
  invoiced_minor_30d: { area: "money", label: "Invoiced", unit: "minor", window: "30d", means: "Invoice totals issued in the thirty days." },
  invoices_past_due_minor: { area: "money", label: "Past due date", unit: "minor", window: "now", means: "Issued invoices whose due date has passed. Payments are not recorded yet, so this is an upper bound on what is owed." },
  receivable_minor: { area: "money", label: "Receivable", unit: "minor", window: "now", means: "The latest working-capital position's receivable." },
  subcontractor_payable_minor: { area: "money", label: "Owed to firms", unit: "minor", window: "now", means: "The latest working-capital position's payable to subcontractor firms." },
  settlements_open_minor: { area: "money", label: "Statements unpaid", unit: "minor", window: "now", means: "Statements issued to firms and not yet paid, in any position." },
  settlements_overdue: { area: "money", label: "Statements past terms", unit: "count", window: "now", means: "Unpaid statements older than the firm's settlement terms (D13)." },
  settlements_disputed: { area: "money", label: "Statements in dispute", unit: "count", window: "now", means: "Statements a firm has disputed and the office has not yet answered." },

  // ---- network & compliance ----
  crews_active: { area: "network", label: "Active crews", unit: "count", window: "now", means: "Crews on a roster, ours and the firms'." },
  crews_subcontracted_active: { area: "network", label: "Subcontracted crews", unit: "count", window: "now", means: "Active crews that belong to a firm." },
  crews_cleared_now: { area: "network", label: "Cleared today", unit: "count", window: "now", means: "Active crews holding a verified, in-date document for every kind the gate requires." },
  min_crew_density: { area: "network", label: "Density rule (D14)", unit: "count", window: "now", means: "The fewest active crews the region must field before it takes a new location." },
  locations_active: { area: "network", label: "Locations served", unit: "count", window: "now", means: "Active customer locations in the region." },
  firms_active: { area: "network", label: "Active firms", unit: "count", window: "now", means: "Subcontractor firms dispatched from the region, status active." },
  firms_onboarding: { area: "network", label: "Firms onboarding", unit: "count", window: "now", means: "Firms recorded and not yet active." },
  credentials_unverified: { area: "network", label: "Documents awaiting verification", unit: "count", window: "now", means: "Documents on file for active crews that nobody at Rankine has verified." },
  credentials_expiring_30d: { area: "network", label: "Expiring in 30 days", unit: "count", window: "now", means: "Verified documents for active crews whose window ends in the next thirty days." },

  // ---- growth & web ----
  leads_30d: { area: "growth", label: "Leads", unit: "count", window: "30d", means: "People who asked us to call, from any source. They are not placed in a region until the office works them." },
  leads_web_form_30d: { area: "growth", label: "From the web form", unit: "count", window: "30d", means: "Leads from S1's form." },
  leads_call_button_30d: { area: "growth", label: "From the call button", unit: "count", window: "30d", means: "Leads from S1's call button." },
  leads_referral_30d: { area: "growth", label: "Referrals", unit: "count", window: "30d", means: "Leads recorded as referrals." },
  calls_inbound_30d: { area: "growth", label: "Inbound calls", unit: "count", window: "30d", means: "Calls recorded from the website's call button." },
  service_requests_30d: { area: "growth", label: "Service requests", unit: "count", window: "30d", means: "Requests customers raised in their portal (S6)." },
  customers_active: { area: "growth", label: "Customers in region", unit: "count", window: "now", means: "Customer organizations with an active node in the region. A customer served in three regions counts in each." },
  customers_new_30d: { area: "growth", label: "New in region", unit: "count", window: "30d", means: "Customer organizations recorded in the thirty days with a node in the region." },
  customers_total: { area: "growth", label: "Customers", unit: "count", window: "now", means: "Customer organizations with an active node anywhere, each counted once. Held on the unplaced row so the company figure is not a sum of regions." },
  customers_new_total_30d: { area: "growth", label: "New customers", unit: "count", window: "30d", means: "Customer organizations recorded in the thirty days, each counted once." },
  sites_active: { area: "growth", label: "Sites", unit: "count", window: "now", means: "Active customer sites in the region." },
} as const satisfies Record<string, HqMetric>;

export type HqMetricKey = keyof typeof HQ_METRICS;
export const HQ_METRIC_KEYS = Object.freeze(Object.keys(HQ_METRICS)) as readonly HqMetricKey[];
export const isHqMetricKey = (s: string): s is HqMetricKey => Object.hasOwn(HQ_METRICS, s);

/** Company-wide distinct figures: written on UNASSIGNED only, so a per-region view leaves them out. */
export const HQ_COMPANY_ONLY: readonly HqMetricKey[] = ["customers_total", "customers_new_total_30d"];

/** How often the worker refreshes. S4 calls a rollup older than twice this stale. */
export const HQ_REFRESH_MINUTES = 15;
