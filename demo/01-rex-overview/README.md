# 01 — REX overview

Video ID: `01-rex-overview`. Production order: **01**, the first video.
Title: **REX — Ask where the work lives**.

The overview demonstrates Markdown selection and document hierarchy, ASK/ACT
and approval, PDF/HTML/Word questions, Graph connections, AI connection choices
and Traffic inspection. Native Final Cut finishing provides the REX logos,
motionVFX titles/transitions, captions, narration and intro/outro music.

- Approved: 2026-09-14; the first approved cut.
- Native project: `REX — Ask where the work lives — Revision 5`.
- Authoritative editor: Final Cut Pro Creator Studio 12.3 (450152).
- Picture: 1920×1080, 30 fps, 5,035 frames (167.833333 seconds).
- Voice: ElevenLabs River; [complete settings](final/README.md#voiceover-settings).

## Approved delivery

[final/README.md](final/README.md) contains the archive inventory, prerequisites,
checksums and restore/build commands. The [MP4](final/rex-demo.mp4) and
[native library ZIP](final/rex-demo.fcpbundle.zip) preserve the approved delivery.
Future native edits belong in an ignored `.work/` copy, not inside the ZIP.

[youtube/README.md](youtube/README.md) contains the proposed YouTube title,
copy-ready description and chapters, upload checklist, and custom thumbnail.
Publishing assets are kept beside `final/`; nothing has been uploaded.

Keep `README.md`, `final/` and `youtube/` directly inside this video folder.
“Revision 5” in the native project name is its historical editing iteration,
not a release folder. Do not introduce an extra version-directory layer.
Prepare future changes separately in `.work/`; replace the retained delivery
only after approval and a confirmed recovery plan. Git commits and pushes need
separate authorization; the working folder alone is not a remote backup.

## Migration and cleanup

This archive originally lived at `demo/final/`. It now uses the numbered video
folder directly, without the intermediate version directory. The movie,
library ZIP, narration, source payloads and thumbnail are unchanged. Original
project/media names inside the library remain unchanged too.

Flattening verification on 2026-09-14: all 15 non-README files stayed
byte-identical, 23 local README links resolved, and all 13 archive tests passed.
A fresh CLI restore/rebuild reproduced every approved payload and the manifest
exactly. Git LFS/ignore rules passed at the new paths; repository checks added
no findings beyond the 29 pre-existing ones. No new native export was needed
for this path-only change, and no application code or specs changed.
Temporary restore/rebuild copies moved recoverably to the Git-ignored
`.demo-cleanup-recovery/flattening-path-check.52K8CU/`; they are not required
delivery assets, and the move did not reclaim their disk space.

Superseded drafts, captures and tooling remain in the Git-ignored repository-root
`.demo-cleanup-recovery/`, outside this delivery. They are not required to edit
the archived video; a new recording requires a fresh preparation pass.

[All videos](../README.md) · [Production lessons](../VIDEO-DESIGN-LESSONS.md)
