#!/bin/sh
# compose.sh <frames-dir> <out-dir> — the favicon from render.mjs's frames.
#
# Trims every frame to the volume the model sweeps (so it turns in place
# rather than jittering), sets it at 72% inside a radial glow of the livery
# red that is solid behind the model and fades to nothing well inside the
# square — no hard edge on any ground — and cuts:
#   favicon.png           32px animated PNG, the <link rel="icon">; Firefox plays it
#   favicon-strip.png     the same frames side by side, which packages/ui/src/favicon.ts cycles
#   apple-touch-icon.png  180px, frame 0, the glow on the page ground — iOS wants it opaque
#   mark-strip.png        96px frames side by side, transparent — the masthead mark, at 2x its 48px
# Needs ImageMagick 6, ffmpeg and node 22.
set -e
IN=$1; OUT=$2; PX=32; TOUCH=180; MARK=96
# The glow and the touch icon's ground come from packages/tokens, never typed
# here: FAVICON.glow (the livery red) and the light page ground, color.page.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
INKS=$(node --input-type=module -e '
  const { FAVICON } = await import(process.argv[1] + "/packages/tokens/src/brand.ts");
  const { SEMANTIC } = await import(process.argv[1] + "/packages/tokens/src/semantic.ts");
  console.log(FAVICON.glow ?? "", SEMANTIC["color.page"] ?? "");
' "$ROOT")
RED=${INKS% *}; PAGE=${INKS#* }
for v in "$RED" "$PAGE"; do
  case "$v" in \#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]) ;;
    *) echo "compose.sh: could not read the glow and page inks from packages/tokens (got '$INKS')" >&2; exit 1 ;;
  esac
done
T=$(mktemp -d)
G=$(convert "$IN"/*.png -background none -flatten -trim -format '%wx%h%O' info:)
W=$(echo $G | sed 's/x.*//'); H=$(echo $G | sed 's/^[0-9]*x\([0-9]*\).*/\1/'); [ $H -gt $W ] && W=$H
convert -size ${W}x${W} radial-gradient:white-black -level 0,42% -sigmoidal-contrast 3,50% $T/mask.png
convert -size ${W}x${W} xc:"$RED" $T/mask.png -alpha off -compose copy_opacity -composite $T/glow.png
mkdir -p $T/f $T/big $T/m
for f in "$IN"/*.png; do n=$(basename $f)
  convert $f -crop $G +repage -resize 72% -background none -gravity center -extent ${W}x${W} $T/u.png
  convert $T/glow.png $T/u.png -compose over -composite $T/big/$n
  convert $T/big/$n -filter Lanczos -resize ${PX}x${PX} $T/f/$n
  convert $T/big/$n -filter Lanczos -resize ${MARK}x${MARK} $T/m/$n
done
mkdir -p "$OUT"
convert $T/f/*.png +append +repage "$OUT"/favicon-strip.png
convert $T/m/*.png +append +repage "$OUT"/mark-strip.png
convert $T/big/f00.png -filter Lanczos -resize ${TOUCH}x${TOUCH} -background "$PAGE" -alpha remove -alpha off "$OUT"/apple-touch-icon.png
ffmpeg -loglevel error -y -framerate 16 -i $T/f/f%02d.png -vf format=rgba -pix_fmt rgba -plays 0 -f apng "$OUT"/favicon.png
rm -rf $T
