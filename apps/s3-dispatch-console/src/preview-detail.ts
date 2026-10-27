import type { JobContactWire, JobMediaWire, JobMessageWire, JobNoteWire, JobUpdateWire, JobVisitWire, JobWrapUpWire } from "../../../packages/contracts/src/index.ts";

/**
 * Local preview only: what jobs.detail would return for the preview board's
 * jobs. One job (33187801, Shipman Co) carries the reference layout's history
 * — several visits, labelled photos, a published update, a draft, a thread —
 * so the page can be looked at without a database. Every other job gets the
 * visit its crew implies and the note the dashboard already shows.
 */
type PreviewJob = { id: string; openedAt: string; siteName: string | null; currentCrewLabel: string | null; currentAssignmentId: string | null; currentCrewId: string | null; latestNote: { body: string; at: string } | null };
export type PreviewDetail = {
  contact: JobContactWire | null;
  visits: JobVisitWire[]; media: JobMediaWire[]; notes: JobNoteWire[]; updates: JobUpdateWire[]; messages: JobMessageWire[];
  wrapUp: JobWrapUpWire | null;
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const at = (daysAgo: number, hour = 9) => new Date(new Date(Date.now() - daysAgo * DAY).setHours(hour, 0, 0, 0)).toISOString();
const plus = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * HOUR).toISOString();

const CONTACTS: Readonly<Record<string, JobContactWire>> = {
  "Shipman Co": { name: "Brian Duncan", phone: "(817) 851-4319", email: null },
  "FirstKey Homes DFW": { name: "Alexis Moreno", phone: "(817) 555-0188", email: null },
  "Turner Res.": { name: "Dana Turner", phone: "(817) 555-0123", email: null },
  "Meridian Plaza": { name: "Front desk", phone: "(817) 555-0110", email: null },
};

const featured = (): Omit<PreviewDetail, "contact" | "wrapUp"> => {
  const v1 = at(58, 8), v2 = at(52, 9), v3 = at(41, 10), v4 = at(9, 8);
  const media = (id: string, label: string, key: string, when: string): JobMediaWire => ({ id, kind: "photo", storageKey: `jobs/33187801/${key}.jpg`, label, capturedAt: when });
  return {
    visits: [
      { id: "a1", crewId: "c-bm", crewLabel: "Brian Martinez", assignedAt: plus(v1, -1), releasedAt: plus(v1, 4), workStart: v1, workEnd: plus(v1, 3.5) },
      { id: "a2", crewId: "c-jf", crewLabel: "Johnny Fontez", assignedAt: plus(v2, -1), releasedAt: plus(v2, 6), workStart: v2, workEnd: plus(v2, 5) },
      { id: "a3", crewId: "c-bm", crewLabel: "Brian Martinez", assignedAt: plus(v2, -1), releasedAt: plus(v2, 6), workStart: v2, workEnd: plus(v2, 5) },
      { id: "a4", crewId: "c-hv", crewLabel: "Herberto Vega", assignedAt: plus(v3, -1), releasedAt: plus(v3, 3), workStart: v3, workEnd: plus(v3, 2) },
      { id: "a5", crewId: "c-gh", crewLabel: "Garrett Howard", assignedAt: plus(v4, -1), releasedAt: plus(v4, 4), workStart: v4, workEnd: plus(v4, 3) },
    ],
    media: [
      media("p1", "Nameplate", "IMG_2481", plus(v1, 0.5)), media("p2", "Before", "IMG_2482", plus(v1, 0.6)),
      media("p3", "Readings", "IMG_2483", plus(v1, 2)), media("p4", "Signature", "IMG_2484", plus(v1, 3.4)),
      media("p5", "Filter — before", "IMG_2601", plus(v2, 0.5)), media("p6", "Filter — after", "IMG_2602", plus(v2, 1)),
      media("p7", "Coil", "IMG_2603", plus(v2, 1.5)),
      ...[4, 5, 6, 7, 8, 9].map((n) => media(`p${n + 4}`, "Coil", `IMG_260${n}`, plus(v2, 2 + n / 10))),
      media("p14", "Capacitor", "IMG_2714", plus(v3, 0.5)), media("p15", "Amp draw", "IMG_2715", plus(v3, 1)),
      media("p16", "Suction line", "IMG_2902", plus(v4, 1)),
    ],
    notes: [
      { id: "n0", body: "New system on the roof. Spring PM with filters on the job description — check the unit nameplate before quoting anything.", kind: "standing", at: plus(v1, -24), authorName: "Dana" },
      { id: "n1", body: "Start up — new rooftop unit commissioned, baseline readings logged, customer signed off.", kind: "note", at: plus(v1, 3.4), authorName: "Brian Martinez" },
      { id: "n2", body: "HVAC clean and check on all systems with filter change. Kids' building reported not cooling — flagged for follow-up.", kind: "note", at: plus(v2, 4.5), authorName: "Johnny Fontez" },
      { id: "n3", body: "Run cap failed on the condenser. Fan motor also weak — recommend replacing both before summer. Customer has pushed back on repair costs before.", kind: "note", at: plus(v3, 1.5), authorName: "Herberto Vega" },
      { id: "n4", body: "Facility manager was short with the crew on site. Check with Dana before quoting the fan motor.", kind: "note", at: plus(v3, 1.8), authorName: "Herberto Vega" },
      { id: "n5", body: "Return trip — not cooling, customer wants a call before the tech rolls.", kind: "note", at: plus(v4, 3), authorName: "Garrett Howard" },
    ],
    updates: [
      { id: "u1", sourceNoteId: "n3", body: "Technician found a failed run capacitor. Part ordered, expected Thursday.", state: "published", updatedAt: plus(v3, 5), publishedAt: plus(v3, 5), publishedByName: "Dana" },
      { id: "u2", sourceNoteId: "n5", body: "The unit is still not cooling. A technician will call you before returning to site.", state: "draft", updatedAt: plus(v4, 4), publishedAt: null, publishedByName: null },
    ],
    messages: [
      { id: "m1", authorKind: "customer", authorName: "Brian Duncan", body: "Can we get it done before the Friday inspection?", at: plus(v4, 5) },
      { id: "m2", authorKind: "office", authorName: "Dana", body: "Yes — holding Thursday morning for you.", at: plus(v4, 5.3) },
    ],
  };
};

const cache = new Map<string, PreviewDetail>();
export const previewDetail = (job: PreviewJob): PreviewDetail => {
  let d = cache.get(job.id);
  if (d) return d;
  const contact = (job.siteName && CONTACTS[job.siteName]) || null;
  if (job.id === "33187801") d = { contact, ...featured(), wrapUp: null };
  else {
    const start = new Date(Math.max(Date.parse(job.openedAt) + DAY, Date.now() - 2 * DAY)).toISOString();
    d = {
      contact,
      visits: job.currentCrewLabel ? [{ id: job.currentAssignmentId ?? `a-${job.id}`, crewId: job.currentCrewId ?? "", crewLabel: job.currentCrewLabel, assignedAt: start, releasedAt: null, workStart: null, workEnd: null }] : [],
      media: [],
      notes: job.latestNote ? [{ id: `n-${job.id}`, body: job.latestNote.body, kind: "note", at: job.latestNote.at, authorName: "Dana" }] : [],
      updates: [], messages: [], wrapUp: null,
    };
  }
  cache.set(job.id, d);
  return d;
};
