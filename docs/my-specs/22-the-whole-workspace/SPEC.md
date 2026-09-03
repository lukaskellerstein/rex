# REX 22 — the whole workspace

**Version:** 1.2 · 2026-08-31
**Status:** **built, and proven under `node --test`.** Milestones 0–3 are in the
tree; §12 records the three places the build departed from version 1.1. The
live run of §9.1 is the one check still owed. Version 1.0 was reviewed against
the reviewer's own words the same day and replaced; §11 records what moved.
**Depends on:** [`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md)
§3 (the working copy), §3.4 (the before-set), §4.3 (put-back), §7 (approve and
discard); [`21-the-file-the-agent-creates/SPEC.md`](../21-the-file-the-agent-creates/SPEC.md)
§2 (creation is kept), §3 (what "inside the workspace" means);
[`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §2 (ASK and ACT);
[`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md) §4 (the tree).

> [!note]
> **This spec moves one boundary and adds no mechanism.** ACT already runs a
> write-capable agent with every tool allowed, and REX already knows how to hold
> a change in a working copy and show it in two panes. What ACT cannot do is
> apply that to a file the comment is not anchored to. §2 lets it, for every
> text document under the workspace root, by giving each one the working copy
> the anchored document already gets. ASK is untouched.

---

## 1. Why

An ACT run cannot edit a file the reviewer names, unless the comment happens to
be anchored to it. It can *create* the file. It cannot *change it again*.

### 1.1 The report, from the database

Thread `cd76280b`, 2026-08-31, on `docs/architecture/components.md` in the
ProtoBot repository. The `message` table, times in UTC:

| Time | Mode | The reviewer | The agent |
|:--|:--|:--|:--|
| 07:53 | ASK | asks what the WMS adapter is for | answers, 75 s |
| 08:24 | **ACT** | *"I would support having an adapter that will use just the local files…"* | **creates** `Lukas feedback.md` at the repository root — `File created successfully` (seq 33). Spec 21 §2 keeps it. |
| 08:36 | ASK | *"the feedback in the Lukas feedback file is correct, right?"* | reads the file, says yes |
| 08:42 | ASK | *"Ok so update my first feedback in the Lukas feedback file."* | *"I can't write to files here — this session is read-only on the repo. Here is the replacement… ready to paste over it."* |
| 08:43 | **ACT** | *"…just a simple explanation of what feedback exactly should be added to the documentation, to what file and what lines."* | *"No file changes: the discussion asked for feedback, not an edit to `components.md`, and `Lukas feedback.md` isn't in my editable set."* — `Applied to 0 file(s)`. |

Two refusals, and they have different causes.

### 1.2 The 08:42 refusal — ASK, working as designed and answering badly

The message was sent in ASK. The `read` profile cannot write (`main/agent/profiles.ts:73`,
enforced at `main/agent/gate.ts:892`), and that is spec 01 §8.4's whole
guarantee — nothing here changes it. What is wrong is the answer. *"This session
is read-only"* is true and useless: the reviewer is one switch away from a mode
that can write, and nothing told them. §6.2 fixes the sentence.

### 1.3 The 08:43 refusal — ACT, and the list

The message was sent in ACT. The write profile ran, with every tool allowed.
`writePrompt` (`main/apply.ts:294`) handed it one editable file — the working
copy of `components.md` — and followed the list with:

> Anything you write outside the list above is put back and reported.

The list comes from `pathsOf` (`main/apply.ts:199`): the documents the comment is
anchored to, nothing else. `Lukas feedback.md` existed by then, and
`createParagraph` (`main/apply.ts:245`) says an existing path is put back
*"whatever you called it"*. The agent obeyed both sentences, said so, and wrote
its answer into the thread instead. That is the behaviour this spec replaces.

### 1.4 Spec 21 fixed the first write and left the second

Spec 21 §1.1 sorted the agent's acts into two: a **creation** destroys nothing
and is kept; a **modification** destroys bytes and is put back. That is why the
08:24 write survived and the 08:43 one could not have.

The sorting is right and the remedy for a modification is wrong. REX has a
better answer for "the agent changed bytes the reviewer had" than putting them
back, and it has used it since spec 15 for the one file it applied to: **keep
both versions, show them side by side, and let the reviewer choose.** This spec
gives every other text document the same answer.

---

## 2. The rule

> **An ACT run may edit any text document under the open workspace root. Every
> file it edits gets a working copy — the same `base`, `.new` and two panes the
> anchored document gets — and the file on disk is not touched until the
> reviewer approves it.**
>
> Outside the workspace root, nothing changes: spec 15 §4.3 still puts every
> stray write back.

### 2.1 "Under the workspace root"

Spec 21 §3 already defined it and this spec reuses that definition: `isInside`
(`main/workspace/created.ts`) resolves both paths and asks `relative()` for a form
with no leading `..`. The `SKIP_DIRECTORIES` list (`created.ts:19`) still
applies — `.git`, `node_modules`, `dist` and the rest hold nothing a reviewer
reads, and a write into one is put back as today.

The write run's own root is the **repository** root (`main/apply.ts:691`,
`groupByRepository`), and its before-set is taken per repository. So the
boundary is *under the workspace root and inside the run's repository*. For a
workspace that is one repository — the common case, and the reported one — the
two are the same folder.

### 2.2 "Edit", and "text document"

The reviewer's words: *editing, meaning adding some text, removing some text,
or rewriting some text. Any file will create a copy. Any extension will create
a copy of it if it allows for editing.*

"Allows for editing" is `isTextDocumentPath` (`main/render/formats.ts:71`):
Markdown and HTML — the formats whose bytes are the prose, so an agent's `Edit`
is a change to the document and the two panes can draw both versions.

| The agent edits… | What happens |
|:--|:--|
| a Markdown or HTML file under the root | a working copy — this spec |
| a `.docx` or `.pptx` under the root | put back and reported, as today. Both are zips, and an agent's `Write` into one is corruption, not an edit. Their edit route is the plan of spec 11 §7 and spec 19 §4, which runs per anchored document and is not widened here. |
| a `.pdf` | put back. Spec 19 §8 refuses to edit a PDF by decision. |
| any other file — code, config, an image | put back and reported, as today. REX cannot show two versions of it, so it cannot offer the approve step, and a change with no review is what this design exists to avoid. |

The last row is the one assumption in this spec that the reviewer did not state.
It follows from "if it allows for editing", and it is easy to reverse later: the
put-back already happens and would simply stop.

### 2.3 A workspace must be open

`root` is already on the ACT request (`shared/channels.ts:226`) and already
null when nothing is open (`renderer/overlay/App.tsx:1725`). Null keeps the
current rule exactly: the list stays the anchored documents, and everything
else is put back.

### 2.4 Why this is safe, stated plainly

Nothing lands on disk that the reviewer has not approved — the same promise spec
15 makes for the anchored document, kept the same way. The run ends, the
reviewer's files hold what they held before it, and the agent's version sits in
`~/.rex/work` beside a copy of the original, waiting for Approve or Discard.

That is a *stronger* promise than the one spec 21 gives a created file, which
lands immediately, and the reviewer has said that is fine: they can delete a
file themselves.

---

## 3. The mechanism — the copy is made when the run ends

REX cannot fork a working copy for `Lukas feedback.md` before the run, because
it does not know the agent will touch it: the instruction names the file in
prose, or names nothing and the agent decides. So the copy is made **after**,
from the two things REX already has at that moment — the agent's bytes on disk,
and the original bytes it can put back.

`putBack` (`main/stray.ts:68`) already walks every file the run wrote outside its
list, and for a modification it does this: stash what the agent wrote, then
restore the original from the before-set or with `git checkout`. This spec adds
one branch after the restore, for a modification that is a text document under
the workspace root:

1. Restore the original exactly as today. The disk is now the reviewer's bytes.
2. `upsertDocument` for the path, so the file has a document row and an id.
   Apply already keys every working copy by document id
   (`documentIdsByPath`, `main/apply.ts:787`, used at `:673`); a fresh `uuidv4`
   from `upsertDocument` (`main/db/queries.ts:195`) is fine here, because the
   working copy is keyed by that id and found by path.
3. `forkWorkingCopy(id, path)` (`main/work.ts:196`). `base` and `.new` are both
   the original — which is what a fork is.
4. Write the stashed agent bytes over `.new`, and `saveRevision` against the
   run, so the revision belongs to this ACT run like any other.
5. Report the file under `changed` (§5.1) — not `restored`, because nothing was
   lost, and not `created`, because it was already there.

Every step is a function that exists. The new code is the branch and the order.

### 3.1 Where the original bytes come from

The two sources spec 15 §4.3 and spec 21 §2.3 already use, and no third:

| The file was… | Original bytes from | Notes |
|:--|:--|:--|
| listed by `git status` — modified or untracked | the before-set, taken before the run (`main/apply.ts:395`) | exact bytes; capped at 32 MB across the set |
| tracked and clean | `git show HEAD:path` / `git checkout` | what the reviewer had, by definition |
| **gitignored** | nowhere | no working copy can be made; put back is impossible too. Reported, and left as the agent wrote it — the same outcome as today. |

The gitignored row is the one gap, and it is stated rather than closed. A
reviewer's `.env` is not review material, and building a snapshot mechanism for
it is what version 1.0 did and §11 removed.

### 3.2 Why not fork up front, and why not redirect the tool call

**Up front** needs the path before the run. REX does not have it (§3).

**Redirecting** is possible in principle — the SDK's `PreToolUse` output takes
`updatedInput` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2206`), so
a hook could fork on the first `Edit` and point the call at `.new`. It breaks on
the SDK's own `Edit` tool, which refuses to edit a path it has not `Read`, keyed
by path: the agent read `Lukas feedback.md`, the hook redirects the edit to
`~/.rex/work/<id>/Lukas feedback.new.md`, and the tool answers *"File has not
been read yet"*. Redirecting reads as well means forking on every read, which
copies files nobody edits. The end-of-run swap has none of this.

### 3.3 The run's own book-keeping

The 08:24 run in §1.1 is still `pending` in `apply_run` with `files_json = []`
— a run that only created a file never completed, because completion happens
through `approveWorkingCopy` (`main/ipc.ts:411`) and a created file has none.
Under this spec a run whose only work was a widened edit has a working copy and
a revision, so it completes the way every other run does. The created-only case
is unchanged and out of scope.

---

## 4. What each act becomes

| The agent… | Today | Spec 22 |
|:--|:--|:--|
| edits the anchored document's working copy | kept; two panes; revisions | **unchanged** |
| **edits** a Markdown or HTML file under the workspace root | put back, listed in `restored` | **working copy**, listed in `changed`, two panes on open |
| edits any other file under the root | put back | **unchanged** — §2.2 |
| **creates** a file under the root | kept where written (spec 21 §2) | **unchanged** |
| writes anything outside the root | put back | **unchanged** |
| writes into `~/.rex/work` | reported as `misplaced` (spec 21 §13) | **unchanged** |

One row moves.

---

## 5. What the reviewer sees

### 5.1 The notice

`ApplyReadyEvent` (`shared/channels.ts:378`) gains one field beside `restored`,
`created` and `misplaced`:

```ts
/** Spec 22 §3 — text documents under the workspace root the agent edited, now held as working copies. */
changed: string[];
```

Repository-relative, like the other two. The notice names them and says where
to look: *"`Lukas feedback.md` has a new version — open it to review."* The
working-copy list the shell already keeps (`COMMAND.workList`, `main/ipc.ts:402`)
is refreshed, so the file shows there with the others.

### 5.2 The panes

Nothing new. The reviewer opens the file; `doc:open` finds the working copy by
path (`readMetaByPath`, `main/ipc.ts:368`) and draws ORIGINAL beside NEW
VERSION; Approve writes `.new` over the file and Discard deletes the copy —
`COMMAND.workApprove` and `COMMAND.workDiscard` (`main/ipc.ts:406`, `:420`),
exactly as for the anchored document. `approveWorkingCopy` (`main/work.ts:334`)
refuses if the disk no longer matches `base`, which protects a file the reviewer
edited themselves in the meantime.

### 5.3 No undo button

The reviewer asked for none, and the design does not need one: Discard *is* the
undo for an edit, and a created file is one they can delete by hand. Version
1.0's stash directory and its undo path are gone (§11).

---

## 6. What the prompts say

### 6.1 ACT — the write prompt

`writePrompt` keeps its editable list, because the working copies are still
where the anchored document is edited and the passage line numbers come from
them. The sentence after the list changes. Today (`main/apply.ts:305`):

> Edit those files in place. They are REX's working copies: the reviewer has not
> accepted these changes yet, so the originals must not be touched. Anything you
> write outside the list above is put back and reported.

With a workspace open, the last sentence becomes a paragraph that names the
root — an address, never a pronoun (spec 21 §13):

> The reviewer's workspace is `<root>`. You may also edit any Markdown or HTML
> file under it, in place. REX will hold your version beside the original and
> the reviewer will approve or discard it, so make the change they asked for
> rather than describing it. Do not change files they did not ask about.
> Anything you write outside `<root>` is put back and reported.

With no workspace open the current sentence stands.

*"Make the change they asked for rather than describing it"* is the line that
answers 08:43 directly. The agent was not unable to write; it was told, by the
current prompt, that writing there would be undone, and it chose the sensible
thing.

### 6.2 ASK — the read prompt

One sentence added to `READ_SYSTEM_PROMPT` (`main/agent/prompts.ts:14`):

> If the reviewer asks you to change a file, say that this message was sent in
> ASK, that ASK cannot write, and that the same request sent with the switch on
> ACT will make the change. Do not paste the change into the thread.

This answers 08:42. The refusal was correct; the reviewer had to guess what to
do about it, and pasting 45 lines of replacement text is not the help it looks
like.

---

## 7. What this gives up

1. **Only Markdown and HTML widen.** A `.docx` or `.pptx` the agent edits by
   hand is still put back, because there is no honest two-pane view of a zip
   the agent spliced bytes into. Their plan route stays per anchored document.
2. **A gitignored file has no working copy.** §3.1. The agent's write stays
   on disk and is reported.
3. **The before-set cap still applies.** A repository with more than 32 MB of
   modified-or-untracked files refuses the run before it starts, as today
   (`main/work.ts:368`). Widening does not change what the set holds.
4. **Bash writes reach the copy only if git saw the file.** `sed -i` names no
   path a tool call carries; the before-set catches it for a listed file and
   `git` for a tracked one. For a gitignored file it is row 2.

---

## 8. What this does not do

- **It does not touch ASK's guarantee.** The `read` profile still cannot write
  by any route. §6.2 changes one sentence of what it *says*.
- **It does not add delete, rename or move.** They were not asked for. A file
  removed by `rm` is put back by spec 15 §4.3 as today, and that is right until
  someone asks otherwise.
- **It does not add an undo button.** §5.3.
- **It does not parse Bash**, for the reason `gate.ts:19` gives.
- **It does not change what a created file does.** Spec 21 §2 stands.

---

## 9. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| 0 | The adoption, testable alone | `adoptAsWorkingCopy(id, path, agentBytes)` in `main/work.ts`, and the fifth answer `"adopt"` in `classifyStray` (`main/stray.ts`). `node --test` against real files and a real repository: a modified untracked file, a modified tracked file, a gitignored file, a `.docx`, a file outside the root. Each lands in the right column. |
| 1 | The run reports it | `changed` on `ApplyReadyEvent`; `putBack` returns it; `apply.ts` creates the document row and the revision. `test/stray.spec.ts` extended. |
| 2 | The reviewer sees it | The notice sentence; the working-copy list refreshes; opening the file draws the two panes; Approve and Discard work on it. |
| 3 | The prompts | §6.1 and §6.2, and the live run in §9.1. |

### 9.1 How milestone 3 is checked

In `~/Projects/Github/lukaskellerstein/my-ecommerce`, opened as the workspace.
Open a Markdown document, comment on any passage, and:

1. In **ASK**, ask for a change to a second Markdown file at the repository root.
   Done when the answer names ASK and ACT and pastes no replacement text.
2. In **ACT**, send the same request. Done when: the file on disk is unchanged
   (`git status --porcelain` shows nothing for it); the notice names it under
   `changed`; it appears in the working-copy list; opening it shows the two
   panes; Approve writes the agent's text to disk and `git status` then shows
   it modified; Discard on a second attempt leaves it untouched.
3. In **ACT**, ask for a change to a `.docx` in the same repository. Done when
   it is put back and reported, exactly as today.

---

## 10. Rejected

| Idea | Why not |
|:--|:--|
| Edit in place with a stash and an undo button (version 1.0) | The reviewer does not want an undo button, and in-place editing gives up the approve step for the widened files. A working copy keeps the promise spec 15 already makes. |
| Add the file to the list when the instruction names it | Needs a path parsed out of prose. It fails on "the feedback file" and on any file the agent decides to touch on the way. |
| Redirect the agent's `Edit` to the copy with `updatedInput` | Breaks on the SDK's read-before-edit check, §3.2. |
| Fork a working copy for every text document in the workspace before the run | Copies everything to catch one file, and the before-set cap exists to refuse exactly that. |
| Widen to every file type and show a plain diff for the ones REX cannot render | A diff of a `.pptx` is a diff of a zip. The rule "if it allows for editing" is the reviewer's, and it is the right cut. |

---

## 11. What changed from version 1.0, and why

Version 1.0 was reviewed the same day against the reviewer's request and three
answers, and each moved something:

| Reviewer said | 1.0 had | 1.1 has |
|:--|:--|:--|
| *"The agent is in ACT mode and he doesn't want to create the file… I'm asking him to re-write the file."* | a why-section built from a summary | §1.1, built from the `message` table: the file **was** created at 08:24 in ACT; the 08:42 request was in ASK; the 08:43 ACT refusal cited the list. Two causes, two fixes (§6.1, §6.2). |
| *"No undo button is needed. I can just remove the file by myself."* | a stash directory, an undo path, two milestones for them | gone. Discard is the undo for an edit; a created file is the reviewer's to delete. |
| *"Any file will create a copy. Any extension will create a copy of it if it allows for editing."* | in-place editing for every widened file, with no two-pane review — listed under "what this gives up" | the working copy for every Markdown and HTML file the agent edits, drawn in the same two panes, approved the same way. §2.2 is the reviewer's sentence made precise. |

Two factual errors in 1.0 are also corrected. It claimed an untracked file
changed by Bash could not be undone; the before-set holds every file `git
status` lists, so it can, and only a gitignored file cannot (§3.1). And its test
named the ProtoBot repository, which is a reviewed repository and never a test
fixture; §9.1 uses `my-ecommerce`.

---

## 12. Where the build departed from version 1.1

### 12.1 A pending copy is on the list

§3 said nothing about the **second** run. A reviewer who does not approve the
first adoption and asks for one more change would have had the agent read the
file on disk — the reviewer's bytes, since §3 step 1 put them back — and write
over `.new` with an edit that knows nothing of the first. The first run's text
would survive only as `.v1`, which nobody opens.

So `writePrompt`'s editable list now includes every working copy this workspace
already holds for a Markdown or HTML file in the run's repository
(`pendingCopiesIn`, `main/apply.ts`), other than the anchored documents that are
on it anyway. The agent edits `.new`, the second run builds on the first, and
the revision lands on the same copy the way it does for the document under
review. The notice names such a file under `changed`, since the comment is not
about it.

### 12.2 A write that changed nothing makes no copy

A tracked, clean file the agent named and wrote unchanged is a suspect from
`wrote` alone — the before-set never held it, so `putBack`'s "named but never
changed" test could not exclude it. Adoption compares the agent's bytes with
the restored original and stops when they match: no fork, no revision, and no
document row for a file nothing happened to. `test/stray.spec.ts` pins it.

### 12.3 A restore that fails adopts nothing

Step 1 can fail — a permission, a submodule boundary. A copy forked then would
call the agent's bytes the original, and Approve would write them over
themselves. The branch leaves the file as written and says so in the log,
which is what the other restore branches do with the same failure.

### 12.4 How it was tested

`test/created.spec.ts` (27) states the rule: ten cases for `adopt`, and the
three put-back cases moved to a `.json` so they still test a put-back.
`test/stray.spec.ts` (22) runs the mechanism against a real repository: a
tracked clean file, a dirty file whose `base` must be the reviewer's edit, a
second run stacking a revision, an HTML file, an unchanged write, the absence
of a `_restored` stash, and the no-workspace case. `test/work.spec.ts` and
`test/prompts.spec.ts` are unchanged and pass; `tsc --noEmit` is clean.
