# REX 34 — the copy is permanent

**Version:** 1.0 · 2026-09-02
**Status:** **built, and driven in a live window.** All five milestones are in
the tree; `npm run test:work` (32), `test:runs` (12), `test:prompts` (24),
`test:stray` (22), `test:workspace-files` (20) and `test:debug` (22) are green,
`npm run typecheck` passes and `nvim-tools --json --all` adds no finding. §11
milestone 4 was run on 2026-09-02 against an isolated REX on port 9444 with its
own database and store — §12 records what it showed, including two faults it
found that the tests had not.
**Depends on:** [`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md)
§3 (the working copy), §3.3 (its life), §4.2 (a copy exists only while it
differs), §5 (iterating), §7 (approve, undo, discard);
[`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md) §4 (what each
pane allows), §5.3 (what happens when the proposal ends), §5.4 (what the agent
is told); [`17-stopping-a-run/SPEC.md`](../17-stopping-a-run/SPEC.md) §2.1 (the
runs in flight) and §3.2 (`stopped` is a lifecycle marker);
[`22-the-whole-workspace/SPEC.md`](../22-the-whole-workspace/SPEC.md) §3 (a file
the agent edited in place is adopted) and §12.1 (pending copies join a run);
[`23-renaming-and-deleting-a-file/SPEC.md`](../23-renaming-and-deleting-a-file/SPEC.md)
§4.1 (a copy follows its file); [`24-pointing-mid-conversation/SPEC.md`](../24-pointing-mid-conversation/SPEC.md)
§6.1 (a follow-up that adds places).

> [!note]
> **This spec adds no feature. It reverses one rule of spec 15 §4.2** — *"a
> working copy exists only while it differs from the file"* — and replaces it
> with: **the copy exists from the first time an agent is pointed at the
> document, at one path, and is never deleted.** Approve, discard and undo move
> content between the file and the copy. None of them moves the copy. An agent
> that learned where the document is on its first turn is right on every turn
> after.

---

## 1. Why

### 1.1 What was measured

Thread `f54f2c9a`, 2026-09-02, a comment on `lukas-feedback.md` in the ProtoBot
workspace. The reviewer pressed ACT. Eight tool calls failed on the same path,
and the debug report the reviewer pasted was the first sign of it:

| Time (UTC) | What happened |
|:--|:--|
| 12:11:47 | an earlier working copy of the document is approved. Its directory is deleted (spec 15 §7.2 step 4) |
| 12:17:21 | the reviewer writes the comment. One pane, one version — no copy exists |
| 12:17:22 | ASK runs. The prompt says `Document: lukas-feedback.md` |
| 12:25:07 | the reviewer presses ACT. REX forks a copy and names it in the prompt: `~/.rex/work/74a06aa7-…/lukas-feedback.new.md` |
| **12:25:18** | the agent reads that path. **`File does not exist`** — eight times over the next forty seconds |
| 12:25:58 | the agent gives up on the path and edits the reviewer's file in place |
| 12:28:45 | the run ends. Spec 22 §3 puts the file back and adopts the agent's bytes as a fresh copy |
| 12:32:25 | the reviewer approves that copy |

The run recovered, because spec 22 exists. It also spent forty seconds and part
of $1.33 on a file REX had named and then removed. What removed it left no
trace: a fork that has not changed yet has no revisions, so approve, discard
and undo all write nothing to the database when they delete it. Between 12:11
and 12:26 no other agent produced a message, so the only remaining cause is a
button the reviewer pressed — `Approve`, `Approve all`, `Discard` or `Undo` —
while the run held the copy.

The reviewer's words, after the analysis:

> I want to be able to run multiple agents at once on the document because I'm
> usually running them on different parts of the document.

and, on the fix first proposed:

> I don't want to have some workarounds or half-working solutions. I want to
> think about it, think it through, understand what I am trying to achieve, and
> propose a proper fix, a proper systematic fix that would work always without
> these hacks.

### 1.2 One cause

A document has two things: **what it is** and **where it is right now**. What
it is — `lukas-feedback.md`, document `74a06aa7` — never changes. Where it is
changes: the reviewer's file, or REX's copy of it. REX hands the agent the
second one.

Spec 15 §4.2 is what makes the location move. A copy is forked on the first ACT
run, deleted on approve, deleted on discard, deleted by the end-of-run sweep
when the run changed nothing, and deleted by the start-up sweep for the same
reason. Every one of those is a moment after which every agent that remembers
the old location is wrong.

What each mode is told today, for the same document:

| Moment | ASK is pointed at | ACT is pointed at |
|:--|:--|:--|
| no copy | the file | a copy forked this instant |
| a copy exists | the copy | the copy |
| just approved | the file | a copy forked this instant |
| just discarded | the file | a copy forked this instant |

Two locations, and which one depends on the moment. The agent's memory does
not update when the moment passes.

### 1.3 Four consequences, from that one cause

1. **A path in a prompt can be deleted under a running agent.** §1.1. Nothing
   guards it: `work:approve`, `work:discard`, `work:undo`, `Approve all`, the
   sweep in `thread:apply`'s `finally`, and the sweep at start-up all remove
   directories without asking who is using them.
2. **ASK and ACT can be pointed at different paths for the same document**,
   depending on whether a copy happened to exist at send time.
3. **A resumed ASK session remembers a path from its last turn.** A reply with
   no new place is sent as the bare text (`thread:reply`, spec 24 §6.1), so the
   agent reads from memory. After an approve that path is gone. After an ACT
   run it is the wrong version. Both are silent.
4. **The end-of-run sweep is machine-wide.** `discardUnchangedWorkingCopies()`
   walks every copy on the machine. A fork made a second ago matches its base,
   so one run's end can delete another run's fresh copy of a different document.

### 1.4 Why the obvious fixes are not enough

**A `Document:` line on every turn.** It cures consequence 3 by telling the
agent where the document is, again, every time. That is REX apologising for its
own design once per turn, and the reviewer said so.

**A hold alone** — refuse approve, discard and undo while a run uses the copy.
It cures consequence 1 and 4. It keeps two locations, so 2 and 3 stay.

**One copy per run**, so that agents never share a file. The second approve is
then refused: the file moved on disk since that copy was made (spec 15 §7.3),
and REX does not merge. The reviewer keeps one agent's work and loses the
other's — the opposite of what §1.1 asked for.

All three treat the symptom. The cause is the moving location, and the fix is
to stop it moving.

---

## 2. The rule

> **From the first time an agent is pointed at a document, REX's copy of it
> exists at one fixed path and is never deleted.**

Everything else in this spec follows from that sentence.

**"Pending" replaces "exists".** Today one question — *does the copy exist?* —
stands in for two different ones, and it answers both wrongly once the copy is
permanent:

| The question actually being asked | Today | After this spec |
|:--|:--|:--|
| Is there a change waiting for the reviewer? | the directory exists | `hash(copy) ≠ baseSha256` — **pending** |
| Where is the current version of this document? | the copy if it exists, else the file | **the copy, always**, once an agent has been pointed at it |

The first is `matchesBase` read backwards, and `matchesBase` already exists
(spec 15 §4.2). The second is `currentPath`, which also exists. What changes is
that nothing deletes what they point at.

How other systems solve the same problem, for the record — each fixes the
location and lets the content move:

| System | What the writer sees | What moves underneath |
|:--|:--|:--|
| a git worktree | the same relative path, always | which branch the bytes belong to |
| an overlay filesystem | one path | writes go to an upper layer; the base is untouched |
| LSP | a URI and a version number | the content; the server never reads the disk for an open document |
| Google Docs suggestions | one document | proposals live inside it; accept and reject change content, not location |

---

## 3. The store

### 3.1 The names

```text
~/.rex/work/<documentId>/
  lukas-feedback.md            the copy — the current version, what every agent reads and edits
  lukas-feedback.original.md   base — the file as it was when the copy was last synced
  lukas-feedback.v1.md         one ACT run's result, kept for undo (spec 15 §3.3)
  meta.json
```

**The `.new` infix goes.** Spec 15 §3.1 chose `<name>.new<ext>` so that an
agent saying *"the joke at `current.md:31`"* would instead say
*"`lukas-feedback.new.md:31`"*, which the reviewer could at least connect to the
document. Under this spec the copy **is** the document's current version, on
every turn, in every mode — so it carries the document's own name, and
`lukas-feedback.md:31` is a true sentence in both panes. `.original` and `.v<n>`
keep their infixes: they are not the document, they are what it was.

**The directory stays `<documentId>/`**, not a mirror of the workspace path.
The reviewer's sketch of this spec had `~/.rex/work/<workspace>/lukas-feedback.md`.
The id is kept for two reasons. Spec 23 §4.1 already moves a copy's files when
the reviewer renames the document, keyed by the id; a path-shaped directory
would have to move too, and would break for a document opened with no
workspace at all. And the agent never types the directory — it reads the path
out of the prompt — so its shape buys nothing. The mirror is the first step of
the shadow workspace in §13, and it is deferred with it.

### 3.2 Its life

Spec 15 §3.3, revised. Every row that deleted the directory now moves content
instead:

| Event | What happens |
|:--|:--|
| first time an agent is pointed at the document — ASK or ACT | the copy is made from the file. `base` is written before the agent starts |
| every later run | the agent reads and edits the copy. An ACT run that changed it saves a new `v<n>` |
| **undo last run** | the copy goes back to `v<n-1>`, or to `base` at n=1. Unchanged from spec 15 |
| **discard** | the copy is written **from** the file; `base` follows; the revision list is cleared. **The directory stays** |
| **approve** | the copy is written **over** the file; `base` follows; the revision list is cleared. **The directory stays** |
| a run that changed nothing | nothing. The copy still matches `base`, so nothing is pending, and nothing is drawn |
| the reviewer edits the file in their own editor | §3.3 |
| the reviewer renames or deletes the file | spec 23, unchanged: the copy follows, or the delete is refused while a change is pending |

The two sweeps — `discardUnchangedWorkingCopies()` at the end of `thread:apply`
and at start-up — are **deleted**. They existed to enforce the rule this spec
reverses.

### 3.3 Sync from the file

The copy can be stale in exactly one way: nothing is pending, and the reviewer
edited the file in their own editor. Then `hash(file) ≠ baseSha256` while
`hash(copy) = baseSha256`.

**`ensureWorkingCopy(documentId, path)`** is the one entry point that hands a
copy to an agent, and it syncs first:

1. No directory — make one from the file, exactly as `forkWorkingCopy` does.
2. A directory, nothing pending, file moved — copy ← file, `base` ← file,
   revisions cleared. The agent gets what the reviewer sees.
3. A directory, something pending — **no sync.** The pending change is the one
   thing REX must not throw away. If the file also moved, that is spec 15 §7.3's
   conflict: the panes say so, and approve refuses until the reviewer discards.
   Unchanged.

Nothing else syncs. `doc:open`, `work:list` and search do not touch the copy;
they ask *pending?* and read the file when the answer is no (§4). So a stale
copy is invisible until the next agent needs it, and it is fixed at that moment
by the only code that hands it out.

### 3.4 Migration

`migrateWorkingCopyNames()` (spec 15 §3.1) gains one more rename: `<name>.new<ext>`
→ `<name><ext>`. Same rules as the two it already performs — nothing is
removed, a rename that cannot be made leaves the old file where it is.

A copy that is on disk at start-up and matches its base is left alone. Under
spec 15 it was swept; under this spec it is a document whose current version
happens to equal the file, which is the ordinary state of every document.

---

## 4. Who asks what

Every consumer of `work.ts` asks one of the two questions in §2. This is the
whole list, and it is the checklist for milestone 1:

| Consumer | Question | Today | After |
|:--|:--|:--|:--|
| `doc:open` | pending? | renders the copy when a directory exists | renders the copy when pending, the file otherwise; `working` is non-null only when pending |
| `work:list` | pending? | every directory | every pending copy, with `held` (§5) |
| ASK — `readContext` | where? | the copy if a directory exists, else the file | **`ensureWorkingCopy`, the copy, always** |
| ACT — `startApply` | where? | `forkWorkingCopy` | `ensureWorkingCopy` |
| ACT — spec 22 §12.1 `pendingCopiesIn` | pending? | every directory in the repository | every pending copy in the repository |
| spec 22 §3 adopt | where? | `forkWorkingCopy`, then the agent's bytes | `ensureWorkingCopy`, then the agent's bytes — the sync in §3.3 step 2 is exactly "fork from the disk" |
| workspace search (spec 28) | pending? | the copy if a directory exists | the copy when pending, the file otherwise |
| delete a file (spec 23 §3.1) | pending? | refused when a directory exists | refused when pending |
| rename a file (spec 23 §4.1) | — | moves the copy's files | unchanged, with the new names |
| the two sweeps | — | delete what matches | **gone** |

ASK is the row that changes behaviour. Under spec 15 §5 ASK read the copy only
*while a working copy existed*, which made it read the wrong version the moment
an ACT run forked one mid-conversation (§1.3 consequence 3). Now ASK is pointed
at the copy on its first turn, and that is where the document stays. The cost
is one directory per document an agent has ever been pointed at, holding two
files that are byte-identical until something changes. That is the price of a
location that does not move, and it is small.

Decks and Word files keep their own paths. A deck is named by its text sidecar
(spec 11 §6.2), a Word file is edited by a plan REX performs (spec 19 §4.2), and
neither is a file the agent reads at a path this spec controls. `ensureWorkingCopy`
is for text documents — Markdown and HTML — and for the Word path that already
forks in `startApply`.

---

## 5. The hold

The permanent copy removes *"the file is gone"*. It does not remove *"the file
was replaced under a running agent"*: discard writes the reviewer's bytes over
the copy, approve reads a half-finished edit into the reviewer's file, undo
rewinds what an agent is in the middle of. All three are still one click away
during a run.

### 5.1 Who holds

A run **holds** every document its prompt named — the copy it was pointed at.
`runs.ts` (spec 17 §2.1) already knows every run in flight; it gains the
documents:

```ts
export function beginRun(threadId: string, documentIds: readonly string[]): AbortController;
export function endRun(threadId: string, controller: AbortController): void;
/** The documents some run is pointed at right now. */
export function heldDocuments(): ReadonlySet<string>;
```

ASK holds the thread's documents. ACT holds the documents on its "files you may
edit" list, which is the thread's documents plus the repository's pending copies
(spec 22 §12.1). A hold is a count, because two runs on one document is the
case §1.1 asked for.

### 5.2 What is refused

`work:approve`, `work:discard` and `work:undo` refuse a held document, in the
words the reviewer sees:

> An agent is working on this document. Wait for it to finish, or press Stop on
> its comment.

`work:discard` and `work:undo` return `{ ok, reason }` like `work:approve` does
today; both are `void` now and would have no way to say it.

**`Approve all`** skips held documents and names them in its summary, the way it
already names files that changed on disk (spec 15 §7.1):

> Approved 2 of 3. `lukas-feedback.md` has an agent working on it, so it was
> left alone.

### 5.3 What the reviewer sees

The three buttons on the head of the new-version pane are disabled for a held
document, with the reason as their title. The renderer already knows which
comments are running — `busyThreads`, kept for Stop (spec 17) — and which
documents each comment is about, so *held* is their union and needs no new
channel. Main's refusal is the truth; the disabled button is the affordance.

### 5.4 Stop releases

Spec 17's Stop ends the run, `endRun` drops the hold, and the buttons come back.
That is the way out for a reviewer who wants to approve now: stop the agent,
approve, send the instruction again. Spec 24 lets the same comment continue, so
it costs one run, not a conversation.

### 5.5 Why several agents may share the copy

Two agents on one document edit the same file, and their edits layer. One
approve at the end lands both. This is the model the reviewer described —
*different parts of the document* — and it is the only one in which both
agents' work reaches the file (§1.4, the third fix). What it does not protect:
two agents editing the **same lines**, where the last write wins. That is a
finer lock, and §13 defers it.

---

## 6. Reviewer actions are conversation events

After a discard, an ACT agent's transcript says *"I changed X"* and the copy no
longer has X. That is not a location problem. It is a thing that happened in
the review while the agent was not in the room, and the systematic answer is
the one spec 17 §3.2 gave to Stop: **it is a message in the thread.**

### 6.1 Recorded

`work:approve`, `work:discard` and `work:undo` write one `system` message of a
new kind, `event`, into every `open` thread on that document:

| Action | Content |
|:--|:--|
| approve | `The reviewer approved the change. The file now holds it.` |
| discard | `The reviewer discarded the change. The document is back to what the file holds.` |
| undo | `The reviewer undid the last run.` |

One sentence for both readers — the card and the agent's transcript — so it
names the reviewer rather than saying "you", which the agent would read as
itself. A discard with nothing pending, or an undo with nothing to undo, is
not an event.

`open` and not every thread: a draft or a note never had an agent, and a
resolved comment is finished (spec 18 §2). The card shows the line under the
`NOTE` mark, as every other thing REX reports.

### 6.2 Delivered

Two paths, because an agent's memory comes from two places:

- **A fresh session** — every ACT run, and an ASK reply whose SDK transcript was
  lost (SPEC.md §8.5) — gets the thread's transcript, and `renderTranscript`
  prints an `event` as a line: *The reviewer approved the change.* Nothing more
  to do.
- **A resumed session** — an ordinary ASK reply — has its own memory and gets
  only the reply. Events recorded since the agent's last message are put in
  front of it, once, and only when there are any:

```text
Since your last turn:
- The reviewer discarded the change. The document is the original again.

<the reply>
```

This is not §1.4's per-turn header. It says nothing when nothing happened, and
what it says is a fact about the conversation, not a restatement of where the
document is. The document is where it always was.

---

## 7. What the agent is told

**ASK, the opening prompt.** Spec 16 §5.4 shape, one line more, because the
path is now REX's and not the reviewer's:

```text
Document: lukas-feedback.md
Read it at: /Users/lukas/.rex/work/74a06aa7-…/lukas-feedback.md
  — REX's copy, the current version. The file in the workspace is what the
  reviewer has approved so far; do not edit either.
Line: 212
```

The section, the line numbers and the passages come from the copy, which is
what the agent will open. Follow-ups say nothing about the document, because
nothing about it has changed and nothing will.

**A replayed session gets the same header.** A reply whose SDK transcript was
lost is seeded from REX's own record (SPEC.md §8.5), and that record holds the
reviewer's notes, not the prompts — so it is a fresh session that was never
told where the document is. Milestone 4 caught it: the agent went to the
repository and read the file. `replayPrompt` now opens with the three lines
above, once, like the opening ASK.

**ACT.** Spec 15 §4.1's block, with the `.new` name gone:

```text
Files you may edit:
- /Users/lukas/.rex/work/74a06aa7-…/lukas-feedback.md
  — the current version of lukas-feedback.md
```

**Both**, when a comment is about a passage only the original has: spec 16
§5.4, unchanged. `base` is still handed as a readable path.

### 7.1 Beside it: the debug report names the mode

The report in §1.1 said `profile read` for a thread whose last run was ACT,
which sent the analysis down the wrong path for a turn. `debug.ts` prints
`thread.profile`, a column that never changes. It prints the last user
message's `mode` instead — `ask`, `act` or `note` — which is what the report
is about.

---

## 8. Changes to the earlier specs

| Spec | Section | Was | Is |
|:--|:--|:--|:--|
| 15 | §3.1 | `<name>.new<ext>` | `<name><ext>` — §3.1 |
| 15 | §3.3 | approve and discard remove the directory | they move content; the directory stays — §3.2 |
| 15 | §4.2 | a copy exists only while it differs from the file | a copy exists once an agent was pointed at the document; **pending** is the state that used to be existence — §2 |
| 15 | §5 | ASK reads the copy *while one exists* | ASK reads the copy, always — §4 |
| 15 | §7.1 | `Approve all` reports files that changed on disk | and files a run holds — §5.2 |
| 15 | §7.2 | step 4, remove the directory | step 4, `base` ← copy, revisions cleared |
| 16 | §5.3 | the table stands | unchanged: approve and discard still re-resolve every target against the file, once. The copy staying on disk changes nothing the resolver sees, because after either it equals the file |
| 17 | §2.1 | a run is a thread and a controller | and the documents it holds — §5.1 |
| 17 | §3.2 | `stopped` is the fourth lifecycle kind | `event` is the fifth — §6.1 |
| 22 | §3 | adopt forks, then writes | adopt ensures, then writes — §4 |
| 22 | §12.1 | every copy in the repository joins a run | every **pending** copy — §4 |
| 23 | §3.1 | delete refused while a copy exists | while a change is pending — §4 |

---

## 9. Where the code goes

`main/work.ts` keeps the store and loses its two sweeps:

```ts
/** §3.1 — `<name><ext>`. The copy carries the document's own name. */
export function currentPath(meta: WorkingMeta): string;

/**
 * §3.3 — the one entry point that hands a copy to an agent. Makes it, or syncs
 * it from the file when nothing is pending and the file moved. Never touches a
 * pending change.
 */
export function ensureWorkingCopy(documentId: string, path: string): WorkingMeta;

/** §2 — the change waiting for the reviewer. `matchesBase`, read the right way round. */
export function isPending(meta: WorkingMeta): boolean;
/** Every pending copy on the machine — what `work:list` and `Approve all` see. */
export function pendingCopies(): WorkingMeta[];
/** The pending copy of the document at `path`, or null — what `doc:open` asks. */
export function pendingCopy(path: string): WorkingMeta | null;

/** §3.2 — file ← copy, base ← copy, revisions cleared. The directory stays. */
export function approveWorkingCopy(documentId: string): ApproveResult;
/** §3.2 — copy ← file, base ← file, revisions cleared. The directory stays. */
export function discardWorkingCopy(documentId: string): void;
```

`forkWorkingCopy` and `discardUnchangedWorkingCopies` are **deleted**, not
deprecated — every caller of the first wants `ensureWorkingCopy`, and the second
enforces the rule this spec reverses. `readMeta`, `readMetaByPath` and
`listWorkingCopies` stay as the raw directory readers; they are what the
migration and the rename use.

| File | Change |
|:--|:--|
| `main/work.ts` | above; `migrateWorkingCopyNames` gains `.new` → plain (§3.4) |
| `main/agent/runs.ts` | `beginRun` takes the documents; `heldDocuments()` (§5.1) |
| `main/ipc.ts` | `doc:open`, `work:list`, `readContext` (§4); the three refusals and `Approve all`'s skip (§5.2); the sweep call in `thread:apply` goes; the events (§6.1); ASK's `beginRun` names its documents |
| `main/apply.ts` | `ensureWorkingCopy` in both loops; `pendingCopiesIn` filters on pending; ACT's `beginRun` names its documents |
| `main/stray.ts` | adopt through `ensureWorkingCopy` |
| `main/index.ts` | the start-up sweep goes; the migration stays |
| `main/search/index.ts`, `main/workspace/files.ts` | `pendingCopy` (§4) |
| `main/agent/transcript.ts` | `event` rendered as a line (§6.2) |
| `main/agent/prompts.ts` | the ASK opening (§7); the `Since your last turn` block for a resumed reply (§6.2) |
| `main/debug.ts` | the mode, not the profile (§7.1) |
| `shared/types.ts` | `MessageKind` gains `event`; `WorkingCopyView.held`; `WorkActResponse` for discard and undo |
| `shared/channels.ts`, `preload/index.ts` | discard and undo return a response |
| `renderer/overlay/App.tsx` | the reasons shown; `held` from `busyThreads` (§5.3) |
| `renderer/overlay/CommentCard.tsx` | `event` as an aside |
| `test/work.spec.ts` | rewritten around §3: the life table, the sync, the migration, the names |
| `test/runs.spec.ts` | the hold |
| `test/stray.spec.ts` | adopt on a permanent copy |
| `test/prompts.spec.ts` | the ASK opening; the events block; a transcript with an `event` |

---

## 10. What this does not change

- **The agent never writes the reviewer's file.** Spec 15 §2. Approve is still
  the only thing that does.
- **Where ACT is pointed.** The copy, as since spec 15. Only its name changes.
- **The pane rule.** Spec 16 §4: the right pane takes a comment only on a block
  the change added or altered. The reviewer proposed this rule again in the
  analysis of §1.1; it already exists and is not the cause.
- **Anchors after approve and discard.** Spec 16 §5.3, one re-resolve against
  the file.
- **Revisions and undo.** Spec 15 §3.3, per document.
- **The §7.3 refusal.** REX does not merge.
- **Decks and Word files.** Their own copies, their own accept and discard.
- **How many agents may run on one document.** Any number, as before — now
  without one of them deleting the other's file.

---

## 11. Milestones

**0 — the store.** `work.ts` per §3 and §9, and `test/work.spec.ts` rewritten:
the copy survives approve and discard; `pending` is the hash comparison; the
sync in §3.3 fires only when nothing is pending; the `.new` migration; the two
sweeps are gone from the module.
*Done when:* `npm run test:work` is green.

**1 — every consumer asks the right question.** §4, file by file, with
`forkWorkingCopy` deleted so the compiler finds every caller.
*Done when:* `npm run typecheck` passes, `npm run test:stray` and
`npm run test:workspace-files` are green, and `nvim-tools --json --all` adds no
finding.

**2 — the hold.** §5: `runs.ts`, the three refusals, `Approve all`, the
disabled buttons.
*Done when:* `npm run test:runs` names a held document, and a live approve
during an ACT run is refused with §5.2's sentence.

**3 — the events.** §6 and §7.1.
*Done when:* `npm run test:prompts` shows an `event` in a transcript and the
`Since your last turn` block on a resumed reply, and shows neither when nothing
happened.

**4 — driven in a live window, against §1.1.** On an isolated REX
(`REX_DB_PATH`, `REX_WORK_PATH`, port 9444):

1. ACT on a comment; while the agent runs, press `Approve` — refused, the
   agent finishes, its edit is in the copy.
2. Approve. ASK a follow-up on the same comment with no new place — the agent
   reads the copy, which equals the file, and answers about the right version.
3. Discard a change, then ACT again — the prompt's transcript says the reviewer
   discarded it.
4. Two comments on one document, ACT on both at once — both edits are in the
   copy, one approve lands both.

*Done when:* every step behaves as written, and `~/.rex/work/<id>/` still exists
after step 2 with the copy equal to the file.

---

## 12. What the live run showed

A scratch workspace with one Markdown document and two comments on different
sections of it, driven over CDP with `window.rex` calls, seven agent runs in
all. Every step of §11 milestone 4 behaved as written:

| Step | What was checked | Result |
|:--|:--|:--|
| ACT, then Approve / Discard / Undo mid-run | all three refused with §5.2's sentence; the copy existed the whole time | ✓ |
| the run ends | the copy holds the edit, the file does not; `held` is null | ✓ |
| Approve | the file holds it; **the directory is still there**, copy equals file; `doc:open` returns one pane | ✓ |
| ASK reply after the approve | the answer names `## Retry policy`; the transcript carried the approve event | ✓ |
| ASK opening on a second comment | `Read it at:` names the copy | ✓ |
| ACT, Discard, ASK reply on a resumed session | the reply opened with `Since your last turn:` naming the discard; the answer quoted the file's sentence | ✓ |
| two ACT runs on one document at once | Approve refused while both ran; `held` visible on the pending list; both edits in the copy; one Approve landed both; `revisions: 2` | ✓ |

Two faults the tests had not caught, both fixed in the same change:

- **A replayed session was never told where the document is.** A reply on a
  comment with no SDK session is seeded from REX's record, which holds the
  reviewer's notes and not the prompts, so the agent went to the repository
  and read the file — the wrong version while a change is pending. §7's
  header now opens the replay too; re-run, the agent read the pending copy and
  explained both versions.
- **Two runs ending on one copy left one revision.** Each run appended to the
  meta it had read at its start, and the second wrote `v1` over the first's.
  `saveRevision` re-reads the list from disk. Re-run: `revisions: 2`, and undo
  steps back to where the first run ended.

And one wording change: the discard event said *"the original again"*, and an
agent read that as every earlier change reverted when only the pending one was.
It says *"back to what the file holds"*.

---

## 13. Rejected

**A `Document:` line on every turn.** §1.4. It was the first fix proposed, and
the reviewer's reaction to it is what produced this spec.

**One copy per run, merged on approve.** Give every run its own directory and,
when a later approve finds the file moved, three-way merge with `git merge-file`
— clean when the parts differ, refused with markers when they overlap. It is a
correct design and a large one: the two panes need a third state, undo becomes
per run, adopt needs a run to belong to. The shared copy gives the reviewer
what §1.1 asked for — several agents, one approve — with none of that. If
approving one agent's part while another runs becomes the daily case, this is
the spec to write next, and §3.1's directory layout does not stand in its way.

**A shadow workspace.** A git worktree, or a mirror, of the whole workspace, in
which the agent's cwd is the mirror and every file it reads is consistent with
the one it edits. It is the fuller form of §2's rule and it fixes something this
spec does not: an ASK agent that greps the repository still finds the reviewer's
file, not the copy, for documents *other* than the ones the comment is about.
Deferred, not rejected — it costs a mirror per workspace kept in sync with the
reviewer's editor, and nothing in this spec has to be undone to build it.

**No path at all** — `read_document(id)` and `edit_document(id, …)` as tools,
LSP-style, so the agent never sees a location. The cleanest separation of
identity and location on paper. In practice the agent's own Read and Edit are
better than anything REX would write, it will `grep` the repository regardless
and find the file, and the deny gate would have to grow to match. Two locations
would still exist; only the prompt would stop mentioning one.

**Rewrite the path in a `PreToolUse` hook** — tell the agent the reviewer's
path and redirect every Read, Edit and Write to the copy underneath. Bash is the
leak: `sed`, `grep` and `cat` see the real file, and the agent's picture of the
document splits down the middle of a turn.

**A lock per paragraph**, so two agents on the same lines cannot race. §5.5.
Nobody has hit it, and it is a spec of its own when someone does.

**Keep deleting the copy when nothing is pending, and add only the hold.** The
old rule looked like hygiene — no directory for a document nobody changed. It
is the cause of §1.3's second and third consequences, and a hold does not touch
either. Two byte-identical files in a directory nobody looks at is not a cost
worth a moving location.
