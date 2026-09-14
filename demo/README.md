# REX demo videos

Videos are numbered in original production order. Each video has a stable ID
and one retained approved delivery; working revisions are not separate videos.

| Order | Video ID | Approved delivery | Approved |
| :-- | :-- | :-- | :-- |
| 01 | [01-rex-overview](01-rex-overview/README.md) | [final](01-rex-overview/final/README.md) | 2026-09-14 |

Continue the current video from
[01-rex-overview/final/README.md](01-rex-overview/final/README.md).
That archive contains the approved MP4, a native Final Cut library ZIP with all
25 required media assets, source notes, captions, music and restore instructions.
Editing still requires the documented motionVFX templates and fonts.

New videos use the next unused zero-padded number and a descriptive lowercase
slug: `02-<name>`, `03-<name>`, and so on. Keep assigned numbers stable; do not
renumber existing videos or reuse retired IDs. Updates to the overview stay
under `01-rex-overview/`, not video 02. Keep `README.md`, `final/` and `youtube/`
directly inside each video's folder, with no extra version-directory layer.
Prepare edits in ignored `.work/` material; replace a retained delivery only
after approval and a confirmed recovery plan. Add each new video to this index.

The current [YouTube package](01-rex-overview/youtube/README.md) includes title,
description, chapters, upload notes and a generated thumbnail. Future final
approvals should trigger this package automatically; the corresponding installed
skill update is pending outside this checkout, as recorded in the lessons.

[VIDEO-DESIGN-LESSONS.md](VIDEO-DESIGN-LESSONS.md) preserves the requested
production experience and recommendations for improving the video-design skill.
It covers post-approval cleanup, numbered video IDs, YouTube packaging,
and retention of the narrator's generation settings. The current narrator and
exact settings are documented in the
[archive README](01-rex-overview/final/README.md#voiceover-settings)
and saved in that archive's `source/storyboard.json` under `meta.voice`.

The retained archive uses `demo/<number>-<video-id>/final/`.
This migration does not modify the installed plugin's single-video capture
pipeline; extending all its stages to per-video roots remains a documented
skill improvement. Do not run it against a retained archive as a working folder.

The old `assets/`, `audio/`, `capture/`, `out/`, `prep/` and `studio/` folders
were removed during the approved cleanup, along with duplicate planning files.
They are not needed to edit the archived video. Source storyboard/timeline
snapshots remain in `01-rex-overview/final/source/`; they describe the old recording pipeline,
not a runnable capture setup. Future re-recording needs a fresh preparation
pass. No application code or external sample project was changed by cleanup.

Removed local files are temporarily recoverable under the Git-ignored
`.demo-cleanup-recovery/` at the repository root. That directory is not part of
the retained demo or its Git archive, and moving files there does not reclaim
their disk space. Nothing was committed or pushed.
