/**
 * THE TYPE SCHEDULE — Bulletin No. 2, Plates 06 and 08. Five roles, four
 * working faces, and one face that is a mark rather than a typeface.
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
 * by `apps/<app>/dist/fonts/`; the fallbacks are what a surface renders with
 * until it is, and are chosen so the column holds even if it never is — every
 * fallback in the instrument stack is genuinely monospaced on the platforms the
 * tablet ships on. `tools/ci/schema-guard.ts` fails any surface that reaches a
 * third-party font host, so E-05 cannot recur by accident.
 */
export type FaceRole = "wordmark" | "display" | "label" | "text" | "instrument";

export type Face = {
  readonly role: FaceRole;
  /** What it is for. A face with no job does not appear in this table. */
  readonly job: string;
  /** The self-hosted family, once subset and pinned. */
  readonly family: string;
  /** The stack as it ships today — the family first, then faces that are actually installed. */
  readonly stack: string;
  /** `optional` everywhere a slow load must never reflow a 56px tap target mid-press. */
  readonly display: "optional" | "swap";
  /**
   * Smallest size the face may be set at, in px. Only the script has one, and
   * it is the reason the badge exists — see WORDMARK_FLOOR.
   */
  readonly minSize?: number;
};

export const FACES = Object.freeze({
  /**
   * THE WORDMARK IS NOT A TYPEFACE. It is a mark that happens to be made of
   * letters, it appears once per surface in the masthead, and it never sets an
   * interface — a dispatch board in script is unreadable at 13px.
   *
   * The reference is the sign-painter's script of the early American works: the
   * hand of the trade on the outside, the instrument on the inside.
   */
  wordmark: {
    role: "wordmark", job: "The masthead lockup, and nothing else",
    family: "Yellowtail",
    stack: `Yellowtail,"Brush Script MT","Snell Roundhand","Apple Chancery",cursive`,
    display: "optional", minSize: 28,
  },
  display: {
    role: "display", job: "Plate titles, buttons, headings",
    family: "IBM Plex Sans Condensed",
    stack: `"IBM Plex Sans Condensed","Helvetica Neue Condensed","Arial Narrow",system-ui,sans-serif`,
    display: "optional",
  },
  label: {
    role: "label", job: "Descriptors, eyebrows, the company line — set in caps at +0.14em and up",
    family: "IBM Plex Sans",
    stack: `"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`,
    display: "optional",
  },
  text: {
    role: "text", job: "Body copy, prose, contracts",
    family: "IBM Plex Sans",
    stack: `"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`,
    display: "optional",
  },
  instrument: {
    role: "instrument", job: "Every numeral in the company, without exception",
    family: "IBM Plex Mono",
    stack: `"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace`,
    display: "swap",
  },
} as const satisfies Record<FaceRole, Face>);

export const FACE_ROLES = Object.freeze(Object.keys(FACES) as readonly FaceRole[]);

/**
 * THE MARKS THE COMPONENT SET DRAWS. Named here rather than typed into six
 * templates, for the same reason a colour is a role: these five characters are
 * the second channel the whole state schedule rests on (Form R-4 — the rule
 * carries shape, the FILL carries salience, the word carries meaning), and the
 * channel cannot be load-bearing in one file and a literal in another.
 *
 * A component importing a mark from here is also what makes the subset below
 * checkable: css.test.ts asserts every one of these is in it.
 */
export const MARK_GLYPHS = Object.freeze({
  /** Solid — a fault. The degraded rule, the refusal head, the breached chip. */
  fault: "■",
  /** Outline-mute — on track, and the cleared compliance gate. */
  ok: "●",
  /** Outline — at risk. */
  atRisk: "▲",
  /** Blocked, and the compliance gate that did not clear. */
  blocked: "✕",
  sortAsc: "▲",
  sortDesc: "▼",
});

/**
 * The script's size floor, and the reason the system carries two marks.
 *
 * Bulletin No. 1 required ONE artwork for every substrate — truck lettering,
 * embroidery, single-colour silkscreen, an anodised faceplate and a 16px
 * favicon. A connected script fails the small end of that list: the joins close
 * up in thread, and below this size the word is a smear. That is a real
 * regression, recorded rather than hidden, and it is affordable only because
 * the °R badge already does the small work (see brand.ts).
 */
export const WORDMARK_FLOOR = 28;

/**
 * The glyphs the trade actually needs, beyond Latin. A subset that drops these
 * renders a delta-T as a box on the one surface that exists to report it.
 *
 * The geometric marks are in it for a harder reason than the degree sign. The
 * plate ground encodes state in FORM because hue has stopped working there, and
 * form is drawn with ● ▲ ■ ✕. A subset cut to the published list dropped all four,
 * so the fallback chain decided what the second channel looked like — different
 * face, different metrics, tofu on a locked-down tablet. The channel that exists
 * for the case where colour fails cannot itself depend on a font that loaded.
 */
export const SUBSET_GLYPHS = "°ΔΧ×±½¼¾′″₂" + "●▲▼■✕";

/** Third-party hosts a surface must never fetch a face from. The guard reads this list. */
export const FORBIDDEN_FONT_HOSTS = Object.freeze([
  "fonts.googleapis.com", "fonts.gstatic.com", "use.typekit.net", "fonts.bunny.net",
  "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "fast.fonts.net",
]);
