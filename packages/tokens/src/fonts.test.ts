import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { FACES, FONT_FILES, MARK_FONT, MARK_GLYPHS, fontFaceCss } from "./type.ts";

/**
 * E-13, measured against the files rather than a string.
 *
 * The first test of the marks asserted they were in SUBSET_GLYPHS — the list
 * handed to the subsetter — and passed while not one shipped face drew them:
 * IBM Plex has no ● ▲ ▼ ■ ✕ in any release, so the subsetter had nothing to
 * keep and the second channel came from the system's fallback font. These tests
 * open the woff2 files and read their character maps.
 */
const FONTS = new URL("../fonts/", import.meta.url);

// The 63 table tags WOFF2 encodes by index (W3C WOFF2 §5.1). Only the order matters here.
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/** The decompressed tables of a single-font WOFF2 file, by tag. cmap and hhea are never transformed. */
function woff2Tables(file: string): Map<string, Buffer> {
  const buf = readFileSync(new URL(file, FONTS));
  assert.equal(buf.toString("latin1", 0, 4), "wOF2", `${file} is not a WOFF2 file`);
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  let p = 48;
  const base128 = (): number => {
    let v = 0;
    for (let i = 0; i < 5; i++) { const b = buf[p++]!; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; }
    throw new Error(`${file}: bad UIntBase128`);
  };
  const dir: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++]!;
    const tag = (flags & 0x3f) === 63 ? buf.toString("latin1", p, (p += 4)) : KNOWN_TAGS[flags & 0x3f]!;
    const version = (flags >> 6) & 3;
    const orig = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(p, p + compressedSize));
  const tables = new Map<string, Buffer>();
  let off = 0;
  for (const t of dir) { tables.set(t.tag, data.subarray(off, off + t.length)); off += t.length; }
  return tables;
}

/** Every code point the font maps to a real glyph (cmap formats 4 and 12). */
function covered(file: string): Set<number> {
  const cmap = woff2Tables(file).get("cmap")!;
  const out = new Set<number>();
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const sub = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(sub);
    if (format === 12) {
      const groups = cmap.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        const [start, end, glyph] = [cmap.readUInt32BE(at), cmap.readUInt32BE(at + 4), cmap.readUInt32BE(at + 8)];
        for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
      }
    } else if (format === 4) {
      const seg = cmap.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
      for (let s = 0; s < seg; s++) {
        const end = cmap.readUInt16BE(ends + s * 2), start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2), range = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph = range === 0 ? c : cmap.readUInt16BE(ranges + s * 2 + range + (c - start) * 2);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          if (glyph !== 0) out.add(c);
        }
      }
    }
  }
  return out;
}

/** The faces fontFaceCss() declares: family, file, and the code points its unicode-range admits (null: all). */
function declaredFaces(): { family: string; file: string; range: Set<number> | null }[] {
  return [...fontFaceCss().matchAll(/@font-face\{([^}]*)\}/g)].map(([, body]) => {
    const family = /font-family:"([^"]+)"/.exec(body!)![1]!;
    const file = /url\("fonts\/([^"]+)"\)/.exec(body!)![1]!;
    const ur = /unicode-range:([^;]+)/.exec(body!);
    const range = ur ? new Set(ur[1]!.split(",").map((u) => parseInt(u.trim().slice(2), 16))) : null;
    return { family, file, range };
  });
}

const MARKS = [...new Set(Object.values(MARK_GLYPHS))];
const MARK_FAMILIES = [FACES.display.family, FACES.text.family, FACES.instrument.family];

test("every font file the sheets declare is shipped", () => {
  for (const f of [...FONT_FILES.map((x) => x.file), MARK_FONT.file])
    assert.ok(existsSync(new URL(f, FONTS)), `packages/tokens/fonts/${f} is missing`);
});

test("every mark is drawn by a shipped face of every Plex family — E-13, against the files", () => {
  const faces = declaredFaces();
  const cache = new Map<string, Set<number>>();
  const cmapOf = (file: string): Set<number> => cache.get(file) ?? cache.set(file, covered(file)).get(file)!;
  for (const family of MARK_FAMILIES)
    for (const mark of MARKS) {
      const cp = mark.codePointAt(0)!;
      const drawnBy = faces.filter((f) => f.family === family && (f.range === null || f.range.has(cp)) && cmapOf(f.file).has(cp));
      assert.ok(drawnBy.length > 0, `"${family}" has no shipped face that draws ${mark} (U+${cp.toString(16).toUpperCase()}): the fallback chain would draw the second channel`);
    }
});

test("the marks face is admitted for the marks and nothing else", () => {
  const marksCmap = covered(MARK_FONT.file);
  for (const mark of MARKS) assert.ok(marksCmap.has(mark.codePointAt(0)!), `${MARK_FONT.file} does not draw ${mark}`);
  for (const f of declaredFaces().filter((x) => x.file === MARK_FONT.file)) {
    assert.ok(f.range, `the marks face under "${f.family}" has no unicode-range, so it would claim every character`);
    assert.deepEqual([...f.range].sort(), MARKS.map((m) => m.codePointAt(0)!).sort(), `the marks face under "${f.family}" admits other code points`);
  }
});

test("a mark never changes a line's height: the marks face has Plex's vertical metrics", () => {
  const hhea = (file: string): [number, number] => { const t = woff2Tables(file).get("hhea")!; return [t.readInt16BE(4), t.readInt16BE(6)]; };
  const plex = FONT_FILES.filter((f) => f.family !== FACES.wordmark.family).map((f) => hhea(f.file));
  for (const m of plex) assert.deepEqual(m, plex[0], "the Plex faces disagree with each other");
  assert.deepEqual(hhea(MARK_FONT.file), plex[0], "ac-marks.woff2 ascent/descent differ from Plex");
});
