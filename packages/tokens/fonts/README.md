# Self-hosted faces (errata E-05)

Subset and pinned. `tools/ci/build-surface.ts` copies these to every surface's
`dist/fonts/`; `fontFaceCss()` in `../src/type.ts` declares them.

| File | Source |
|---|---|
| `plex-sans-{400,600,700}.woff2` | `@ibm/plex-sans@1.1.0` `fonts/complete/woff2/IBMPlexSans-{Regular,SemiBold,Bold}.woff2` |
| `plex-sans-condensed-{600,700}.woff2` | `@ibm/plex-sans-condensed@2.0.0` `fonts/complete/woff2/IBMPlexSansCondensed-{SemiBold,Bold}.woff2` |
| `plex-mono-{400,600}.woff2` | `@ibm/plex-mono@2.5.0` `fonts/complete/woff2/IBMPlexMono-{Regular,SemiBold}.woff2` |
| `yellowtail-400.woff2` | `@fontsource/yellowtail@5.3.0` `files/yellowtail-latin-400-normal.woff2` |
| `ac-marks.woff2` | Drawn here: `python3 tools/fonts/build-marks.py` |

IBM Plex is under the SIL Open Font License 1.1 (`OFL-IBM-Plex.txt`). Yellowtail
is under the Apache License 2.0 (`LICENSE-Yellowtail.txt`). `ac-marks.woff2` is
this repository's own drawing — five geometric shapes, no third-party outlines.

## The marks (errata E-13)

IBM Plex has no `● ▲ ▼ ■ ✕` in any release — Sans, Sans Condensed or Mono — so
the subset below cannot carry them however the unicode list is written.
`ac-marks.woff2` supplies them. `fontFaceCss()` declares it under each Plex
family with a `unicode-range` naming only those five code points, so the browser
takes the marks from it and every other character from Plex. It shares Plex's
vertical metrics and every mark is 600 units wide, Plex Mono's advance.
`../src/fonts.test.ts` reads the shipped files and fails if any Plex family is
left with a mark no shipped face draws.

Plex Mono also has no `Δ` or `Χ`; no surface sets either in the instrument face
today.

Regenerate with fonttools (`pip install fonttools brotli`):

```sh
pyftsubset <source.woff2> --flavor=woff2 \
  --layout-features='kern,liga,tnum,lnum,case' \
  --unicodes='U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2010-2027,U+2030-203A,U+20AC,U+2122,U+2190-2193,U+2212,U+0394,U+03A7,U+2032,U+2033,U+2082,U+25CF,U+25B2,U+25BC,U+25A0,U+2715' \
  --output-file=<file>
```

The unicode list is Latin-1, the punctuation the copy uses, and `SUBSET_GLYPHS`.
