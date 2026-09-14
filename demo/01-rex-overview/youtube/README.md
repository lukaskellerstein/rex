# YouTube publishing package — REX overview

Prepared on 2026-09-14 for video `01-rex-overview`, approved on 2026-09-14.
Status: ready for owner review; not uploaded or published.
This package does not change the approved movie or Final Cut archive.

## Title

Copy only the text inside this block:

```text
REX Demo: AI Document Review for Markdown, PDF, HTML & Word
```

## Description

Copy the complete block, including the timestamps. It is plain text for YouTube,
not Markdown formatting.

```text
Ask questions where the work lives. REX keeps AI conversations attached to your documents, so you can check every answer against its source and approve changes before they reach your file.

This hands-on demo starts with Markdown: select several passages in one request, move through the document hierarchy, and compare the evidence in context. Then see ASK in action on PDF, HTML and Word documents, explore linked documents in Graph, and inspect requests in Traffic.

ASK is read-only. ACT proposes edits on an isolated working copy; review the changes and choose what to approve. The PDF demonstration leaves the original file unchanged.

Use your existing Codex or Claude Code subscription through sign-in, or connect local models and hosted APIs through REX's bundled AI gateway. Options include LM Studio, Ollama, Unsloth and OpenRouter. Choose the agent and model for each message.

Supported formats: Markdown, HTML, Word (.docx), PDF and PowerPoint (.pptx). This video demonstrates Markdown, PDF, HTML and Word; PowerPoint is listed among the supported formats.

REX is a desktop app for macOS on Apple silicon.

Download REX:
https://github.com/lukaskellerstein/rex/releases/latest

Source code and documentation:
https://github.com/lukaskellerstein/rex

Chapters
00:00 Meet REX and the document workspace
00:17 Multi-selection and document hierarchy
00:36 ASK with connected context
00:51 ACT: review and approve edits
01:16 Ask questions in a PDF
01:28 Ask questions in HTML
01:42 Ask questions in Word
01:54 Graph: connections between documents
02:08 AI subscriptions and the bundled gateway
02:25 Traffic: inspect requests and responses

Real REX screen recordings. Narration and intro/outro music were generated with AI.

#REX #DocumentReview #AI
```

The subscription routes are presented as available options; this recording uses
a local model through the bundled gateway. Do not describe the movie as a test
of subscription-backed inference or PDF editing.

## Files to upload

- Video: [../final/rex-demo.mp4](../final/rex-demo.mp4) — the approved 1080p,
  30 fps movie, approximately 2:48. Do not upload the library ZIP or an old draft.
- Custom thumbnail: [thumbnail.jpg](thumbnail.jpg).
- Editing handoff, voice identity and archive verification:
  [../final/README.md](../final/README.md).

## Upload procedure and settings

1. In YouTube Studio, choose **Create → Upload videos** and select the MP4 above.
1. Paste the title and description from this file; upload `thumbnail.jpg` as the
   custom thumbnail. Custom thumbnails require a verified account.
1. Suggested settings: language **English**, category **Science & Technology**,
   audience **No, it's not made for kids** for this developer-focused demo.
   Confirm the audience choice as the channel owner.
1. Set **AI use → Yes** (some interfaces call this **Altered content**).
   The video contains generated music, which YouTube explicitly includes in its
   disclosure examples. The generated thumbnail alone is production assistance,
   not the reason for this setting.
1. Keep visibility **Private** for upload checks; optionally use **Unlisted** for
   a review link. Wait for 1080p processing and review YouTube's Checks results.
1. Check the thumbnail on desktop and mobile, title/description, chapter jumps,
   first and last music cues, captions and logo visibility. English captions are
   already burned into the movie; avoid adding a second burned-in caption layer.
1. Open both GitHub links while signed out and confirm that the release is
   publicly downloadable. These are the project's documented URLs, but a
   logged-out check during preparation returned HTTP 504, so public reachability
   is not confirmed. Correct the links before publishing if necessary.
1. Only after the owner's publishing approval, choose **Public** or schedule the
   release. Record the resulting video URL and publication date below.

YouTube allows up to 100 characters in a title and 5,000 in a description.
See [YouTube's upload instructions](https://support.google.com/youtube/answer/57407?hl=en).
For the generated-music setting, see
[YouTube's AI disclosure guidance](https://support.google.com/youtube/answer/14328491?hl=en).

Chapter timestamps are rounded from the approved
[timeline](../final/source/timeline.json) at 30 fps. The five-second intro shares
the opening chapter, and the short outro stays in the final chapter. Every
chapter lasts at least ten seconds, the first starts at `00:00`, and there are
more than three entries, following
[YouTube's chapter requirements](https://support.google.com/youtube/answer/9884579?hl=en).
Recheck timestamps if a later video version changes the edit.

## Thumbnail specification and provenance

- Upload artifact: `thumbnail.jpg`, 3840×2160 pixels, 16:9, RGB JPEG,
  1,189,554 bytes (1.19 MB).
- Design: the REX wordmark, “ASK YOUR DOCS”, four format labels, and a conceptual
  document/question illustration. It is not a screenshot of the application.
- Keep the headline and logo legible at small sizes. The lower-right corner is
  intentionally quiet for YouTube's duration overlay.
- Created using the built-in image-generation tool, not a CLI/API fallback.
  The returned image was 1672×941; delivery was resampled to 3840×2160 and encoded
  as JPEG. This is an upscaled delivery, not a native 4K generation.
- Brand reference:
  [official dark-background REX logo](../../../docs/logo/combined/rex-combined-on-dark.png).
  The selected upload image is retained here; intermediate files are not needed.

Requirements checked on 2026-09-14: YouTube currently recommends 3840×2160 for
landscape video thumbnails, accepts JPG/PNG, and recommends 16:9. Its upload
limits are 50 MB on desktop and 2 MB on mobile; this file targets the stricter
limit. See [YouTube's thumbnail guidance](https://support.google.com/youtube/answer/72431?hl=en).

### Generation prompt

The official logo was supplied as the supporting brand reference. Reuse this
prompt and the logo for future variations; generation is not deterministic.

```text
Use case: ads-marketing
Asset type: YouTube thumbnail for the approved REX product demo.
Primary request: Compose a refined, memorable thumbnail around the supplied official REX logo. Deliver one landscape 16:9 image at 3840 x 2160 pixels.
Input image 1: supporting brand insert, the official REX wordmark (faceted red R followed by white EX on transparency). Preserve its exact letter shapes, proportions, color and faceted geometry; do not redesign, truncate, or invent a different logo.
Scene/backdrop: deep charcoal with very subtle warm red light falloff and fine matte texture; generous negative space.
Subject: document-anchored AI questions. On the right, a beautifully composed small stack of off-white document panels with a red highlighted passage and a compact question bubble connected to that passage by a thin red line. This is a conceptual editorial illustration, NOT a screenshot or a mockup of the application UI. Document content uses tidy abstract short rules, not fake readable paragraphs.
Composition: logo in the upper left, large two-line headline below it reading ASK YOUR on the first line and DOCS on the second. Illustration occupies the right half without competing with the headline. A modest row of four format chips below the headline reads MD, PDF, HTML, DOCX. Keep all essential content inset at least 6% from edges, and leave the bottom-right corner quiet for YouTube's duration overlay.
Style/medium: premium technology editorial advertising, crisp graphic design with subtle tactile depth and soft realistic shadows; confident, restrained, no overdone effects.
Typography: extremely legible bold contemporary sans-serif, white headline, clean hierarchy, readable at 320 x 180. Exact headline text: "ASK YOUR DOCS". Exact format-chip text: "MD", "PDF", "HTML", "DOCX". The bubble may contain only "?".
Palette: the supplied REX red, charcoal, off-white, restrained warm-gray details.
Constraints: only the supplied REX brand and the specified text; accurate spelling; no extra slogans, fake answer text, performance claims, people, faces, robots, YouTube play buttons, stock watermarks, neon rainbow glow, tiny UI details, or clutter.
```

## Verification

Checked locally on 2026-09-14: title 59/100 characters; description 1,761/5,000;
ten chapters, each at least ten seconds and within half a second of its source
section start. Local links were rechecked after flattening the video folder.
The thumbnail decodes at the stated dimensions and was visually checked
at full presentation size and 320×180. Its Git LFS attributes are active.
The approved archive still passes all payload/media hash checks. Repository
checks remain at the same 29 pre-existing findings, with no new findings.
No application code changed, so no app runtime test was needed.

Thumbnail SHA-256:

```text
b3e0bbabbdf470f11c25dafdce4aceefcff787bbbec6d57999527e2ba414653d
```

## Publication record

- YouTube URL: not published.
- Publication date: not published.
- Published video: pending; this package targets `01-rex-overview/final/`.
- Approved MP4 SHA-256:
  `0dfbae5764fc2ca704b880ca92897d0917ea80489851964a21da12879be628cd`.

[Back to the video](../README.md)
