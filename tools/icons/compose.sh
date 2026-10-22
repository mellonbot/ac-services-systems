#!/bin/sh
# compose.sh <frames-dir> <out-dir> — the favicon from render.mjs's frames.
#
# Trims every frame to the volume the model sweeps (so it turns in place
# rather than jittering), sets it at 72% inside a radial glow of the livery
# red that is solid behind the model and fades to nothing well inside the
# square — no hard edge on any tab colour — and cuts 32px frames into:
#   favicon.png        animated PNG, the <link rel="icon">; Firefox plays it
#   favicon-strip.png  the same frames side by side, which packages/ui/src/favicon.ts cycles
# Needs ImageMagick 6 and ffmpeg.
set -e
IN=$1; OUT=$2; RED='#D91F11'; PX=32
T=$(mktemp -d)
G=$(convert "$IN"/*.png -background none -flatten -trim -format '%wx%h%O' info:)
W=$(echo $G | sed 's/x.*//'); H=$(echo $G | sed 's/^[0-9]*x\([0-9]*\).*/\1/'); [ $H -gt $W ] && W=$H
convert -size ${W}x${W} radial-gradient:white-black -level 0,42% -sigmoidal-contrast 3,50% $T/mask.png
convert -size ${W}x${W} xc:"$RED" $T/mask.png -alpha off -compose copy_opacity -composite $T/glow.png
mkdir -p $T/f
for f in "$IN"/*.png; do n=$(basename $f)
  convert $f -crop $G +repage -resize 72% -background none -gravity center -extent ${W}x${W} $T/u.png
  convert $T/glow.png $T/u.png -compose over -composite -filter Lanczos -resize ${PX}x${PX} $T/f/$n
done
mkdir -p "$OUT"
convert $T/f/*.png +append +repage "$OUT"/favicon-strip.png
ffmpeg -loglevel error -y -framerate 16 -i $T/f/f%02d.png -vf format=rgba -pix_fmt rgba -plays 0 -f apng "$OUT"/favicon.png
rm -rf $T
