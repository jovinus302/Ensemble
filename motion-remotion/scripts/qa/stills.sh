#!/bin/sh
# usage: scripts/qa/stills.sh <outdir> <scale> frame...   (renders PitchV5 stills in parallel)
OUT=$1; SC=$2; shift 2
mkdir -p "$OUT"
printf '%s\n' "$@" | xargs -P 8 -I{} sh -c "npx remotion still PitchV5 $OUT/f{}.png --frame={} --scale=$SC --log=error > /dev/null 2>&1 || echo fail {}"
