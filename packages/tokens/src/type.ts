/**
 * THE TYPE SCHEDULE — Bulletin Plate 6. Four faces, four jobs. Nothing is set
 * in a face that has no job.
 *
 * One rule does most of the work: EVERY NUMBER IN THE COMPANY is set in the
 * instrument face with tabular figures. SLA timers, staleness clocks, job
 * numbers, gauge readings, invoice totals, tonnage, CFM. Digits that hold their
 * column are the entire effect.
 *
 * Which is why the faces cannot come from a CDN (errata E-05). The tier that
 * most depends on aligned digits is the tier least likely to have a network: a
 * technician on a roof, in an attic, in a basement mechanical room, inside a
 * customer's locked-down VLAN. When that request fails the instrument face
 * falls back to a proportional one, the SLA column stops aligning, and the one
 * rule above is gone — with no error, on the surface where being wrong costs
 * the most. It is the same argument as the staleness clock: the degraded state
 * is legible on purpose.
 *
 * So: self-host, subset, pin. `FACES[*].family` is served from our own origin
 * by `apps/<app>/dist/fonts/`; the fallbacks below are what the surface renders
 * with until it is, and are chosen so the column holds even if it never is —
 * every fallback in the instrument stack is genuinely monospaced on the
 * platforms the tablet ships on. `tools/ci/schema-guard.ts` fails any surface
 * that reaches a third-party font host, so E-05 cannot recur by accident.
 */
export type FaceRole = "display" | "engraved" | "text" | "instrument";

export type Face = {
  readonly role: FaceRole;
  /** What it is for. A face with no job does not appear in this table. */
  readonly job: string;
  /** The self-hosted family, once subset and pinned. */
  readonly family: string;
  /** The stack as it ships today — the family first, then faces that are actually installed. */
  readonly stack: string;
  /** `optional` on display and text: a slow load must never reflow a 56px tap target mid-press. */
  readonly display: "optional" | "swap";
};

export const FACES = Object.freeze({
  display: {
    role: "display", job: "Wordmark, plate titles, livery, buttons",
    family: "Rankine Display",
    stack: `"Rankine Display","Big Shoulders Display",Oswald,"Arial Narrow","Helvetica Neue Condensed",Impact,system-ui,sans-serif`,
    display: "optional",
  },
  engraved: {
    role: "engraved", job: "Descriptors, plate seals, the company line",
    family: "Rankine Engraved",
    stack: `"Rankine Engraved","Playfair Display",Didot,"Bodoni MT","Times New Roman",Georgia,serif`,
    display: "optional",
  },
  text: {
    role: "text", job: "Body copy, catalogue prose, contracts",
    family: "Rankine Text",
    stack: `"Rankine Text","Libre Baskerville",Georgia,"Times New Roman",Cambria,serif`,
    display: "optional",
  },
  instrument: {
    role: "instrument", job: "Every numeral in the company, without exception",
    family: "Rankine Instrument",
    stack: `"Rankine Instrument","Courier Prime",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace`,
    display: "swap",
  },
} as const satisfies Record<FaceRole, Face>);

export const FACE_ROLES = Object.freeze(Object.keys(FACES) as readonly FaceRole[]);

/**
 * The glyphs the trade actually needs, beyond Latin. A subset that drops these
 * renders a delta-T as a box on the one surface that exists to report it.
 */
export const SUBSET_GLYPHS = "°ΔΧ×±½¼¾′″₂";

/** Third-party hosts a surface must never fetch a face from. The guard reads this list. */
export const FORBIDDEN_FONT_HOSTS = Object.freeze([
  "fonts.googleapis.com", "fonts.gstatic.com", "use.typekit.net", "fonts.bunny.net",
  "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "fast.fonts.net",
]);
