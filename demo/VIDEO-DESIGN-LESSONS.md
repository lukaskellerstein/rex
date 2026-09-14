# Video-design skill: lessons from the REX demo

Date: 2026-09-14. This is an experience report for improving the demo/video-design
skill. Revision 5 was natively exported, verified and approved by the user.
The retained delivery is `01-rex-overview/final/`. References below to `prep/`, `studio/`,
`assets/`, `out/`, captures and audio are historical evidence paths: those
production folders were removed during the subsequently approved cleanup.
They are not dependencies of the retained native Final Cut library.

Observed environment: Final Cut Pro Creator Studio 12.3 (build 450152), bundle
`com.apple.FinalCutApp`, FCPXML 1.14, macOS on Apple silicon. Treat template and
UI findings as version-specific evidence, not universal guarantees.

## 1. Approve the finish, not an approximation of it

Revision 4 had a Remotion picture-lock proxy and an editable Final Cut project.
The proxy used different intro/outro visuals and did not reproduce the Motion
templates. Labelling it a proxy was accurate, but did not make it an adequate
preview of the finish the user was evaluating. The user reasonably expected
the supplied movie and Final Cut project to look the same.

**Skill improvement:** choose the authoritative renderer at the storyboard gate.
If motionVFX is part of the approved design, Gate 3 must include an actual Final
Cut export. A Remotion proxy may separately approve footage, narration, and cut
timing; it cannot approve native Motion titles, logos, or transitions. Keep that
distinction in filenames, the handoff, and the review criteria.

## 2. A template reference is not a completed title

Selecting downloaded motionVFX templates and referencing their UIDs did not assign
the REX logo to their media wells. Generic XML text runs did not reliably map the
templates' multiple text fields. Some vendor defaults were also unsuitable for
the footage: FB5S used nearly black text; ordinary white lower thirds disappeared
against white document pages.

**Skill improvement:** require a template-specific binding checklist:

- Each media well has an actual source, not merely an imported asset nearby.
- Every text field has explicit final copy; unused fields are explicitly cleared.
- The complete logo is visible throughout its readable hold, in original colors.
- Font, size, contrast, placement, animation entrance, and readable dwell are
  checked over the real footage, not only a vendor preview or black test canvas.
- No default branding or placeholder text survives.

Verified native settings from this session:

| Template | Finding | Applied/tested response |
| --- | --- | --- |
| AKFC intro | Media well initially empty; Gradient recolors artwork | Assign official PNG in FCP; Color Mode None; actual export shows REX |
| P5ZG outro | Default Inside Scale 20 severely crops the wide logo; 8 alone still clips edges | Inside Scale 8 plus native Mask Radius 600 preserves the complete mark in the full native movie at 161 and 163 seconds |
| P5ZG text | Default size 240 is excessive for the longer CTA | Native size 96 produces readable test copy |
| FB5S chapter | Title 1/2 defaults are nearly black | Populate both fields and explicitly set both colors to white |
| FB5S field order | Exported text order is subtitle, then main title | Map by sentinel/native field identity, never guessed array order |
| Basic Lower Third | Two native text objects; white text lacks backing | Explicit Name style, clear Description, add a real dark backing |

Do not regenerate an established logo. Use the official asset unchanged and
verify its hash against the master.

## 3. DTD validity is necessary, not sufficient

Two small diagnostic XML files passed the installed FCPXML 1.14 DTD and still
crashed Final Cut during import. The exception backtrace pointed to
`FFXMLImporter(AssetClipImport) addAssetClip`, not to a Motion render failure.
A title-only diagnostic imported successfully. Importing the PNG through Final
Cut's native media importer also succeeded.

The native library export represents the still source in a browser clip using
`clip` containing `video`, not the diagnostic's `asset-clip` structure:

```xml
<clip start="3600s" duration="10s">
  <video ref="the-still-asset" duration="0s"/>
</clip>
```

This fragment omits other native attributes for clarity. A production exporter
must use the actual inspected resource and format structure, not copy this
abbreviated example blindly.

An initial theory blamed the still's color-space triplet. It was not established:
the later native export itself contained that triplet. Do not turn the first
plausible explanation into a documented root cause.

A subsequent production-length candidate imported but warned that all ten
backings anchored inside `title` were ignored. The DTD allowed this arrangement;
the application did not. Moving them to sibling lanes removed that error but
exposed a second one: the zero-duration browser-still representation was not a
valid timeline edit ("Invalid edit with no respective media"). A native browser
representation must not be assumed valid in a timeline.

The successful isolated test uses real 10-second, 30 fps ProRes 4444 alpha movies
for the two backing designs, referenced as ordinary movie `asset-clip` edits.
An eight-second probe imported without warnings and visibly composited both
plates and native white titles over real document footage. The full-cut version
also imported without warnings and its exported title/backing review passes.

**Skill improvement:** add a minimal native-import smoke test before a whole-cut
export, and treat every import warning as a failed test until understood. Tests
must cover application semantics, not just XML syntax.

## 4. Round-trip native data, and document what does not round-trip

Use distinct sentinel strings in a disposable title probe, set real controls in
Final Cut, and export the result. This provided verified parameter keys, text
order, font styles, and coordinate conversions. Do not synthesize parameter
keys from a Motion object's ID alone: the exported keys contain a full path.

For example, FB5S UI Content Position X = -0.62, Y = 0.38 exported as
`0.15125 0.88`. The UI numbers and serialized numbers are not interchangeable.
Basic text position uses a different native parameter path and coordinate model.
Read the exported result after editing; one attempted Basic Y-position change
did not persist even though the accessibility call returned successfully.

Important limitation observed here: both logos were assigned and visible in the
native project, but its FCPXML export omitted the media-well assignments and
their media dependencies. Exporting the entire library exposed the standalone
PNG resource, but did not provide a reusable logo-binding parameter in the title.

**Skill improvement:** retain the finished native library as the authoritative
editable deliverable when XML cannot preserve a control. Apply those controls
after the final import, then export and review the movie. Do not claim the XML
is fully populated, and do not re-import it over the hand-finished project.

## 5. Validate readability geometrically and temporally

Text color alone is insufficient over document footage with mixed light/dark
regions. Use a real backing element. `text-style.backgroundColor` is not a
general-purpose substitute for a title backing; its documented use is captions.
Keep labels clear of the answer pane, selection evidence, and approval controls.

Short template durations can leave almost no readable time after entrance and
before exit. A three-second label must be judged over time, not from its best
single frame. Logo masks also need dense sampling: a partially clipped wide mark
can look like a legitimate reveal in one isolated frame.

**Skill improvement:** capture entrance, settled hold, and exit samples for every
distinct title family. Measure the longest final copy, not only sentinel text.
Wrap long labels at meaningful separators; preserve wording and keep them inside
the backing. Inspect exported frames at delivery resolution.

## 6. Native UI automation is possible, but needs observations

The installed bundle identifier is `com.apple.FinalCutApp`; the app is named
Final Cut Pro Creator Studio. Hammerspoon accessibility inspection and native
menus worked. Native Share also produced a real 24-second, 1920×1080, 30 fps
H.264 test movie. The skill's blanket suggestion that a person always has to
press Share is too restrictive when a permitted native-UI connection is usable.
There is still no demonstrated headless FCP renderer here.

Operational findings:

- An inactive macOS Space can hide AX windows and prevent window screenshots.
  Focus the observed Space/window and verify, rather than assuming activation
  switched desktops.
- Inspect live accessibility attributes; controls and window IDs change after
  imports, dialogs, or a restart. A stale element may return no attributes.
- Prefer semantic menu/button actions; use current AX geometry when a media
  thumbnail has no action. Scroll off-screen controls into view before clicking.
- Selecting a sidebar row through AX can change selection without changing
  keyboard focus. Export still targeted the old project until the intended
  library row was actually clicked. Verify the export dialog's **Source**.
- Clicking a timeline clip selects it but need not move the playhead. Move the
  playhead separately and verify the displayed timecode before judging a frame.
- Basic Lower Third's Text Layer controls expose the two objects. Next selected
  Name; Previous reached Description. Do not assume navigation wraps.
- Let the UI settle between selection, editing, and confirmation. Re-read values
  and inspect exported data rather than trusting a successful AX return value.
- Save dialogs remember directories independently. One movie export defaulted
  to another project's `out` folder. Verify an exact file URL in the intended
  checkout before pressing Save; a folder label of `out` is not sufficient.
- Current-version XML export produced an `.fcpxmld` bundle containing
  `Info.fcpxml`; support both bundle and plain XML inputs.
- Title selection can switch the inspector to Text automatically. Explicitly
  select the Title inspector before looking for a media-well control; a missing
  control can mean the wrong tab, not a broken template.
- Exporting an iTT sidecar does not burn captions into the picture. The first
  full native export lacked captions despite an attempted burn-in selection.
  Frame review caught this at an active cue (41 seconds). On retry, select
  Roles → Closed Captions → Burn in captions → the intended language, wait,
  re-read the selected value, confirm, reopen the sheet, and verify persistence
  before proceeding. A fast menu-selection/OK sequence is a suspected race,
  not a proven internal cause. Verify the replacement movie's actual pixels.
- A movie can exist and even pass `ffprobe` while Share is still writing it.
  One in-progress full export reported 107.2 seconds before reaching 167.833333.
  Verify expected duration and decoded frame count, not merely file existence
  or successful probing. The finished REX movie has exactly 5,035 video frames.
- A stream-copy MP4 is a useful delivery copy of a native MOV, not another
  renderer. Compare compressed audio/video hashes to prove equivalence; report
  container padding honestly (167.850-second MP4 versus 167.833333-second MOV
  here, with the same 5,035 video frames).

**Skill improvement:** provide a scoped, state-checked native finishing adapter,
with a manual handoff only when the required interaction genuinely cannot be
completed safely. Avoid long sequences of guessed shortcuts.

## 7. Keep music deliberate and measurable

The user requested music for the intro and outro, not the product demonstration.
One generated instrumental master supplies both cues. The arrangement is derived
from measured titlecard sections, not manually duplicated timeline timestamps.

Current prepared bed: 5-second intro at a -22 LUFS normalization target; a
7.4667-second closing reprise at -34 LUFS under narration, with fades. The
48 kHz stereo PCM bed matches all 5,035 picture frames exactly, and the entire
middle is verified as zero-valued samples. A trial closing narration/music mix
peaks at -6.6 dBFS. These measurements do not replace listening.

Generation lessons: the configured music connection rejected its key; the
previously authorized encrypted-key workflow worked without writing plaintext.
The music API rejected combining `seed` with a free-form prompt. Preserve the
successful master and re-arrange locally instead of spending credits repeatedly.

**Skill improvement:** ask explicitly about music at the design gate, support
bookend-only cues, report generation cost boundaries, measure the final mix, and
require a human listening check for taste, balance, and pronunciation.

## 8. Demonstrate real behavior, with safe recording inputs

The prior revision established important product-demo lessons:

- For PDF/HTML/Word, demonstrate an actual completed ASK, not merely saving a NOTE
  while narration implies AI analysis. Keep Markdown's deeper selection lesson.
- Show genuine outcomes early enough that viewers can read them under the claim.
  Short narration with reading time can be intentional; a words-per-second
  warning is not automatically a reason to add filler.
- Multi-selection and hierarchical scope changes deserve visible pointer/dwell
  time. Rehearse before recording and assert the exact selected evidence.
- Use clean synthetic prompts and genuine responses. If a response exposes a
  path, reject the take rather than blurring or rewriting the visible answer.
- Rich HTML and a meaningful linked-document Graph are content preparation work,
  not visual effects. Seed them before capture; verify links and useful outcomes.
- Distinguish shown configuration choices from exercised inference routes.
  Subscription options were shown; actual requests used local models through
  the bundled gateway. Do not imply every provider was tested.
- Isolate app state and documents, verify source hashes, exclude microphone/source
  audio, and restore recording settings after failures.

## 9. Make revisions recoverable and reduce repeated work

Revision 5 preserves all ten clips, eleven narration tracks, and the measured
section data. Reconciliation adds the prepared music bed without changing the
12 section objects or 5,035-frame cut. Revision 4 is archived before overwriting
deliverables. Native diagnostic libraries are separate from the clean delivery
library, and user application/source changes are not part of this finishing task.

**Skill improvement:** make a revision manifest with exact source hashes, native
template tokens, input/output paths, authoritative renderer, review status, and
unresolved manual controls. Delegate bounded frame review and custom assembly;
keep one agent as the sole native-UI operator.

## 10. Archive an approved edit, not the entire working directory

The user requested a Git-retained delivery that remains editable. A movie plus
FCPXML is insufficient here: native logo-well assignments do not round-trip
through XML, and the original library referenced ignored capture/audio files.

- Copy the approved project to a fresh library **inside Final Cut**, with
  original media and copying of external media enabled. Disable optimized and
  proxy media. Confirm media storage is In Library; copying an open bundle in
  the filesystem is not equivalent to a native consistent project copy.
- Close that library, reject pending journals/open SQLite handles, then archive
  only its core databases/settings and actual Original Media. Exclude render
  caches, proxies, trash, locks and old libraries. The current cut needs only
  25 media files (62,639,978 bytes), not the entire demo working directory.
- Keep the byte-identical approved MP4 alongside a compressed native library,
  storyboard/timeline snapshots, captions and the music master. A manifest
  should hash every payload and ZIP member and list required effects/fonts.
- Record dependencies honestly: managed media can be self-contained while
  licensed motionVFX templates and fonts still require a separate installation.
  Do not claim an XML fallback preserves native-only logo controls.
- Restore to a fresh path, with the original libraries closed, and inspect the
  restored edit in Final Cut. A valid ZIP or XML parse does not prove restored
  logo bindings, labels or actual exported pixels work.
- Keep a deliberate exception for each video's `final/` to intermediate-output ignores and
  scope Git LFS rules to its binaries. Do not force-add all captures or caches.
  Preparing a folder is not a remote backup; commit/push needs authorization
  and must transfer the LFS objects too.

**Skill improvement:** add an approved-delivery archival gate with consolidation,
closed-library packaging, an exact dependency manifest, overwrite-safe restore,
and a native restore test. Include archive safety tests: path traversal, symlink
media, external references, hash corruption and overwrite refusal. Python's
SQLite transaction context does not close the connection; use explicit closing
before testing whether databases are still open.

The resulting package and recovery instructions live in
`01-rex-overview/final/README.md`.
The existing skill itself was not modified; these are the requested findings
for a later skill revision.

The actual restored-library Share produced all 5,035 decoded frames identically
to the approved MP4, with an identical AAC stream. This is stronger evidence
than sampled screenshots alone. Encoded H.264/container hashes differed despite
identical decoded picture; compare the correct representation for the claim.
When exporting an event's XML, clear browser clip/project selection first:
sidebar event selection alone can still export the previously selected project.

## 11. Make cleanup a post-approval step

The skill should not finish with a directory full of drafts after the user
approves the final video. Final approval should trigger an explicit archive,
restore-verification and cleanup step. Confirm the cleanup scope and retention
choice with the user before removing working material: keeping an editable
Final Cut delivery is different from keeping a reproducible recording pipeline.

Recommended order:

1. Record approval of the actual final movie and the intended retained delivery.
1. Consolidate all used media into the editable project; retain the approved
   movie, native library, required assets/voiceover/music, source notes, voice
   settings, checksums, prerequisites and reopening instructions.
1. Verify the archive and a fresh restore with the old source locations
   unavailable. For a native finish, check the restored project/export, not
   just whether the ZIP opens. Do not clean up if dependencies are missing.
1. Prepare the sibling `youtube/` publishing package automatically, as described
   in §14. Retain it with the final archive through cleanup.
1. Close only the task-owned libraries and stop its recording/logging processes.
   Remove superseded takes, drafts, caches, proxy renders, duplicate assets,
   isolated app state and unused tooling within this video's approved scope.
1. Prefer a recoverable move first when appropriate; record its exact location
   and whether disk space was actually reclaimed. A recovery directory is not
   part of the retained delivery or a substitute for a remote backup.
1. Recheck archive hashes, restore commands and documentation after cleanup.
   Report what remains, what was removed and how to recover it. Git commit/push
   still requires explicit authorization; video approval is not Git permission.

The REX cleanup followed the editable-delivery choice: the final archive, READMEs
and this lessons document remain. The archive is now under
`01-rex-overview/final/`. The old automation and generated state moved to
Git-ignored local recovery. The retained MP4 and library ZIP stayed byte-identical,
and restore/rebuild succeeded after the original working folders were removed.
Fresh UI recording will require a new preparation pass; native editing will not.

## 12. Give every video a numbered ID, without an extra version directory

One repository can have an overview, a release demo and several feature videos.
Do not treat a single global `demo/final/` as the destination for all of them.
Use a stable, readable video ID with a zero-padded production-order prefix.
The user explicitly rejected the extra version-directory layer: keep the latest
approved delivery directly at `demo/01-rex-overview/final/`. The next new video
could use `demo/02-pdf-ask/final/`. Do not automatically add a `v1/` folder.

Retained layout (implemented for this archive; the installed skill's full
production pipeline still needs explicit multi-video routing):

| Path | Purpose |
| :-- | :-- |
| `demo/README.md` | Index of video IDs, titles, approval dates and links |
| `demo/VIDEO-DESIGN-LESSONS.md` | Shared production lessons |
| `demo/<number>-<video-id>/README.md` | Video purpose, approval, provenance and reopening instructions |
| `demo/<number>-<video-id>/final/` | Approved MP4, editable project, required media, source notes and manifest |
| `demo/<number>-<video-id>/youtube/` | Title, description, upload notes and final thumbnail |
| `demo/<number>-<video-id>/.work/` | Ignored working/restored material; clean up after approval |

- Choose the video ID before scripting and record it with the approval date
  in the brief and delivery manifest. Use a descriptive slug such as
  `01-rex-overview`; `final` alone is not an ID. Prefix new videos with the next
  unused zero-padded production number (`01`, `02`, `03`, ...), so folder sorting
  reflects chronology. Keep numbers stable; do not reuse or renumber existing
  IDs. A new cut of video 01 stays under `01-rex-overview/`, not video 02.
- Distinguish editing iterations from retained videos. This demo's internal
  “Revision 5” does not mean five published videos need to be kept. Version
  metadata, if useful, does not imply a version-directory layer.
- New subjects get new video IDs. Prepare changes to an existing video in its
  ignored `.work/`, leaving `final/` intact until the replacement is approved
  and a recovery plan is confirmed. Update approval date, renderer and media
  hashes together with the publishing package. Commit/push still needs separate
  permission; do not assume uncommitted media is protected by Git history.
- Every stage must resolve an explicitly selected video root: storyboard,
  capture, narration, app state, reconciliation, rendering, review and cleanup.
  Reject ambiguous destinations instead of silently sharing global outputs.
  Resource ownership still applies: distinct IDs do not make one recorder or
  native editor safe for concurrent operators.
- Cleanup is scoped to that video. Never recursively clean `demo/` or
  delete another video's approved assets. Keep each final package self-contained
  for its media; avoid dependencies on another video's `.work/` folder.
- Update Git LFS/ignore rules, validators, helper paths and documentation for
  per-video roots. Test two video IDs with overlapping section names: generating or
  cleaning one must leave the other's hashes and settings unchanged.
- Migration is a separate verified change, not just a folder rename. The current
  archive moved from `demo/final/` to `demo/01-rex-overview/final/`, with
  updated indexes, restore commands and Git rules. Its archive helper resolves
  paths relative to itself. The installed plugin still assumes the original
  single-video production layout; moving an approved archive does not implement
  multi-video capture, generation or cleanup in that plugin.

## 13. Preserve the voice recipe with every approved video

The narrator identity and generation settings must survive cleanup alongside
the actual narration files. A voice's display name alone is insufficient for
continuing a video consistently. Keep one machine-readable source of truth
(here, `01-rex-overview/final/source/storyboard.json` → `meta.voice`) and link a readable summary
from the delivery README; verify that the two agree before archival.

For this REX video:

- Provider: ElevenLabs; voice: **River - Relaxed, Neutral, Informative**.
- Voice ID: `SAz9YHcvj6GT2YYXdXww`; model ID: `eleven_multilingual_v2`.
- Language: English (`en`); speed: `1`; stability: `0.5`;
  similarity boost: `0.75`; style: `0`; speaker boost: enabled.
- Eleven narration MP3s cover `02-workspace` through `12-close`; the intro has
  music but no narration. All eleven tracks are inside the native library's
  `Original Media` folder and hashed in the delivery manifest.
- Pronunciation guidance: “REX” as one word, ASK/ACT as spoken words, and
  “Word document” rather than “docx.” Recheck “Unsloth” and product names during
  a listening review of any new narration.

The future skill should also retain section-to-audio mappings, exact narration
text, pronunciation dictionaries/overrides if used, and generation settings or
request IDs when available. Mark missing provenance as unknown rather than
inventing it. Never retain API keys or credentials as part of this record.
Saved settings help match new lines, but do not guarantee byte-identical future
generation or continued availability of a hosted voice/model. Preserve the
approved audio, reuse unchanged tracks, and get listening approval for new ones.

## 14. Generate the YouTube package automatically after final approval

The user explicitly requested this as standard skill behavior on 2026-09-14.
It should not require a separate reminder after approving the finished video.

**Implementation status:** the REX publishing package exists and this requested
rule is recorded here. The installed plugin skill has not been updated in this
turn: its files are outside the session's permitted REX checkout. Apply the
change in the plugin's source repository, validate it and refresh the installed
plugin through its normal development workflow; editing a cached copy alone
would not be a durable source change.

The skill's post-approval instruction should require:

1. Trigger on explicit approval of the actual final movie, not storyboard,
   rehearsal or draft approval. Identify the approved MP4 and its checksum.
1. Automatically create `demo/<number>-<video-id>/youtube/` beside `final/`.
   Keep one copy-ready `README.md` and the selected upload thumbnail. Do not
   create another version layer or duplicate the movie, library or audio here.
1. Derive the title and description from the approved movie: audience, value,
   demonstrated capabilities, supported-format distinctions and actual product
   URLs. Derive chapters from measured final timing, not estimated storyboard
   durations; omit or combine short chapters as necessary.
1. Generate a branded thumbnail using the available image-generation skill/tool.
   Use official brand references, avoid invented UI or unsupported claims, check
   small-size readability, and retain the selected asset locally with its prompt
   and provenance. If generation is unavailable, report the missing thumbnail;
   do not silently substitute an empty folder or spend through another provider.
1. Check current official YouTube requirements when preparing the package.
   Validate title/description limits, chapter rules, image format, dimensions,
   aspect ratio and bytes. Record the actual size and any upscaling honestly.
   Include upload instructions and applicable AI disclosure notes based on the
   real narration/music provenance; do not infer disclosure from the thumbnail
   alone. Put the checked source links and date in the publishing README.
1. Link the package from the video's README; include its final image in scoped
   Git LFS rules and preserve both publishing files during approved cleanup.
   Verify local links and that the final media hashes are unchanged.
1. Repeated final approval must not overwrite manually edited metadata or an
   accepted thumbnail. If the movie checksum is unchanged, validate/reuse the
   existing package; if it changed, reconcile stale chapters and claims with
   existing user edits. Do not touch another video's package.
1. Report the local package for review. Final-video approval authorizes this
   local preparation, not a YouTube upload, publication, scheduling, Git commit
   or push. Those actions still require their own explicit authorization.

In `skills/demo-video/SKILL.md`, add a post-final-approval delivery stage and
route it to a focused publishing reference. Update its artifact layout and
`references/artifact-contracts.md` so optional `meta.version` metadata does not
force an extra directory. Keep existing draft/native review gates intact.
Forward-check final versus draft approval, an already prepared package, and a
second video ID before claiming the installed skill implements this behavior.

## Recommended changes to the skill, in priority order

1. Add an authoritative-renderer field to the brief/storyboard and prevent a
   proxy render from satisfying a native-Motion review gate.
2. Add a native template-binding probe stage: sentinel text, real logo,
   representative light footage, warning-free import, and short native export.
3. Treat the finished library, interchange XML, and exported movie as different
   deliverables. State which controls the interchange format cannot preserve.
4. Make actual exported pixels the evidence for text, logo fit, backing, and
   caption burn-in. Require active-caption timestamps and dense logo holds in QA.
5. Provide state-checked native Share automation with manual fallback, exact
   destination verification, and explicit wait/read-back around dialog changes.
6. Separate deterministic music arrangement from paid generation; retain the
   master, support bookend cues, and verify silence, levels, and final mix.
7. Keep real ASK outcomes and clean synthetic inputs as capture requirements;
   never substitute NOTE, blur, or a rewritten answer for the claimed behavior.
8. Test helper scripts against the final generated artifacts too. The binding
   probe later broke when production XML gained two equivalent Basic Lower Third
   resource IDs. Deduplicate by one nonempty template UID; reject genuinely
   ambiguous UIDs. Both production and probe suites must continue to pass.
9. Add a post-approval archive/restore/cleanup gate with explicit retention scope
   and a recoverable-removal report; do not leave redundant production folders
   as the default final handoff.
10. Namespace every pipeline stage by chronologically numbered video ID, without
    an extra version directory, with a repository index and tests that cleanup cannot
    affect sibling videos. Keep assigned ordinals stable across later edits.
11. Archive the narrator's provider, voice/model IDs and complete generation
    settings with the actual audio, and expose them in the delivery README.
12. Automatically prepare the sibling YouTube package after explicit final-video
    approval; preserve it through cleanup without uploading or publishing it.

## Current evidence and remaining checks

- `out/demo-fcp.mov`: corrected native Final Cut export, 167.833333 seconds,
  108,624,089 bytes, 1920×1080 at 30 fps, 5,035 frames, H.264/AAC 48 kHz stereo.
- `out/demo-fcp.mp4`: equivalent stream-copy delivery version, 107,769,463 bytes.
  Audio/video packet hashes match the MOV; no alternate rendering is involved.
- `out/REX Demo - Final.fcpbundle`: clean, warning-free imported project, with
  both logos natively assigned. Open this library to retain those assignments.
- `out/review-revision-5-native.md`: twelve-section native frame review passes;
  the initially missing caption burn-in is resolved in the corrected movie.
- `out/revision-5-export-qa/`: preserved captionless exports, not delivery files.
- `out/revision-5-binding-sample.fcpxmld/Info.fcpxml`: native title text/settings.
- `out/revision-5-native-library.fcpxmld/Info.fcpxml`: native still resource shape.
- `out/revision-5-native-probe.mov`: actual 24-second native animation export.
- `out/revision-5-native-probe-frames/`: exported-frame review samples.
- `out/revision-5-alpha-video-probe.fcpxml`: warning-free native import test of
  movie-backed label plates over real footage.
- `out/revision-5-outro-fit600.fcpxmld/Info.fcpxml`: native Mask Radius 600
  parameter; full-movie review verifies the full logo at Inside Scale 8.
- `prep/prepare-bookends.mjs` and `audio/music/rex-bookends.json`: reproducible
  music preparation and sample-level verification.
- Verification: 19 production assembly tests plus 10 binding-probe tests pass.
  All twelve measured section objects remain unchanged. Repository findings are
  identical to the approved-turn baseline (52); TS/Python type checks are clean.
- Actual exported mix: −26.7 LUFS integrated, −7.7 dBTP, no clipping. The
  captioned replacement preserves the first export's audio stream exactly.
- The user subsequently approved the finished video and the final archival plan.
  Frame review and level measurements alone do not establish subjective listening
  quality. No public release or commit was made.

The relevant improvement is a chain of observed evidence: approved finish →
minimal native test → supported full import → assigned native controls → actual
export → frame and audio checks → human watch/listen approval. Do not skip a
link because an earlier artifact looks plausible.
