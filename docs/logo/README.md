# REX logo kit

Everything here except `logo.png` and `build.sh` is generated. Edit the source,
run the script, commit the result — never hand-edit a generated file.

```bash
./docs/logo/build.sh     # requires ImageMagick 7
```

## Variants

| Directory | Variant | Master size | Use for |
|:--|:--|:--|:--|
| `combined/` | mark **as** the R, then EX | 1272×393 | **the default lockup** — README headers, docs, About box |
| `full/` | mark + wordmark, horizontal | 1916×578 | when the mark needs to stand apart from the word — a title card, a wide banner |
| `mark/` | the **R** alone | 614×578 | app icon, avatar, favicon source, anywhere too small for text |
| `wordmark/` | **REX** alone | 1250×393 | when the mark already appears nearby, or in a tight horizontal strip |
| `stacked/` | mark above wordmark | 767×905 | square-ish and vertical spaces — splash screen, centred hero |
| `icon/` | the mark, padded square | 1024×1024 | app icons and touch icons |
| `favicon.ico` | multi-resolution ICO | 64/48/32/24/16 | browser tabs |

`combined/` is the default rather than `full/` because `full/` reads "R REX" —
the mark and the wordmark both supply an R. `combined/` drops the wordmark's
blue R and lets the mark be the letter, so the lockup reads the name once. It
is also the more legible of the two at any given height, since `full/` spends
that height on the oversized mark and leaves the word small.

## Treatments

Each lockup ships in three:

- **`color`** — the full artwork. The default.
- **`white`** — a white silhouette, for dark backgrounds and photos.
- **`black`** — a black silhouette, for light backgrounds, single-colour print,
  stamps and watermarks.

The silhouettes are cut from the alpha channel, which is lossless here: every
counter in the artwork (both R bowls, the E gaps) is genuinely transparent in
the source rather than painted dark.

## Naming

```text
rex-<variant>-<treatment>[-<width>].png
```

The number is the **width in pixels**; height follows the master's aspect ratio.
No suffix means the master — the largest available. Nothing is upscaled, so the
master is the true resolution ceiling.

| Variant | Widths available |
|:--|:--|
| `full`, `combined`, `wordmark` | 1024, 512, 256, 128 |
| `mark` | 512, 256, 128, 64, 32 |
| `stacked` | 512, 256, 128 |

## Icons

| File | Notes |
|:--|:--|
| `icon/icon-{1024,512,256,128,64,48,32,16}.png` | transparent, mark at 86% of the canvas |
| `icon/apple-touch-icon.png` | 180×180, **flattened onto white and stripped of alpha** — iOS ignores transparency and composites on black, which would swallow the mark's navy outline |
| `favicon.ico` | 64/48/32/24/16, ~34 KB. Mark at 94% of the canvas; at 16px a pixel of margin costs a pixel of glyph |
| `icon/app.ico` | the same ladder plus 128 and 256, ~364 KB — for `electron-builder`'s `win.icon`, which rejects an ICO without a 256px frame |

There are two ICOs because ICO stores every frame as uncompressed BGRA: the
256px frame alone is 256 KB. That is unremarkable inside a packaged app and
absurd for a file a browser refetches on each page load, and no single ladder
serves both.

`icon-1024.png` is enlarged from the 614px master. The artwork is flat-facet
low-poly, so it enlarges without visible softening — but if a genuinely larger
asset is ever needed (an App Store submission, say), re-render the source rather
than enlarging further.

## What `build.sh` does to the source

Two corrections, both artefacts of how `logo.png` had its background removed:

1. **Alpha clamp.** The artwork body sits at alpha 250–254 rather than 255, and a
   halo of alpha 1–5 noise surrounds it. The halo defeats `-trim` — it reads as
   content — and the sub-255 body washes out slightly when composited. The script
   clamps both ends and leaves the real antialiased edge ramp between them.
2. **Split and trim.** The source is a single lockup with a clean 52px
   transparent gap at x=705…756. The script splits there and trims each half to
   its own ink, which is why the masters are tight to the glyphs.

`logo.png` itself is never written to.

### How `combined/` is composed

The wordmark carries its own transparent letter gaps — R\|E at x=395…409 and
E\|X at x=772…778 — so "EX" is everything from x=410 rightward. Two numbers make
the result read as a word rather than as a mark sitting next to some text:

- **The mark is matched to the wordmark's cap height exactly.** Anything taller
  and it stops being the letter R and starts being an oversized initial. 120%
  and 140% were tried; both break the word.
- **The space between them is 15px at that cap height** — which is the
  wordmark's own native R-to-E gap, so the mark is spaced the way the typeface
  already spaces its own R.

Both are baseline-aligned, which here is a plain bottom-align because the mark
and the letters are all flush at the baseline.
