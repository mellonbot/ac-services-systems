import { html, mount, spinFavicon, signal, effect, createRouter, browserHistory, applyDegraded, PrimaryAction, RefusalCard, pageHead, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { admits, densityOf, seesManagerOverview, SURFACE_PATHS, type Refusal } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, type Store } from "./state.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { board } from "./screens/board.ts";
import { dispatch } from "./screens/dispatch.ts";
import { jobs } from "./screens/jobs.ts";
import { detail, pick } from "./screens/detail.ts";
import { intake } from "./screens/intake.ts";
import { newJob } from "./screens/new-job.ts";
import { manager } from "./screens/manager.ts";
import { previewDetail } from "./preview-detail.ts";
import { previewManagerOverview } from "./preview-manager.ts";
import { S3_CSS } from "./styles.ts";

/**
 * S3 — THE BROWSER ENTRY, mirroring S2's (`build-surface.ts` bundles this
 * file; `main.ts` beside it is the generated registry boot).
 *
 * Boot is identical in shape to S2's: resume the cookie session with
 * `session.me`; on a gone token, show login; login posts through the shell
 * in cookie mode. Then: router from SCREENS, degraded slot driven by
 * `shell.isDegraded()`, and event subscription — explicit topics, not the
 * OFC block default in SUBSCRIBERS, because that default (declared before
 * item 4 existed) does not yet include job.created/job.assigned; the fan-out
 * is by region regardless of which topics a surface asks for (the gateway's
 * events.stream handler), so naming the topics S3 actually needs here is
 * correct and is the same move S2's app.ts already makes for firm/crew
 * events C4 added after OFC's list was written.
 */
export const DENSITY = densityOf("S3");

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string; hostname: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host || "localhost";
  const hostname = doc.location.hostname || host.split(":")[0] || "localhost";
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.startsWith("127.")) {
    return "http://127.0.0.1:8080";
  }
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = {
  board,
  dispatch,
  jobs,
  detail,
  pick,
  intake,
  "new-job": newJob,
  manager,
};

type PreviewShell = ConnectedShell & {
  gateway: {
    listJobs: (input: Record<string, unknown>) => Promise<{ jobs: unknown[] }>;
    listServiceRequests: (input: Record<string, unknown>) => Promise<{ requests: unknown[] }>;
    getMedia: (input: { id: string }) => Promise<{ id: string; contentType: string; image: string }>;
    openServiceRequestJob: (input: { requestId: string; serviceCode: string; priority?: string; serviceWindowStart: string; serviceWindowEnd: string }) => Promise<unknown>;
    listSites: () => Promise<{ sites: unknown[] }>;
    createJob: (input: { siteId: string; serviceCode: string; priority?: string; serviceWindowStart: string; serviceWindowEnd: string }) => Promise<unknown>;
    transitionJob: (input: { jobId: string; to: string }) => Promise<unknown>;
    addJobNote: (input: { jobId: string; body: string; kind?: "note" | "standing" }) => Promise<unknown>;
    jobDetail: (input: { jobId: string }) => Promise<unknown>;
    saveJobUpdate: (input: { jobId: string; body: string; updateId?: string; sourceNoteId?: string }) => Promise<unknown>;
    publishJobUpdate: (input: { updateId: string }) => Promise<unknown>;
    postJobMessage: (input: { jobId: string; body: string }) => Promise<unknown>;
    setReturnTrip: (input: { jobId: string; returnTrip: boolean }) => Promise<unknown>;
    managerOverview: () => Promise<unknown>;
    health: () => Promise<{ ok: boolean }>;
  };
};

type Phase = { kind: "booting" } | { kind: "login"; refusal: Refusal | null; busy: boolean } | { kind: "ready"; shell: ConnectedShell; store: Store } | { kind: "preview"; shell: PreviewShell; store: Store };

const DAY = 86_400_000;
const PREVIEW_PLACES: Readonly<Record<string, { line1: string; city: string; state: string; postal: string }>> = {
  "Shipman Co": { line1: "1200 S Main St", city: "Crowley", state: "TX", postal: "76036" },
  "FirstKey Homes DFW": { line1: "7310 Glenview Dr", city: "Richland Hills", state: "TX", postal: "76118" },
  "FirstKey": { line1: "7310 Glenview Dr", city: "Richland Hills", state: "TX", postal: "76118" },
  "Turner Res.": { line1: "905 Hidden Creek Pkwy", city: "Burleson", state: "TX", postal: "76028" },
  "Meridian Plaza": { line1: "4500 Mercantile Dr", city: "Fort Worth", state: "TX", postal: "76137" },
};
/** Today at a fractional hour — a preview service window the board's 7 AM–5 PM grid can place. */
const todayAt = (hour: number): number => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() + hour * 3_600_000; };
const previewJob = (id: string, siteName: string, serviceCode: string, priority: string, state: string, crew: string | null, daysOpen: number, sla: { due: number; stage: number } | null, daysInState = daysOpen, window?: readonly [number, number]) => {
  const opened = Date.now() - daysOpen * DAY;
  return {
    id, siteId: `site-${id}`, siteName, siteAddress: PREVIEW_PLACES[siteName] ?? null, stateChangedAt: new Date(Date.now() - daysInState * DAY).toISOString(), contractId: null, projectId: null, serviceCode, priority, state,
    serviceWindowStart: new Date(window ? todayAt(window[0]) : opened).toISOString(), serviceWindowEnd: new Date(window ? todayAt(window[1]) : opened + DAY).toISOString(), version: 1, openedAt: new Date(opened).toISOString(),
    regionId: "region-preview", orgId: "org-preview",
    currentCrewId: crew ? `crew-${crew.toLowerCase().replace(/\s+/g, "-")}` : null, currentCrewLabel: crew, currentAssignmentId: crew ? `assignment-${id}` : null,
    slaDueAt: sla ? new Date(Date.now() + sla.due * 3_600_000).toISOString() : null, slaEscalationStage: sla ? sla.stage : null, slaSatisfiedAt: null,
    returnTrip: false, latestNote: null as { body: string; at: string } | null,
  };
};
/** Notes and return-trip flags for the preview, in the dashboard mock's words. */
const PREVIEW_NOTES: Readonly<Record<string, { body: string; daysAgo: number; returnTrip?: boolean }>> = {
  "33187801": { body: "Return trip — not cooling, customer wants a call before the tech rolls", daysAgo: 3, returnTrip: true },
  "33187837": { body: "Freon leak at suction line, found before evap coil", daysAgo: 6, returnTrip: true },
  "33187839": { body: "Burning plastic smell reported, needs same-day call back", daysAgo: 2 },
  "32925428": { body: "High priority — possible bad thermostat, replacement on the truck", daysAgo: 1 },
  "33200310": { body: "Condenser install — pick up at the shop, Bradley to approve price", daysAgo: 4 },
  "33200206": { body: "Trim materials, locking caps and drain pipe priced — waiting on supply", daysAgo: 5 },
  "32452900": { body: "New construction — ready to invoice, awaiting final walk", daysAgo: 1 },
};
/** Local preview only — the same job, site and crew names the board's preview rows use, spread across every bucket the dashboard draws. */
const PREVIEW_JOBS = [
  previewJob("33390928", "Shipman Co", "rooftop_install", "urgent", "assigned", "Blake Keating", 2, { due: -2, stage: 2 }, 1, [9.2, 11.6]),
  previewJob("33390251", "FirstKey", "repairs", "urgent", "en_route", "Brian Martinez", 1, { due: 1, stage: 1 }, 1, [7.7, 9.9]),
  previewJob("33390971", "Turner Res.", "pm_route", "pm", "on_site", "Colton Dawson", 0, { due: 4, stage: 0 }, 0, [8.3, 9.9]),
  previewJob("33390937", "Meridian Plaza", "new_install", "urgent", "in_progress", "Dylan Lemons", 3, null, 3, [8.2, 10.1]),
  previewJob("33390948", "Shipman Co", "rtu_changeout", "urgent", "assigned", "Herberto Vega", 1, { due: -1, stage: 2 }, 1, [9.6, 11.4]),
  previewJob("33187801", "Shipman Co", "repairs", "urgent", "reopened", "Garrett Howard", 58, { due: -30, stage: 3 }, 41),
  previewJob("33187837", "Shipman Co", "repairs", "routine", "awaiting_parts", "Garrett Howard", 40, null, 36),
  previewJob("32925428", "FirstKey Homes DFW", "repairs", "urgent", "created", null, 18, { due: -6, stage: 2 }),
  previewJob("33200204", "Shipman Co", "new_install", "routine", "reassigned", null, 15, { due: 6, stage: 1 }),
  previewJob("33187839", "Shipman Co", "repairs", "emergency", "complete", "Garrett Howard", 33, null, 29),
  previewJob("32452900", "Shipman Co", "new_install", "routine", "complete", "Garrett Howard", 12, null, 6),
  previewJob("33200206", "Shipman Co", "repairs", "routine", "awaiting_parts", "Johnny Fontez", 21, null, 14),
  previewJob("33200310", "Shipman Co", "condenser_install", "routine", "quote_requested", null, 9, null, 4),
  previewJob("33200318", "FirstKey Homes DFW", "repairs", "routine", "quote_requested", null, 7, null, 7),
  previewJob("33200322", "Turner Res.", "new_install", "routine", "quote_submitted", null, 16, null, 11),
  previewJob("33200329", "Meridian Plaza", "rtu_changeout", "urgent", "quote_submitted", null, 6, null, 3),
  previewJob("33390962", "Shipman Co", "repairs", "urgent", "awaiting_customer", "Herberto Vega", 5, null, 2),
  previewJob("33187720", "Shipman Co", "repairs", "urgent", "needs_pricing", "Garrett Howard", 30, null, 22),
  previewJob("33187744", "Shipman Co", "rtu_changeout", "routine", "needs_pricing", "Herberto Vega", 19, null, 9),
  previewJob("33187760", "FirstKey Homes DFW", "repairs", "routine", "awaiting_po", "Brian Martinez", 27, null, 24),
  previewJob("33187775", "Meridian Plaza", "new_install", "routine", "awaiting_pictures", "Dylan Lemons", 11, null, 5),
  previewJob("32100155", "Turner Res.", "pm_route", "pm", "invoice_trouble", "Colton Dawson", 48, null, 13),
  previewJob("32100114", "Turner Res.", "pm_route", "pm", "invoiced", "Colton Dawson", 60, null),
  previewJob("32100171", "Meridian Plaza", "repairs", "routine", "invoiced", "Dylan Lemons", 52, null),
  previewJob("32100190", "FirstKey Homes DFW", "repairs", "routine", "cancelled", null, 45, null),
];

for (const job of PREVIEW_JOBS) {
  const n = PREVIEW_NOTES[job.id];
  if (n) Object.assign(job, { latestNote: { body: n.body, at: new Date(Date.now() - n.daysAgo * DAY).toISOString() }, returnTrip: n.returnTrip ?? false });
}

/** Local preview only — what customers asked for, in the same sites the preview jobs use; one request is already a job. */
const PREVIEW_PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAeUlEQVR4nAXBIRYAERQAQKdzgI2CJAkTPflnTxQkR92ZlIuvqEUvRhHFLm6RcvM1tenNaKLZzW1S5qPSGQSbS8rTN9WpT2OKaU93Sjl8oYYeRoiwww0pL99Sl76MJZa93CXl4zvq0Y9xxLGPe6T8fE99+jOeePZznx9uyFbBTUcGaQAAAABJRU5ErkJggg==";
const previewRequest = (n: number, siteName: string, priority: "emergency" | "urgent" | "routine", description: string, hoursAgo: number, photos: number, jobId: string | null = null) => ({
  id: `5e${String(n).padStart(6, "0")}-0000-4000-8000-000000000000`, siteId: `site-${n}`, siteName, priority, description, requestedBy: "preview-customer",
  createdAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), jobId, jobState: jobId ? PREVIEW_JOBS.find((j) => j.id === jobId)?.state ?? null : null,
  orgId: "org-preview", regionId: "region-preview",
  photos: Array.from({ length: photos }, (_, i) => ({ id: `p${n}-${i}`, contentType: "image/png", bytes: 68 })),
});
const PREVIEW_REQUESTS = [
  previewRequest(1, "Shipman Co", "urgent", "No cooling — server closet unit isn't keeping up; temp alarm went off twice overnight.", 2, 2),
  previewRequest(2, "Meridian Plaza", "emergency", "Water coming through the ceiling tiles under the rooftop unit on the 3rd floor.", 0.5, 3),
  previewRequest(3, "Turner Res.", "routine", "Routine maintenance — filter change due on both units.\nPreferred date: next Tuesday.", 26, 0),
  previewRequest(4, "FirstKey Homes DFW", "urgent", "Noise / smell — burning plastic smell from the return vent.", 50, 1, "33187839"),
];

const createPreviewShell = (): PreviewShell => {
  const shell = {
    principal: { namespace: "internal", subjectId: "preview", orgId: "org-preview", regionId: "region-preview", scopeTier: "parent", scopeId: "org-preview", roles: ["dispatcher", "ops_leadership"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "preview-session" },
    context: { principal: { namespace: "internal", subjectId: "preview", orgId: "org-preview", regionId: "region-preview", scopeTier: "parent", scopeId: "org-preview", roles: ["dispatcher", "ops_leadership"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "preview-session" }, path: [{ tier: "parent", id: "org-preview", name: "AC Services" }], parent: { tier: "parent", id: "org-preview", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: "region-preview" },
    gateway: {
      listJobs: async () => ({ jobs: PREVIEW_JOBS }),
      listServiceRequests: async () => ({ requests: PREVIEW_REQUESTS }),
      getMedia: async (input: { id: string }) => ({ id: input.id, contentType: "image/png", image: PREVIEW_PHOTO }),
      openServiceRequestJob: async (input: { requestId: string; serviceCode: string; priority?: string; serviceWindowStart: string; serviceWindowEnd: string }) => {
        const r = PREVIEW_REQUESTS.find((x) => x.id === input.requestId)!;
        const job = previewJob(String(33400000 + PREVIEW_JOBS.length), r.siteName, input.serviceCode, input.priority ?? r.priority, "created", null, 0, { due: 4, stage: 0 });
        Object.assign(job, { serviceWindowStart: input.serviceWindowStart, serviceWindowEnd: input.serviceWindowEnd });
        PREVIEW_JOBS.push(job);
        Object.assign(r, { jobId: job.id, jobState: "created" });
        return { id: job.id, orgId: job.orgId, regionId: job.regionId, slaTimerId: `t-${job.id}`, dueAt: job.slaDueAt, responseTerm: "4_hour", requestId: r.id };
      },
      listSites: async () => ({ sites: Object.entries(PREVIEW_PLACES).map(([name, a]) => ({ id: `site-${name}`, name, orgId: "org-preview", orgName: "AC Services", regionId: "region-preview", address: a })) }),
      createJob: async (input: { siteId: string; serviceCode: string; priority?: string; serviceWindowStart: string; serviceWindowEnd: string }) => {
        const job = previewJob(String(33400000 + PREVIEW_JOBS.length), input.siteId.replace(/^site-/, ""), input.serviceCode, input.priority ?? "routine", "created", null, 0, { due: 4, stage: 0 });
        Object.assign(job, { serviceWindowStart: input.serviceWindowStart, serviceWindowEnd: input.serviceWindowEnd });
        PREVIEW_JOBS.push(job);
        return { id: job.id, orgId: job.orgId, regionId: job.regionId, slaTimerId: `t-${job.id}`, dueAt: job.slaDueAt, responseTerm: "4_hour", eventId: `e-${job.id}` };
      },
      managerOverview: async () => previewManagerOverview(),
      addJobNote: async (input: { jobId: string; body: string; kind?: "note" | "standing" }) => {
        const job = PREVIEW_JOBS.find((j) => j.id === input.jobId)!;
        const at = new Date().toISOString();
        if (input.kind !== "standing") Object.assign(job, { latestNote: { body: input.body, at } });
        previewDetail(job).notes.push({ id: `n-${at}`, body: input.body, kind: input.kind ?? "note", at, authorName: "Dana" });
        return { id: `n-${at}`, jobId: input.jobId, eventId: "preview" };
      },
      jobDetail: async (input: { jobId: string }) => {
        const job = PREVIEW_JOBS.find((j) => j.id === input.jobId);
        if (!job) throw new Error(`job ${input.jobId} not found in scope`);
        return { ...previewDetail(job), job };
      },
      saveJobUpdate: async (input: { jobId: string; body: string; updateId?: string; sourceNoteId?: string }) => {
        const d = previewDetail(PREVIEW_JOBS.find((j) => j.id === input.jobId)!);
        const at = new Date().toISOString();
        const existing = input.updateId ? d.updates.find((u) => u.id === input.updateId) : undefined;
        if (existing) Object.assign(existing, { body: input.body, updatedAt: at });
        else d.updates.push({ id: `u-${at}`, sourceNoteId: input.sourceNoteId ?? null, body: input.body, state: "draft", updatedAt: at, publishedAt: null, publishedByName: null });
        return { id: existing?.id ?? `u-${at}`, state: "draft", eventId: "preview" };
      },
      publishJobUpdate: async (input: { updateId: string }) => {
        for (const job of PREVIEW_JOBS) {
          const u = previewDetail(job).updates.find((x) => x.id === input.updateId);
          if (u) { const at = new Date().toISOString(); Object.assign(u, { state: "published", publishedAt: at, updatedAt: at, publishedByName: "Dana" }); return { id: u.id, publishedAt: at, eventId: "preview" }; }
        }
        throw new Error("unknown update");
      },
      postJobMessage: async (input: { jobId: string; body: string }) => {
        const at = new Date().toISOString();
        previewDetail(PREVIEW_JOBS.find((j) => j.id === input.jobId)!).messages.push({ id: `m-${at}`, authorKind: "office", authorName: "Dana", body: input.body, at });
        return { id: `m-${at}`, authorKind: "office", eventId: "preview" };
      },
      setReturnTrip: async (input: { jobId: string; returnTrip: boolean }) => {
        Object.assign(PREVIEW_JOBS.find((j) => j.id === input.jobId)!, { returnTrip: input.returnTrip });
        return { jobId: input.jobId, returnTrip: input.returnTrip, eventId: "preview" };
      },
      transitionJob: async (input: { jobId: string; to: string }) => {
        const job = PREVIEW_JOBS.find((j) => j.id === input.jobId)!;
        Object.assign(job, { state: input.to, version: job.version + 1, stateChangedAt: new Date().toISOString() });
        return { jobId: job.id, state: job.state, version: job.version, eventId: "preview" };
      },
      health: async () => ({ ok: true }),
    },
    refusalOf: (e: unknown) => ({ kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) }),
    isDegraded: () => false,
    subscribe: () => () => {},
    logout: async () => {},
  } as unknown as PreviewShell;
  return shell;
};

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window }) => {
  const now = opts.now ?? (() => Date.now());
  const phase = signal<Phase>({ kind: "booting" });
  const degraded = signal(false);
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window, SURFACE_PATHS.S3) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  const become = (shell: ConnectedShell) => {
    const store = createStore(shell, now);
    phase.value = { kind: "ready", shell, store };
    const at = router.current.value;
    if (!at || at.screen === "login") router.navigate("board", {});
    // Envelopes carry no payload; refetch what the event touched (09 §3.5).
    // Every one of these is a reason the board itself could be stale — a new
    // job, an assignment made or released from elsewhere, a state a
    // technician's own device pushed, or the cascade escalating a timer —
    // and the dry run is invalidated with it because a credential event can
    // change what candidateCrews would say about a crew already on screen.
    shell.subscribe(() => {
      store.invalidate("jobs.list");
      store.invalidate("jobs.detail");
      store.invalidate("dispatch.candidates");
      store.invalidate("serviceRequests.list");
      store.invalidate("manager.overview");
    }, { topics: [
      // a customer asked, or sent a photo with what they asked (Intake)
      "service_request.created", "service_request.photo_attached", "service_request.job_opened",
      "job.created", "job.assigned", "job.reassigned", "job.transitioned", "job.completed", "job.cancelled", "job.annotated",
      "job.update_published", "job.message_posted",
      "sla.timer_opened", "sla.escalated", "sla.breached", "sla.satisfied",
      "crew.compliance_refused", "credential.verified", "credential.expiring", "credential.expired",
    ] });
  };

  const login = async (email: string, password: string) => {
    phase.value = { kind: "login", refusal: null, busy: true };
    try { become(await connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: { email, password, session: "cookie" } })); }
    catch (e) { phase.value = { kind: "login", refusal: refusalOf(e), busy: false }; }
  };

  const boot = async () => {
    const localPreview = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test((new URL(opts.baseUrl, "http://localhost")).hostname) || opts.baseUrl === "http://127.0.0.1:8080";
    if (localPreview) {
      const shell = createPreviewShell();
      const store = createStore(shell, now);
      phase.value = { kind: "preview", shell, store };
      router.navigate("board", {});
      return;
    }
    try { become(await connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: { session: "cookie" } })); }
    catch (e) {
      const r = refusalOf(e);
      phase.value = { kind: "login", refusal: r.kind === "token" ? null : r, busy: false };
    }
  };

  const logout = async () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    try { await p.shell.logout(); } finally { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("board", {}); }
  };

  /** Poll the flag the transport writes; while degraded, probe health so recovery is noticed without a click (09 §3.9). */
  const tick = () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    degraded.value = p.shell.isDegraded();
  };
  let lastProbe = 0;
  const probe = () => {
    const p = phase.value;
    if (p.kind !== "ready" || !degraded.value) return;
    if (now() - lastProbe < 15_000) return;
    lastProbe = now();
    p.shell.gateway.health().catch(() => {});
  };

  /** The job the Job Detail tab returns to — the last one opened, until another is. */
  let lastDetail: string | null = null;
  const view = (): VNode => {
    const p = phase.value;
    if (p.kind === "booting") return html`<p class="s3-loading" role="status">Connecting…</p>`;
    if (p.kind === "login") return loginView(p, login);
    const ctx: ScreenContext = { shell: p.shell, store: p.store, router, density: DENSITY, degraded: degraded.value };
    void p.store.version.value; // subscribe: an invalidate re-renders the mounted screen, which re-reads its resources
    const loc = router.current.value;
    if (loc?.screen === "detail" && loc.params.jobId) lastDetail = loc.params.jobId;
    const screen = loc && loc.screen !== "login" ? SCREEN_VIEWS[loc.screen] : null;
    const notice = p.store.notice.value;
    return html`<div class="s3-app">
      <header class="dispatch-header" data-ground="plate">
        <nav class="ac-seg" aria-label="Dispatch navigation">
          <a class="ac-seg__item" href=${router.href("board", {})}
             data-current=${loc?.screen === "board" ? "true" : undefined}
             aria-current=${loc?.screen === "board" ? "page" : undefined}
             onClick=${(e: Event) => { e.preventDefault(); router.navigate("board", {}); }}>Dispatch Board</a>
          <a class="ac-seg__item" href=${lastDetail ? router.href("detail", { jobId: lastDetail }) : router.href("pick", {})}
             data-current=${loc?.screen === "detail" || loc?.screen === "pick" ? "true" : undefined}
             aria-current=${loc?.screen === "detail" || loc?.screen === "pick" ? "page" : undefined}
             onClick=${(e: Event) => { e.preventDefault(); if (lastDetail) router.navigate("detail", { jobId: lastDetail }); else router.navigate("pick", {}); }}>Job Detail</a>
          <a class="ac-seg__item" href=${router.href("intake", {})}
             data-current=${loc?.screen === "intake" ? "true" : undefined}
             aria-current=${loc?.screen === "intake" ? "page" : undefined}
             onClick=${(e: Event) => { e.preventDefault(); router.navigate("intake", {}); }}>Intake</a>
          <a class="ac-seg__item" href=${router.href("jobs", {})}
             data-current=${loc?.screen === "jobs" ? "true" : undefined}
             aria-current=${loc?.screen === "jobs" ? "page" : undefined}
             onClick=${(e: Event) => { e.preventDefault(); router.navigate("jobs", {}); }}>Job Dashboard</a>
          ${seesManagerOverview(p.shell.principal) ? html`<a class="ac-seg__item" href=${router.href("manager", {})}
             data-current=${loc?.screen === "manager" ? "true" : undefined}
             aria-current=${loc?.screen === "manager" ? "page" : undefined}
             onClick=${(e: Event) => { e.preventDefault(); router.navigate("manager", {}); }}>Manager</a>` : null}
        </nav>
        <div class="dispatch-header__tools">
          <span class="dispatch-header__who">${p.shell.principal.roles.join(", ")} · ${p.shell.context?.parent.name ?? ""}</span>
          <button type="button" class="dispatch-header__logout" onClick=${logout}>Sign out</button>
        </div>
      </header>
      <div class="dispatch-actions">
        ${PrimaryAction({ density: DENSITY, label: "New customer", kind: "quiet", id: "new-customer",
          // Customers are an S2 write (organizations.create); S3 hands off to that screen.
          ...(admits("S2", p.shell.principal) ? {} : { disabledReason: "Customers are created in Service Manager, which your role cannot open." }),
          onClick: () => opts.window?.location.assign(`${SURFACE_PATHS.S2}/organizations/new`) })}
        ${PrimaryAction({ density: DENSITY, label: "New job", id: "new-job", onClick: () => router.navigate("new-job", {}) })}
      </div>
      ${notice.length ? html`<div class="s3-notice" role="status">${notice.map((n) => html`<p>${n}</p>`)}<button type="button" class="s3-notice__dismiss" onClick=${() => { p.store.notice.value = []; }} aria-label="Dismiss">×</button></div>` : null}
      ${screen ? screen(ctx, loc!.params) : html`<p class="s3-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
    </div>`;
  };

  return { phase, degraded, router, view, boot, login, logout, tick, probe };
};

const refusalOf = (e: unknown): Refusal =>
  (e as { refusal?: Refusal })?.refusal ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) };

export const loginView = (p: { refusal: Refusal | null; busy: boolean }, login: (email: string, password: string) => void): VNode => {
  const submit = (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    login(String(f.get("email") ?? ""), String(f.get("password") ?? ""));
  };
  return html`<section class="s3-login">
    ${pageHead(SURFACE.name, "Sign in to open your region's dispatch board.")}
    <form class="ac-form" onSubmit=${submit} id="login-form">
      <label class="ac-field"><span>Email</span><input class="ac-input" name="email" type="email" required autocomplete="username" /></label>
      <label class="ac-field"><span>Password</span><input class="ac-input" name="password" type="password" required autocomplete="current-password" /></label>
      ${PrimaryAction({ density: DENSITY, label: p.busy ? "Signing in…" : "Sign in", type: "submit", id: "sign-in" })}
    </form>
    ${p.refusal ? RefusalCard({ density: DENSITY, refusal: p.refusal }) : null}
  </section>`;
};

// ---------------------------------------------------------------------------
// Browser entry. Guarded so the module is importable under node --test.
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && document.getElementById("mount")) {
  const style = document.createElement("style");
  style.textContent = S3_CSS;
  document.head.appendChild(style);

  const app = createApp({ baseUrl: gatewayOrigin(document), fetch: globalThis.fetch.bind(globalThis), window });
  const el = document.getElementById("mount")!;
  const slot = document.querySelector("ac-degraded") as (HTMLElement | null);
  const Root = () => app.view();
  mount(html`<${Root} />`, el);
  spinFavicon(document);
  effect(() => {
    if (!slot) return;
    const p = app.phase.value;
    const lastOkAt = p.kind === "ready" ? p.store.lastOkAt.value : null;
    applyDegraded(slot, { degraded: app.degraded.value, text: SURFACE.degradedNotice, lastOkAt, now: Date.now() });
  });
  app.router.start();
  setInterval(() => { app.tick(); app.probe(); }, 1000);
  void app.boot();
}
