#!/usr/bin/env bash
#
# Regenerate every REX logo asset from docs/logo/rex-logo.png.
#
# Requires ImageMagick 7 (`brew install imagemagick`). Safe to re-run: it deletes
# and rewrites the generated directories, so run it after any change to the
# source.
#
# A rebuild is pixel-identical but not byte-identical — ImageMagick stamps each
# PNG with a tIME chunk and a date:timestamp text chunk taken from the wall clock
# at encode time. So `git status` after a no-op rebuild shows every PNG as
# modified while every pixel is unchanged; discard those diffs rather than
# hunting them.
#
#   ./docs/logo/build.sh
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

SRC="rex-logo.png"
[[ -f "$SRC" ]] || {
  echo "missing $SRC" >&2
  exit 1
}
command -v magick >/dev/null || {
  echo "ImageMagick 7 (magick) not on PATH" >&2
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rm -rf full combined mark wordmark stacked icon favicon.ico
mkdir -p full combined mark wordmark stacked icon

# --- 1. Clean the source alpha -----------------------------------------------
# The source carries two artefacts of its background removal: the artwork body
# sits at alpha 251-254 rather than 255, and a halo of alpha 1-5 noise surrounds
# it. The halo defeats -trim (it reads as content) and the sub-255 body washes
# out slightly when composited. This level clamps both ends and leaves the
# genuine antialiased edge ramp between them untouched.
magick "$SRC" -channel A -level '1.96%,96.1%' +channel "$TMP/clean.png"

# --- 2. Masters ---------------------------------------------------------------
# The source is one horizontal lockup, 2172x724: the R mark, a clean 54px
# transparent gap at x=808..861, then the REX wordmark. Split mid-gap, then
# -trim each half to its own ink.
magick "$TMP/clean.png" -crop 835x724+0+0 +repage "$TMP/half-mark.png"
magick "$TMP/clean.png" -crop 1337x724+835+0 +repage "$TMP/half-word.png"
magick "$TMP/half-mark.png" -trim +repage "$TMP/mark.png"
magick "$TMP/half-word.png" -trim +repage "$TMP/wordmark.png"

# The letters are one flat navy — #0F0F24 over 99% of the wordmark's opaque
# pixels — so the on-dark treatment is the same artwork with that navy turned
# white, and the mark left in colour. It is built from the wordmark *half*, so
# every lockup below is composed from the same recipe for both treatments and
# their geometry cannot drift apart.
magick "$TMP/half-word.png" -fill white -colorize 100 "$TMP/half-word-on-dark.png"

MARK_W=$(magick identify -format '%w' "$TMP/mark.png")
MARK_H=$(magick identify -format '%h' "$TMP/mark.png")
WM_H=$(magick identify -format '%h' "$TMP/wordmark.png")
WM_W=$(magick identify -format '%w' "$TMP/wordmark.png")
magick "$TMP/mark.png" -resize "x${WM_H}" "$TMP/mark-cap.png"

# Compose the three lockups that carry both the mark and the letters, from one
# treatment of the wordmark half. $1 names that treatment's masters in $TMP —
# empty for the colour artwork, "-on-dark" for the white letters.
lockups() {
  local tag="$1" half="$2"

  # Full lockup: the source's own geometry. The two halves are re-appended in
  # place before the trim, so the mark keeps the overhang it has in the source.
  magick "$TMP/half-mark.png" "$half" +append +repage -trim +repage "$TMP/full$tag.png"
  magick "$half" -trim +repage "$TMP/wordmark$tag.png"

  # Stacked lockup: mark centred above the wordmark. The wordmark is set to 125%
  # of the mark's width and separated by 15% of the mark's height — the ratio
  # that balances the two optically (100% leaves the wordmark looking
  # undersized, 150% lets it dominate the mark).
  magick "$TMP/wordmark$tag.png" -resize "$((MARK_W * 125 / 100))x" "$TMP/wm-scaled$tag.png"
  magick -background none \
    "$TMP/mark.png" \
    \( -size "1x$((MARK_H * 15 / 100))" xc:none \) \
    "$TMP/wm-scaled$tag.png" \
    -gravity center -append +repage "$TMP/stacked$tag.png"

  # Combined lockup: the mark serves as the word's R, so it reads "REX" once
  # instead of the default lockup's redundant "R REX". The wordmark has its own
  # transparent letter gaps — R|E at x=338..372 and E|X at x=672..680 — so "EX"
  # starts at x=373 within the trimmed wordmark.
  #
  # Two numbers make this read as a word rather than as a mark next to text:
  # the mark is matched to the wordmark's cap height exactly (any taller and it
  # reads as an oversized initial), and the space between them is 35px at that
  # cap height, which is the wordmark's own native R-to-E gap.
  #
  # The append is a plain bottom-align. In the source lockup the mark
  # deliberately drops below the wordmark's baseline (mark y=103..603 against
  # text y=211..543), but the mark and the letters are each flush-cut at their
  # own bottom edge, so bottom-aligning the two trimmed images is true baseline
  # alignment.
  magick "$TMP/wordmark$tag.png" -crop "$((WM_W - 373))x${WM_H}+373+0" +repage "$TMP/ex$tag.png"
  magick -background none \
    "$TMP/mark-cap.png" \
    \( -size "35x1" xc:none \) \
    "$TMP/ex$tag.png" \
    -gravity south +append +repage "$TMP/combined$tag.png"
}

lockups "" "$TMP/half-word.png"
lockups "-on-dark" "$TMP/half-word-on-dark.png"

# --- 3. Colour treatments + size ladders --------------------------------------
# white/black are silhouettes taken from the alpha channel. That is lossless
# here because every counter in the artwork (both R bowls, the E gaps) is
# genuinely transparent rather than painted dark — verified against the source.
ladder() { # ladder <master> <dir> <variant> <treatment> <widths...>
  local master="$1" dir="$2" variant="$3" treatment="$4"
  shift 4

  cp "$master" "$dir/rex-$variant-$treatment.png"
  for w in "$@"; do
    magick "$master" -resize "${w}x" "$dir/rex-$variant-$treatment-${w}.png"
  done
}

emit() {
  local variant="$1" dir="$2"
  shift 2
  local master="$TMP/$variant.png"

  for treatment in color white black; do
    local base="$TMP/$variant-$treatment.png"
    case "$treatment" in
      color) cp "$master" "$base" ;;
      white) magick "$master" -fill white -colorize 100 "$base" ;;
      black) magick "$master" -fill black -colorize 100 "$base" ;;
    esac
    ladder "$base" "$dir" "$variant" "$treatment" "$@"
  done

  # Only the three lockups that mix the mark with the letters get on-dark.
  # mark/ has no letters to lighten, and wordmark/ is nothing but letters, so
  # its on-dark version would be byte-for-byte the white silhouette above.
  case "$variant" in
    full | combined | stacked)
      ladder "$TMP/$variant-on-dark.png" "$dir" "$variant" on-dark "$@"
      ;;
  esac
  echo "  $variant  $(magick identify -format '%wx%h' "$master")  ->  $dir/"
}

echo "generating lockups:"
emit full full 1024 512 256 128
emit combined combined 1024 512 256 128
emit mark mark 512 256 128 64 32
emit wordmark wordmark 1024 512 256 128
emit stacked stacked 512 256 128

# --- 4. Square icons ----------------------------------------------------------
# The mark is 524x501, so it needs padding to sit square. App icons get 86% of
# the canvas; the favicon gets 94%, because at 16px every pixel of margin is one
# fewer pixel of glyph.
square() { # square <content-percent> <canvas> <out>
  local pct="$1" size="$2" out="$3"
  local box=$((size * pct / 100))
  magick "$TMP/mark.png" -filter Lanczos -resize "${box}x${box}" \
    -background none -gravity center -extent "${size}x${size}" "$out"
}

echo "generating icons:"
for s in 1024 512 256 128 64 48 32 16; do
  square 86 "$s" "icon/icon-${s}.png"
done

# iOS ignores alpha and composites touch icons on black, which would swallow the
# mark's dark facets — so this one ships flattened onto white.
square 86 180 "$TMP/touch.png"
magick "$TMP/touch.png" -background white -flatten +repage -alpha off "icon/apple-touch-icon.png"

# Two ICOs, because the two uses have incompatible requirements. ICO stores
# frames as uncompressed BGRA, so a 256px frame alone costs 256KB — fine for a
# packaged app icon, absurd for something a browser refetches per page load.
square 94 256 "$TMP/favicon-master.png"
magick "$TMP/favicon-master.png" -define icon:auto-resize=64,48,32,24,16 favicon.ico
magick "$TMP/favicon-master.png" \
  -define icon:auto-resize=256,128,64,48,32,24,16 "icon/app.ico"

echo "  icon/  favicon.ico"
echo
echo "done: $(find full combined mark wordmark stacked icon favicon.ico -type f | wc -l | tr -d ' ') files"
