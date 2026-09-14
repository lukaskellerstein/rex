# REX demo — approved editable archive

Video ID: `01-rex-overview`; production order: `01`.
[Video notes](../README.md) · [All videos](../../README.md)

Approved on 2026-09-14. This folder is the durable delivery, approximately
114 MiB, intended for Git with Git LFS. Intermediate renders, failed takes,
old revisions and caches remain outside it. No commit or push was made as
part of preparing the archive.

The old production folders were removed in the approved cleanup. This folder
is sufficient to continue editing the existing video in Final Cut; it does not
retain the old automated recording environment. See [../README.md](../README.md)
for the cleanup scope and local recovery location.

## Contents

| File | Purpose |
| :-- | :-- |
| `rex-demo.mp4` | Approved native Final Cut export, unchanged: 107,769,463 bytes |
| `rex-demo.fcpbundle.zip` | Editable native library and all 25 used media assets: 11,600,875 bytes compressed |
| `source/` | Storyboard/timeline snapshots, captions, music master/configuration and label artwork |
| `manifest.json` | SHA-256 hashes for every payload and library member; effects/font inventory |
| `archive.py` / `test_archive.py` | Standard-library build, verification, restore and safety tests |

The movie is 1920×1080, 30 fps, 5,035 frames, with AAC stereo at 48 kHz.
Picture duration is 167.833333 seconds; the MP4 container is 167.850 seconds
including audio padding. Its SHA-256 is
`0dfbae5764fc2ca704b880ca92897d0917ea80489851964a21da12879be628cd`.

The native library contains ten capture clips, eleven narration tracks, the
prepared bookend music WAV, two alpha-backed label movies, and the official REX
logo PNG. These are actual files in the library's `Original Media` directory,
not links to `demo/out`, `demo/capture`, `demo/audio` or `demo/assets`.
No separate narration copies are needed outside the ZIP.

## Voiceover settings

Provider: **ElevenLabs**. Voice: **River - Relaxed, Neutral, Informative**.
The saved source of truth is [source/storyboard.json](source/storyboard.json)
under `meta.voice`.

| Setting | Used value |
| :-- | :-- |
| Voice ID | `SAz9YHcvj6GT2YYXdXww` |
| Model ID | `eleven_multilingual_v2` |
| Language | English (`en`) |
| Speed | `1` |
| Stability | `0.5` |
| Similarity boost | `0.75` |
| Style | `0` |
| Speaker boost | Enabled (`true`) |

The eleven narration tracks (`02-workspace` through `12-close`) are retained
inside the native library's `Original Media` folder; `manifest.json` lists
their exact filenames and hashes. `01-intro` has music and no narration.
Section narration text is retained in the storyboard. Say “REX” as one word,
ASK/ACT as words, and “Word document” rather than “docx”; listen-check Unsloth
and other product names when adding new lines.

Reuse the archived audio for unchanged sections. These settings are a recipe
for matching new narration, not a guarantee of identical future generations.
No ElevenLabs credentials are required to edit the existing audio in Final Cut,
and no credentials are included in this archive.

## Restore and continue editing

From the repository root, after cloning and obtaining the Git LFS objects:

```sh
git lfs install
git lfs pull
python3 demo/01-rex-overview/final/archive.py verify
python3 demo/01-rex-overview/final/archive.py restore demo/01-rex-overview/.work/edit
open demo/01-rex-overview/.work/edit/rex-demo.fcpbundle
```

Choose a new destination each time; restore refuses to overwrite an existing
working library. Extracted `.work/` directories are ignored by Git. Edit that
working copy, not the archived ZIP. Verification checks content hashes, not
authenticity against a separately signed manifest.

**Open the native library, not the XML.** Native database state preserves the
motionVFX intro/outro logo assignments that FCPXML does not round-trip. The
restore command also writes `project-relinked.fcpxml` as an interchange fallback;
reimporting it can require assigning both logo wells again.

The source storyboard/timeline are historical pipeline snapshots, including
their original relative capture/audio paths. They are not a standalone fresh
render project. For ordinary editing, use the consolidated library. For future
pipeline regeneration, extract its media and adapt the pipeline inputs; retain
the original measured timeline as evidence rather than hand-editing it.
The music master is included for retiming cues without regenerating music.

## Editing prerequisites

Created and restore-tested with Final Cut Pro Creator Studio 12.3 (450152),
on this Apple-silicon Mac. Other editor versions/machines were not tested.

Install the matching motionVFX DesignStudio templates through your licensed
installation: **Logo AKFC**, **Logo P5ZG**, **Keynote Lower3rd FB5S** and
**Keynote Transition JGMG**. Exact template UIDs are in `manifest.json`.
Apple Basic Lower Third, Cross Dissolve and Audio Crossfade are also used.
Fonts: Inter Tight SemiBold, Poppins Regular/Black, Helvetica Neue Medium,
and the Apple system font. Third-party templates, software and font installers
are not redistributed here; the archive is self-contained for project media,
not for the editor and its installed effects.

On a new Share/export, select Video and Audio, H.264, 1920×1080, Rec. 709,
AAC and Save only. Under **Roles → Closed Captions → Burn in captions**, choose
**English - United States (iTT)**. Wait, reopen that dialog, and confirm the
selection persisted. Final Cut can reset it to None on a new Share.
Check exported frames for both logos, readable labels and active captions.
The delivered MP4 already has captions burned in; `source/captions.itt` is the
editable/exportable sidecar, not evidence of burn-in by itself.

## Updating this archive next time

1. Finish and approve the movie from the native Final Cut project.
1. In Final Cut, copy that project to a new library. Include original media and
   **Copy media stored in external locations**; omit optimized/proxy media.
   Confirm media storage is **In Library**. Keep only the final project and
   its used assets. Export that event's XML to include the native logo asset.
1. Close the new library in Final Cut before packaging. The helper checks
   open database handles, pending journals and SQLite integrity. Never ZIP a
   live library or silently discard pending database state.
1. Keep this approved delivery intact while preparing a candidate in `.work/`.
   The helper deliberately refuses existing delivery files.
   Update its dated project metadata for the new cut;
   it is a small recipe for this delivery, not a general Final Cut exporter.
1. Package the closed library, then verify and restore to a fresh directory.
   Open it with the original libraries closed and review an actual native
   export. Preserve only the new approved output, library ZIP and necessary
   source extras. After approval and a confirmed recovery plan, promote the
   candidate into this video's `final/` folder, refresh its sibling `youtube/`
   package, and update the video index. Do not introduce a version subfolder.

The build helper now takes standalone inputs, not the removed production
folders. Prepare `demo/01-rex-overview/.work/next-inputs/rex-demo.mp4` and a `source/` folder
with the same eight source filenames listed in `archive.py` (`SOURCE_NAMES`).
Copy still-relevant source extras from this archive, update captions and other
changed inputs, and reconcile any changed timeline with a fresh pipeline.
The native event XML supplies `project.fcpxml`; do not copy the old one as the
new event export. Keep the current approved archive intact while building a
candidate in a **new** output directory:

```sh
python3 demo/01-rex-overview/final/archive.py build \
  --library demo/01-rex-overview/.work/next-edit.fcpbundle \
  --native-xml demo/01-rex-overview/.work/next-event.fcpxmld/Info.fcpxml \
  --inputs demo/01-rex-overview/.work/next-inputs \
  --output demo/01-rex-overview/.work/next-archive
python3 -B -m unittest discover -s demo/01-rex-overview/final -p 'test_archive.py' -v
```

`.gitattributes` scopes Git LFS to this final folder's large binaries. Do not
add old working folders or the cleanup recovery directory. A local prepared
folder is not yet a remote backup: a separately authorized commit and push
must include the LFS objects as well as their Git pointers.

## Restore verification — 2026-09-14

- Verified all 11 payload files and all 30 archived library members against
  their SHA-256 hashes. The ZIP has 25 real media files, no symlinks.
- Restored into `demo/out/archive-restore-test/`, closed the original/QA
  libraries, opened only the restored library, and exported the full project
  through Final Cut Share with caption burn-in enabled.
- A fresh native event XML export resolves all 25 media references, including
  the official logo, inside the restored library, with no external media links.
- The restored export has all 5,035 frames. Its **entire decoded video** is
  byte-identical to the approved movie, and its compressed AAC audio stream is
  identical. Container/encoded-video hashes can differ between exports; the
  archived approved MP4 itself was never replaced or re-encoded.
- Decoded-video SHA-256 for both exports:
  `abbc148f20cc98c3574a58992fe607d9e9ca1b3abf4345ad055ddc7595ddbbf3`.
  AAC stream SHA-256 for both:
  `26d3153c731d98eda2e558ce98a591cc4306d2cbe54a4b727f2e8c907406f35b`.
- Sampled rendered frames also show the correct intro, captions, selection,
  approved document change, Traffic and closing CTA. Historical diagnostic
  files were `demo/out/archive-restored-check.mov` and
  `archive-restored-contact.png`; they moved out with the superseded production
  folders during cleanup. These duplicates are not part of this archive.
- Ten archive safety/round-trip tests pass. Repository checks match the starting
  baseline exactly: 52 pre-existing findings, no new findings; type checks pass.
- Git LFS attributes and pointer generation were verified without staging,
  committing or pushing. Working restores remain ignored by Git.

## Cleanup verification — 2026-09-14

After moving the superseded production folders out of `demo/`, verification
still passed for every payload and library member. A fresh restore and full
CLI rebuild used only this archive's inputs. The rebuilt MP4 and native library
ZIP were both byte-for-byte identical to the retained originals.

The helper's 13 safety/round-trip tests pass, including standalone build inputs,
missing-input preflight and overwrite refusal. Tests now use `final/.work/`,
so they do not recreate an `out/` directory. Repository checks added no findings:
29 pre-existing findings remain after removing the old studio sources; both
type checks pass. Temporary restore/rebuild copies moved to local recovery too.
No application/spec changes, Git commit or push were made.
