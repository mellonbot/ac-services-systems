import { signal } from "../../../../packages/ui/src/index.ts";
import { FIELD_CLOSED_STATES, WORK_DONE_STATES, serviceLabel, type CustomerSegment, type JobWire, type OrganizationWire } from "../../../../packages/contracts/src/index.ts";

/**
 * FINDING A CUSTOMER — the Accounts list's search box and Filter menu.
 *
 * The office is rarely asked for a customer by name alone. "The rooftop job on
 * Main St", "whoever is owed a return trip", "the house in 76109" — so the
 * search reads the customer's jobs as well as its name: the site, the street,
 * the city, the ZIP, the service and the job's own id. Every word typed must
 * be found, either all in the customer's name or all in one of its jobs; when
 * it is a job that matched, the row says which, so the office can tell why a
 * customer it did not name is on the list.
 *
 * The Filter menu narrows by what the work says: open work, a return trip
 * owed, served lately, never served, or one kind of service.
 *
 * Nothing here fetches: it reads the customer list and jobs.list, both already
 * in the store.
 */
export type StatusFilter = "any" | "active" | "inactive";
export type WorkFilter = "any" | "open" | "return_trip" | "recent" | "never";
export type Find = { readonly q: string; readonly status: StatusFilter; readonly work: WorkFilter; readonly service: string };
export const NO_FIND: Find = Object.freeze({ q: "", status: "any", work: "any", service: "" });

export const STATUS_WORD: Readonly<Record<StatusFilter, string>> = { any: "Any status", active: "Active", inactive: "Inactive" };
export const WORK_WORD: Readonly<Record<WorkFilter, string>> = {
  any: "Any work", open: "Has open work", return_trip: "Return trip owed", recent: "Served in the last 90 days", never: "Never served",
};
/** "Served lately" — long enough to cover a season's maintenance round. */
export const RECENT_DAYS = 90;

export const finding = signal<Find>(NO_FIND);
export const setFind = (patch: Partial<Find>) => { finding.value = { ...finding.value, ...patch }; };
export const clearFind = () => { finding.value = NO_FIND; };
/** How many menu filters are set — the count on the Filter button. The search box is its own control and not counted. */
export const filterCount = (f: Find): number => (f.status !== "any" ? 1 : 0) + (f.work !== "any" ? 1 : 0) + (f.service ? 1 : 0);

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const jobText = (j: JobWire) => [
  j.id, j.siteName, j.siteAddress?.line1, j.siteAddress?.city, j.siteAddress?.state, j.siteAddress?.postal, serviceLabel(j.serviceCode), j.serviceCode,
].filter(Boolean).join(" ").toLowerCase();

export type Found = {
  readonly org: OrganizationWire;
  /** The job the search found this customer by, when it was not the name. */
  readonly via: JobWire | null;
};

/** The service codes on file, for the menu's Service list, by label. */
export const servicesOnFile = (jobs: readonly JobWire[]): readonly { readonly code: string; readonly label: string }[] =>
  [...new Set(jobs.map((j) => j.serviceCode))].map((code) => ({ code, label: serviceLabel(code) })).sort((a, b) => a.label.localeCompare(b.label));

export const findCustomers = (
  orgs: readonly OrganizationWire[], jobs: readonly JobWire[] | null, f: Find, segment: "all" | CustomerSegment, now: number,
): readonly Found[] => {
  const byOrg = new Map<string, JobWire[]>();
  for (const j of jobs ?? []) { const arr = byOrg.get(j.orgId) ?? []; arr.push(j); byOrg.set(j.orgId, arr); }
  const q = words(f.q);
  const since = now - RECENT_DAYS * 86_400_000;
  const out: Found[] = [];
  for (const org of orgs) {
    if (segment !== "all" && org.segment !== segment) continue;
    if (f.status === "active" && !org.active) continue;
    if (f.status === "inactive" && org.active) continue;
    const own = byOrg.get(org.id) ?? [];
    // Until jobs are read, a work or service filter cannot be answered — it shows nobody rather than everybody.
    if ((f.work !== "any" || f.service) && jobs === null) continue;
    if (f.work === "open" && !own.some((j) => !FIELD_CLOSED_STATES.includes(j.state))) continue;
    if (f.work === "return_trip" && !own.some((j) => j.returnTrip)) continue;
    if (f.work === "recent" && !own.some((j) => WORK_DONE_STATES.includes(j.state) && Date.parse(j.serviceWindowEnd) >= since)) continue;
    if (f.work === "never" && own.some((j) => WORK_DONE_STATES.includes(j.state))) continue;
    if (f.service && !own.some((j) => j.serviceCode === f.service)) continue;
    if (!q.length) { out.push({ org, via: null }); continue; }
    const name = [org.name, org.externalRef].filter(Boolean).join(" ").toLowerCase();
    if (q.every((w) => name.includes(w))) { out.push({ org, via: null }); continue; }
    // Newest first, so the job named is the one most likely meant.
    const via = [...own].sort((a, b) => Date.parse(b.serviceWindowEnd) - Date.parse(a.serviceWindowEnd))
      .find((j) => { const t = `${name} ${jobText(j)}`; return q.every((w) => t.includes(w)); });
    if (via) out.push({ org, via });
  }
  return out;
};
