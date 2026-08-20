---
description: "Step 3: Implement — coding rules and this project's layout"
---

# Step 3: Implement

Write clean code from the start. Follow these rules during implementation:

- Do NOT commit via `git` unless explicitly instructed by the user
- When creating diagrams or graphs, use `mermaid`
- Write clean code from the start — don't plan to "clean it up later"
- Refactor continuously — improve code structure immediately when you see issues
- Remove dead code — delete unused functions, variables, imports, and commented code
- Before changing any signature, renaming, or deleting something shared, find
  every caller with `findReferences` where the `LSP` tool is available — grep
  misses the ones spelled differently and finds ones that are not calls.
  [`lsp.md`](lsp.md)
- After writing code: review comments, clean up imports, check for side effects

## Build in milestone order

`SPEC.md` §13 defines nine milestones, each ending in something runnable with
acceptance criteria you can actually run. Do not work ahead of them.

> **Milestone 0 is a gate.** Do not build the app before the anchor spike
> passes. The anchor resolver is the only component that fails silently — if it
> does not survive a real document edit, the design needs rework, and that is
> far cheaper to learn in 150 lines than in milestone 6.

Two standing rules from `SPEC.md` §0 that apply to every change:

- **Verify every Claude Agent SDK symbol before you use it.** `SPEC.md`
  describes *what* to build using Python names from the Vex reference
  implementation. It gives no TypeScript signatures, because they were not
  verified when it was written. Read `https://code.claude.com/docs/en/agent-sdk`
  first — do not assume the TypeScript binding names match the Python ones.
- **Where the spec is silent, prefer the simplest thing that works.** Do not add
  features. §12 lists what is deliberately out of scope.

## `src/main/` — the privileged process

Owns SQLite, the Agent SDK, and the filesystem. Per invariant I2, this is the
**only** place credentials and a database handle may exist.

Belongs here: the thread service, the agent runner and its profiles/gate/prompts,
the document renderers, Apply orchestration.

Must NOT be here: anchor *resolution* (invariant I1 — the resolver runs in the
renderer, on the live DOM, because a `<webview>` showing a remote page has no
local file for the main process to search).

## `src/renderer/` — the untrusted-content process

Displays documents that may contain anything. Holds no database handle and no
credentials.

Belongs here: the overlay (inside a shadow root, always), selection handling,
the anchor resolver, highlight painting.

Must NOT be here: any direct SQLite or Agent SDK access; any mutation of the
document under review. Never wrap a range in `<mark>` or any other element —
`SPEC.md` §6.7 is explicit that this is a correctness requirement, not a style
preference.

## `src/shared/` — the contract between them

`types.ts` is the single source of truth for every shape (`SPEC.md` §4 is
complete and can be copied verbatim). `channels.ts` declares every IPC channel
name and payload type (`SPEC.md` §10).

Must NOT be here: anything that imports from `main/` or `renderer/`.

## `src/preload/` — the bridge

The `contextBridge` surface, and nothing else. Keep it minimal: everything
exposed here is reachable by document content.

## `test/`

`anchor.spec.ts` is milestone 0 and stays runnable afterwards — it is the
regression net for the component that fails silently.

## Repository structure

**Today** — the repo is pre-implementation:

```text
rex/
├── .claude/              this scaffold
├── .editorconfig         shfmt marker
├── .gitignore
├── .markdownlint-cli2.yaml
├── .mcp.json             playwright-rex, CDP :9334
├── biome.jsonc           JS/TS formatter + live linter marker
├── README.md
└── SPEC.md               the authority — 1,135 lines
```

**Planned** — `SPEC.md` §3.1, which is the layout to build toward. Nothing below
exists yet:

```text
rex/
├── package.json
├── tsconfig.json
├── electron.vite.config.ts
├── src/
│   ├── main/
│   │   ├── index.ts                 app bootstrap, window creation
│   │   ├── ipc.ts                   channel registration (§10)
│   │   ├── db/
│   │   │   ├── schema.sql           §9, verbatim
│   │   │   ├── database.ts          open, migrate, WAL
│   │   │   └── queries.ts           typed query functions
│   │   ├── agent/
│   │   │   ├── runner.ts            ported adapter (§11)
│   │   │   ├── profiles.ts          read / write profiles (§8.2)
│   │   │   ├── gate.ts              PreToolUse deny hook (§8.4)
│   │   │   ├── prompts.ts           system + user prompt templates (§8.6)
│   │   │   └── transcript.ts        JSONL replay (§8.5)
│   │   ├── render/
│   │   │   ├── markdown.ts          markdown-it + data-src-line (§5.3)
│   │   │   ├── html.ts              sanitise + serve (§5.4)
│   │   │   └── index.ts             dispatch on DocumentRef
│   │   └── apply.ts                 Apply orchestration (§8.7)
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx                 mounts the shell
│   │   ├── overlay/
│   │   │   ├── Overlay.tsx          shadow root host
│   │   │   ├── Gutter.tsx           markers
│   │   │   ├── CommentCard.tsx      thread view + chat
│   │   │   ├── Sidebar.tsx          all threads, filters
│   │   │   └── OrphanTray.tsx       unresolvable anchors
│   │   └── anchor/
│   │       ├── textIndex.ts         normalise + offset map (§6.3)
│   │       ├── create.ts            Range → Anchor (§6.4)
│   │       ├── resolve.ts           Anchor → Range (§6.5)
│   │       └── highlight.ts         CSS Custom Highlight API (§6.7)
│   ├── shared/
│   │   ├── types.ts                 §4, the single source of truth
│   │   └── channels.ts              IPC channel names + payload types
│   └── preload/
│       └── index.ts                 contextBridge surface
└── test/
    ├── anchor.spec.ts               milestone 0 lives here
    └── fixtures/
```
