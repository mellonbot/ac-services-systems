#!/bin/sh
# compose.sh <frames-dir> <out-dir> — the favicon from render.mjs's frames.
#
# Trims every frame to the volume the model sweeps (so it turns in place
# rather than jittering), sets it at 80% on a solid livery-red square — the
# badge's own ground and shape — and cuts:
#   favicon.png           32px animated PNG, the <link rel="icon">; Firefox plays it
#   favicon-strip.png     the same frames side by side, which packages/ui/src/favicon.ts cycles
#   apple-touch-icon.png  180px, frame 0, opaque — iOS draws a letter tile without one
#   mark-strip.png        80px frames side by side — the masthead mark, at 2x its 40px
# Needs ImageMagick 6 and ffmpeg.
set -e
IN=$1; OUT=$2; RED='#D91F11'; PX=32; TOUCH=180; MARK=80
T=$(mktemp -d)
G=$(convert "$IN"/*.png -background none -flatten -trim -format '%wx%h%O' info:)
W=$(echo $G | sed 's/x.*//'); H=$(echo $G | sed 's/^[0-9]*x\([0-9]*\).*/\1/'); [ $H -gt $W ] && W=$H
convert -size ${W}x${W} xc:"$RED" $T/tile.png
mkdir -p $T/f $T/big $T/m
for f in "$IN"/*.png; do n=$(basename $f)
  convert $f -crop $G +repage -resize 80% -background none -gravity center -extent ${W}x${W} $T/u.png
  convert $T/tile.png $T/u.png -compose over -composite $T/big/$n
  convert $T/big/$n -filter Lanczos -resize ${PX}x${PX} $T/f/$n
  convert $T/big/$n -filter Lanczos -resize ${MARK}x${MARK} $T/m/$n
done
mkdir -p "$OUT"
convert $T/f/*.png +append +repage "$OUT"/favicon-strip.png
convert $T/m/*.png +append +repage -alpha remove -alpha off "$OUT"/mark-strip.png
convert $T/big/f00.png -filter Lanczos -resize ${TOUCH}x${TOUCH} -alpha remove -alpha off "$OUT"/apple-touch-icon.png
ffmpeg -loglevel error -y -framerate 16 -i $T/f/f%02d.png -vf format=rgba -pix_fmt rgba -plays 0 -f apng "$OUT"/favicon.png
rm -rf $T
