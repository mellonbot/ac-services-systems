"""
Builds packages/tokens/fonts/ac-marks.woff2 — the five state marks IBM Plex never drew.

IBM Plex (Sans, Sans Condensed and Mono, every release pinned in the fonts README)
has no ● ▲ ▼ ■ ✕. Subsetting cannot keep a glyph the source never had, so until
this face existed the second channel — the marks that carry state when colour
fails — was drawn by whatever system font the fallback chain found (E-13).

These are plain geometric shapes drawn here, not copied from any font, so the
file carries no third-party licence. `fontFaceCss()` registers it under each
Plex family with a `unicode-range` naming only these five code points, so a
browser takes the marks from here and every other character from Plex.

Metrics match Plex exactly (1000 units/em, ascent 1025, descent 275, typo
780/-220/300) so a mark never changes a line's height, and every mark is 600
units wide — Plex Mono's advance — so a mark in a tabular column holds it.

Run from the repo root (needs fonttools and brotli: pip install fonttools brotli):

    python3 tools/fonts/build-marks.py

The output is deterministic: the head timestamps are fixed, so an unchanged
drawing rebuilds byte for byte.
"""
import math
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.t2CharStringPen import T2CharStringPen

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "tokens", "fonts", "ac-marks.woff2")

UPM = 1000
ADVANCE = 600          # Plex Mono's advance, so a mark never breaks a tabular column
CX, CY = 300, 340      # optical centre: mid-advance, a hair under half the 698 cap height
KAPPA = 0.5522847498   # cubic Bézier circle constant


def circle(pen, r):
    k = r * KAPPA
    pen.moveTo((CX + r, CY))
    pen.curveTo((CX + r, CY + k), (CX + k, CY + r), (CX, CY + r))
    pen.curveTo((CX - k, CY + r), (CX - r, CY + k), (CX - r, CY))
    pen.curveTo((CX - r, CY - k), (CX - k, CY - r), (CX, CY - r))
    pen.curveTo((CX + k, CY - r), (CX + r, CY - k), (CX + r, CY))
    pen.closePath()


def poly(pen, pts):
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


def bar(pen, a, b, t):
    """A bar of thickness t from a to b, drawn counter-clockwise."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    ox, oy = -dy / n * t / 2, dx / n * t / 2
    poly(pen, [(round(a[0] - ox), round(a[1] - oy)), (round(b[0] - ox), round(b[1] - oy)),
               (round(b[0] + ox), round(b[1] + oy)), (round(a[0] + ox), round(a[1] + oy))])


# Sizes are optical, not equal: a square reads larger than a circle of the same
# width and a triangle smaller, so each is cut to sit level with the others.
def draw_fault(pen):          # ■ U+25A0
    h = 235
    poly(pen, [(CX - h, CY - h), (CX + h, CY - h), (CX + h, CY + h), (CX - h, CY + h)])


def draw_ok(pen):             # ● U+25CF
    circle(pen, 262)


def draw_at_risk(pen):        # ▲ U+25B2
    poly(pen, [(CX - 285, CY - 240), (CX + 285, CY - 240), (CX, CY + 265)])


def draw_sort_desc(pen):      # ▼ U+25BC
    poly(pen, [(CX - 285, CY + 240), (CX, CY - 265), (CX + 285, CY + 240)])


def draw_blocked(pen):        # ✕ U+2715
    h, t = 225, 112
    bar(pen, (CX - h, CY - h), (CX + h, CY + h), t)
    bar(pen, (CX + h, CY - h), (CX - h, CY + h), t)


MARKS = [
    (0x25A0, "uni25A0", draw_fault),
    (0x25B2, "uni25B2", draw_at_risk),
    (0x25BC, "uni25BC", draw_sort_desc),
    (0x25CF, "uni25CF", draw_ok),
    (0x2715, "uni2715", draw_blocked),
]


def main():
    order = [".notdef"] + [name for _, name, _ in MARKS]
    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp: name for cp, name, _ in MARKS})

    charstrings, metrics = {}, {}
    empty = T2CharStringPen(ADVANCE, None)
    charstrings[".notdef"] = empty.getCharString()
    metrics[".notdef"] = (ADVANCE, 0)
    for _, name, draw in MARKS:
        pen = T2CharStringPen(ADVANCE, None)
        draw(pen)
        charstrings[name] = pen.getCharString()
    fb.setupCFF("ACMarks-Regular", {"FullName": "AC Marks Regular", "FamilyName": "AC Marks", "Weight": "Regular"}, charstrings, {})
    cff_glyphs = fb.font["CFF "].cff.topDictIndex[0].CharStrings
    for _, name, _ in MARKS:
        bounds = cff_glyphs[name].calcBounds(cff_glyphs)
        metrics[name] = (ADVANCE, round(bounds[0]))

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1025, descent=-275, lineGap=0)
    fb.setupNameTable({
        "familyName": "AC Marks",
        "styleName": "Regular",
        "uniqueFontIdentifier": "AC Marks Regular 1.000",
        "fullName": "AC Marks Regular",
        "psName": "ACMarks-Regular",
        "version": "Version 1.000",
        "copyright": "Drawn for ac-services-systems. Geometric state marks; no third-party outlines.",
    })
    fb.setupOS2(
        sTypoAscender=780, sTypoDescender=-220, sTypoLineGap=300,
        usWinAscent=1025, usWinDescent=275, sCapHeight=698, sxHeight=516,
        fsSelection=0x40, achVendID="RANK", usWeightClass=400,
        ulUnicodeRange1=0, ulCodePageRange1=1,
    )
    fb.setupPost(isFixedPitch=1)
    drawn = timestampFromString("Thu Oct 29 00:00:00 2026")  # fixed, so the build is reproducible
    fb.setupHead(unitsPerEm=UPM, created=drawn, modified=drawn)

    font = fb.font
    font.flavor = "woff2"
    font.save(os.path.normpath(OUT))
    print(f"wrote {os.path.normpath(OUT)} ({os.path.getsize(OUT)} bytes, {len(MARKS)} marks)")


if __name__ == "__main__":
    main()
