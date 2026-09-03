# REX 24 — pointing at a place, mid-conversation

**Version:** 1.1 · 2026-08-31
**Status:** **built, and driven in a live window.** Milestones 0–3 are in the
tree; §9.1 was run against an isolated REX on `my-ecommerce` the same day, and
§11 records the four places the build departed from version 1.0 — one of them
a gap in 1.0's own premise (§11.1).
**Depends on:** [`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md)
§3 (the selection panel), §3.5 (`SelectionItem`), §5.1 (`AnchorTarget`), §5.2
(`thread_target`), §5.5 (the prompt), §5.6 (Apply covers every document);
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §3.1 (the tab
follows the reviewer), §5.3 (turns as blocks), §7 (place rows);
[`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §4 (what sending does);
[`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md) §4 (a place has
a pane).

> [!note]
> **This spec lets a comment grow.** Today the places a comment is about are
> fixed the moment it is created. Everything REX already does with a place — the
> numbered outline, the row in the card, the sweep, the prompt, the working copy
> ACT forks for its document — keeps working unchanged. What changes is *when* a
> place can join: with any message the reviewer sends, not only the first.

---

## 1. Why

A conversation with the agent cannot be pointed anywhere new once it has
started.

The reviewer's own words, 2026-08-31:

> Imagine a situation where I select some parts of the text, ask a question, and
> the agent answers me. If I do not agree with the answer, I want to point to
> another section in a different document and say something like: "Look, here
> it is written exactly the opposite of what you are saying. Read it."
>
> Currently, I do not have the option to add a new selection to the chat. We
> start with some selections and a prompt, the agent is answering, and we are
> chatting. Along the way, I want to be able to add or point out a new selection
> and write text again.

### 1.1 What happens today, step by step

1. The card for comment 4 is open. Its answer is wrong about something.
2. The reviewer opens `components.md` from the tree and drags over the sentence
   that contradicts it.
3. `addSelected` (`renderer/overlay/App.tsx:1505`) puts the sentence into the
   **selection panel**, and the edge rule at `App.tsx:336` switches the sidebar
   to the Selection tab. The card — the conversation the sentence was meant
   for — is no longer on screen.
4. The panel offers one thing: `Ask about 1`, which creates comment **5**.

Comment 4's reply box (`renderer/overlay/CommentCard.tsx:750`) takes words and
nothing else. `thread:reply` carries `{ threadId, text }`
(`shared/channels.ts:213`), and `thread:apply` carries `{ threadId, note, root }`
(`:226`). There is no field for a place, no row for it in `thread_target`, and no
sentence in any prompt that could introduce one.

### 1.2 Why pasting the passage is not an answer

The reviewer can copy the sentence into the reply. The agent then gets text with
no address: it cannot open the file the sentence is in, REX draws no highlight,
the card's place list does not mention the document, and a week later nothing
says where "here" was. Spec 04 §4 gave the first message more than one place
for exactly these reasons; a later message deserves the same.

---

## 2. Changes to specs 05 to 16

| Spec | Section | Was | Becomes |
|:--|:--|:--|:--|
| 05 | §3.1 | everything selected is added to the selection panel | added to the **open card** when one is on screen (§3.1); to the panel otherwise |
| 05 | §3.4, §5.1 | a comment's targets are fixed at `thread:create` | targets can be appended by any later send (§4) |
| 05 | §5.1 | `AnchorTarget` has `documentId`, `anchor`, `state` | gains `messageId` — the message that added it, null for the opening places (§5.1) |
| 05 | §5.2 | `thread_target` has five columns | gains `message_id` (§5.2) |
| 05 | §5.5 | the passages are listed once, in the opening prompt | a follow-up carries a `## New passages` block for the places it adds (§6) |
| 08 | §3.1 | a first place selected brings the Selection tab forward | not while a card is on screen (§3.1) |
| 08 | §5.3 | a `YOU` turn is a label and text | can carry the places it added, as chips (§3.4) |
| 12 | §4.1, §4.2 | `thread:reply` and `thread:apply` carry text | carry `targets` too, optional (§5.3) |

Nothing about the gate, the working copy, or the two panes changes.

---

## 3. What the reviewer does

### 3.1 A selection lands where the reviewer is looking

> **While a comment's card is on screen, everything selected joins that comment.
> Otherwise it joins the selection panel, exactly as today.**

"On screen" is: a card is open (`activeId` is set) **and** the sidebar is on the
Comments tab. A reviewer who has clicked the Selection tab by hand while a card
is open is building a new comment, and their selection goes to the panel.

Every gesture that makes a place follows the rule, because they all pass through
one function (`addSelected`): a drag over text, a pick with `P`, a pen drawing
with `D`, and a whole file from the tree (`selectWholeFile`, `App.tsx:1522`,
which today forces the Selection tab and stops doing so when a card is on
screen). Spec 05 §3.1's three rules — under three characters is ignored, an
extended drag replaces, an exact duplicate is refused — apply unchanged, with
one addition: **a place the comment already has is a duplicate too.** Pointing
at place 2 again is a slip, or it is "look at 2 again", and words say that
better than a second row.

Two consequences for the tab logic in `App.tsx`:

- The edge rule at `:336` is untouched. It watches the panel's list, and a place
  that lands in the card never enters that list.
- The mode effect at `:372`–`:384` — entering pick or the pen brings the
  Selection tab forward — gains the same condition. With a card on screen the
  picked places land in the card, which the reviewer can already see, so there
  is nothing to bring forward.

### 3.2 The pending places, above the reply box

The card's foot grows a strip between the conversation and the reply box. It is
absent until the first place lands.

```text
┌──────────────────────────────────────────────────────┐
│ WITH THIS REPLY                       new comment ›  │
│ 4  “Retries are capped at five.”   components.md  ✕  │
│ 5  Table · 7 rows × 4 columns      api.md         ✕  │
├──────────────────────────────────────────────────────┤
│ Look — 4 says the opposite. Read it.                 │
│                                                      │
│ (·ASK·│ ACT │ NOTE )  ⇧⇥              [ Send  ⌘↵ ]   │
└──────────────────────────────────────────────────────┘
```

| Part | What it is |
|:--|:--|
| `WITH THIS REPLY` | `.rex-label`. Under ACT it reads `WITH THIS CHANGE`; under NOTE, `WITH THIS NOTE`. |
| The number | **Numbered on from the comment's places.** A comment with three places gets `4`, `5`. This is the number the outline in the document shows and the number the agent is given, so all three agree. It is drawn in the draft outline's own colour, not the violet of a place the comment already has — it is not one yet. |
| Label and document | The same words the panel's row uses: the quote or the description, and always the file name (spec 05 §3.2). |
| `✕` | Removes the place. Removing the last one removes the strip. |
| `new comment ›` | Moves every pending place into the selection panel and switches to the Selection tab. The one escape hatch for a reviewer who meant to start comment 5 after all. |

Rows can be reordered by dragging, as the panel's can. Pointing at a row lights
its outline in the document, through the same `hoveredItemId` pairing the panel
uses.

The strip is present while the agent is working. Places can be gathered during a
run; `Send` stays disabled until the run ends, as it does today.

**Words are still required.** `Send` stays disabled with an empty box, places or
not — pointing without saying anything is not a message (spec 05 §3.4). The
tooltip on the button says how many places go with it: *"Send this reply with 2
new places"*.

### 3.3 In the document

Each pending place is outlined exactly as a panel item is — `DraftMark`
(`renderer/overlay/PaneMarks.tsx:20`) with `number` set to the place's number in
the strip, `targets.length + index + 1`. The outline is drawn only while its
card is on screen, and only in the pane the place was taken from (spec 16 §4).

So a page with the open comment's three violet badges and two pending places
shows `1 2 3` in violet and `4 5` in the draft colour. Never two `1`s.

### 3.4 After the send

The places become the comment's. The head's place list (spec 08 §7.2) grows to
five rows; the sweep resolves the new ones on the next pass and paints them
violet; `go to ›` works on them; the tree's count for `components.md` goes up by
one (spec 05 §5.7, through `thread_target`).

And the `YOU` turn that carried them says so:

```text
YOU  ASK                                            14:32
Look — 4 says the opposite. Read it.
 4  components.md     5  api.md
```

A row of place chips under the text, each clickable — the same `onGoToPlace` the
head's rows call. This is what makes the conversation readable later: the head
says the comment is about five places, and the turns say which message brought
each one. A `YOU` turn with no places is drawn exactly as today.

### 3.5 Leaving the card with places pending

Pending places belong to the comment they were picked for. They are kept in
`App.tsx` keyed by thread id, so `all comments` and back, or opening another
comment and returning, finds them where they were. Their outlines are drawn only
while their card is on screen. They are session-only, like the panel — spec 05
§3.3's reasoning applies to them word for word.

This is deliberately **not** "hand them to the panel when the card closes".
`goToPlace` (`App.tsx:2003`) closes the card and reopens it on every jump to
another document (spec 08 §7.3); a hand-over keyed on the card closing would
dump the reviewer's pending places into the panel every time they followed a
`go to ›`.

### 3.6 Synthesis threads

A synthesis thread has no places and does not take any. While its card is on
screen a selection goes to the panel, as today. Giving it targets would make a
kind of comment nobody has designed.

---

## 4. What sending does

Three sends, one addition each. In every case the places are **written to the
database first**, before any prompt is built, so `getThread` already returns
them to everything downstream.

### 4.1 ASK — `thread:reply`

`ipc.ts:562`. Today: record the text as a user message, resume the session with
the text as the prompt.

Now, when `targets` is non-empty:

1. `recordUserText` (`ipc.ts:285`) records the text. It returns `void` today
   and now returns the `Message` that `record` already gets back from
   `appendMessage`, so the id is known.
2. `appendTargets` (§5.2) writes the places after the comment's last position,
   each with that message id.
3. The prompt is `followUpPrompt` (§6.1): the new passages, then the text.
4. `runTurn` as today. On the replay path (`sessionExists` false) the same
   prompt is what `replayPrompt` is handed as the message.

### 4.2 ACT — `thread:apply`

`ipc.ts:766`. Steps 1 and 2 as above; then `startApply` runs **unchanged**.
Because the places are already rows, everything spec 05 §5.6 promises follows
without a line of new code in `apply.ts`:

| `startApply` does | so a place added with this message |
|:--|:--|
| `pathsOf` collects every target's document | brings its document into the run |
| `groupByRepository` | lands in its repository's group, or is skipped with the git reason |
| forks a working copy per editable document | gets a working copy of its own if the agent edits it |
| `passageSection` with `locate` lists every target | is listed, with the marker in §6.2 |
| `applyEnabled` / `SkippedDocument` | is skipped with a reason if it is in a PDF |

### 4.3 NOTE — `thread:note`

`ipc.ts:555`. Steps 1 and 2. Nothing runs, nothing is spent, and the comment is
now about five places instead of three — a note that points somewhere is a
useful note.

### 4.4 The card while it waits

The renderer keeps the strip until the command returns, then clears the pending
list for that thread and calls `refreshThreads()` and `sweep()`. The strip
disappears; the head list and the turn chips take over. If the command throws,
the strip stays — nothing the reviewer picked is lost to a failed send.

---

## 5. Types, data and IPC

### 5.1 `AnchorTarget`

```ts
export interface AnchorTarget {
  documentId: string;
  anchor: Anchor;
  state: AnchorState | null;
  /**
   * Spec 24 §3.4 — the user message this place arrived with, or null for a
   * place the comment was created with. It is what lets a `YOU` turn show the
   * places it added; nothing else reads it.
   */
  messageId: string | null;
}
```

### 5.2 The database

```sql
-- Spec 24 §5.1 — the message that added this place. NULL for the opening ones.
-- Plain TEXT with no foreign key: a message and a target belong to one thread
-- and leave with it, and SQLite cannot add a constraint by ALTER anyway.
message_id TEXT
```

Added to `thread_target` in `schema.sql` for a fresh database, and by the column
walk in `openDatabase` (`main/db/database.ts:91`) for an existing one. No data
moves: every existing row reads as `NULL`, which is the honest value for "the
comment was created with it".

`queries.ts` gains one function and changes one:

```ts
/** Spec 24 §4 — more places for an existing comment, after the ones it has. */
export function appendTargets(
  db: Db,
  threadId: string,
  messageId: string,
  targets: Array<{ documentId: string; anchor: Anchor }>,
): AnchorTarget[];
```

Positions continue from `MAX(position) + 1`, `anchor_state` is `NULL` (nobody
has looked — spec 05 §5.4), and the whole append is one transaction.
`targetsFor` (`:240`) reads the new column. `createThread` (`:257`) writes
`NULL` and is otherwise untouched.

### 5.3 IPC

One optional field on the two request shapes that already exist, and the same
field on the NOTE send, which reuses `ThreadReplyRequest`:

```ts
export interface ThreadReplyRequest {
  threadId: string;
  text: string;
  /**
   * Spec 24 §4 — places to add to the comment with this message, in strip
   * order. Absent and empty both mean a reply about the places it already has.
   */
  targets?: Array<{ documentId: string; anchor: Anchor }>;
}

export interface ThreadApplyRequest {
  threadId: string;
  note: string;
  root: string | null;
  /** Spec 24 §4.2 — as on `ThreadReplyRequest`. */
  targets?: Array<{ documentId: string; anchor: Anchor }>;
}
```

The element type is the one `ThreadCreateRequest.targets` already uses
(`channels.ts:189`); it is named `TargetDraft` and shared by the three. No new
channel. Main validates each place the way `thread:create` does — a
`documentId` it can find — and refuses the whole send otherwise, so a comment
never half-grows.

---

## 6. What the agent is told

### 6.1 ASK — `followUpPrompt`

A new function in `main/agent/prompts.ts`, beside `askPrompt`:

```markdown
## New passages
The reviewer has pointed at 2 more places since their last message. They are
numbered on from the places this comment already had, 1 to 3.

### shared/components.md
4. Retries are capped at five.
5. Table · 7 rows × 4 columns  (no text — an element anchor)

## Comment
Look — 4 says the opposite. Read it.
```

Only the new places are listed. On a resumed session the agent remembers the
first three from its own transcript, and listing them again would bury the two
that matter. The list is `passageSection` (`prompts.ts:487`) with one new
option, `from: number` — the position to start at — so the numbers, the
grouping by document, the relative paths and the extent and gap wording are all
the ones the opening prompt used. `## Comment` is the heading the opening used
too, so the agent sees one vocabulary.

With no places the prompt is the bare text, exactly as today: an ordinary reply
does not grow a heading.

### 6.2 ACT — one marker in `writePrompt`

`writePrompt` (`main/apply.ts:276`) already lists every target under
`## The passages under discussion` and then `## The discussion` and `## What to
do` (`writeInstructions`, `prompts.ts:468`). It stays that way. The lines for
places whose `messageId` is the message being sent end with:

```text
4. Retries are capped at five. — line 41 — added with this instruction
```

That is the whole change. It matters because the transcript under
`## The discussion` never mentions the passages — a message's `content` is what
the reviewer typed — so without the marker the agent sees five places and a
discussion that only ever spoke of three, and has to guess why.

### 6.3 What is stored is what was typed

`Message.content` stays the reviewer's words. The passages ride in the prompt
and in `thread_target`, never in the content — the rule `CommentCard.tsx:311`
states for the first message holds for every later one, and the trace sheet
keeps showing what was sent.

---

## 7. Where the code goes

| File | Change |
|:--|:--|
| `shared/types.ts` | `AnchorTarget.messageId` |
| `shared/channels.ts` | `TargetDraft`; `targets?` on `ThreadReplyRequest` and `ThreadApplyRequest` |
| `main/db/schema.sql`, `main/db/database.ts` | the column, and its walk |
| `main/db/queries.ts` | `appendTargets`; `targetsFor` reads `message_id` |
| `main/agent/prompts.ts` | `passageSection({ from })`, the `added with this instruction` suffix, `followUpPrompt` |
| `main/ipc.ts` | `recordUserText` returns the message; the three handlers append before they send (§4) |
| `main/apply.ts` | passes the sending message's id into `passageSection` so §6.2's marker can be placed — nothing else |
| `renderer/overlay/App.tsx` | the landing rule (§3.1), `pendingByThread`, the two tab conditions, the outlines' numbers, the send |
| `renderer/overlay/CommentCard.tsx` | the strip (§3.2), the turn chips (§3.4), the tooltip |
| `renderer/overlay/selection.ts` | `isDuplicate` against a stored target as well as a pending item |
| `renderer/overlay/overlay.css` | the strip, and the draft-coloured index token |

---

## 8. What this gives up

1. **ACT's greyed segment reads the stored places only.** A comment on a PDF
   whose reviewer points at a Markdown file cannot switch to ACT until that
   place has been sent once, in ASK or NOTE. `applyEnabled` is computed in main
   from `thread_target`, and computing it in the renderer from pending places
   too would be a second answer to the same question. Rare, and one extra send.
2. **A sent place cannot be taken back.** Not asked for, and the agent has read
   it: a card that dropped place 4 would show a conversation arguing about a
   passage the card no longer lists.
3. **A place is added by the reviewer only.** The agent cannot propose one. It
   can quote a file in its answer, and the reviewer can point at it.

---

## 9. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| 0 | Data and prompt, testable alone | `message_id` on `thread_target` for both a fresh and a migrated database; `appendTargets` continues the positions and writes the id; `passageSection({ from })` numbers on and lists only the tail; `followUpPrompt` renders §6.1 and, with no places, the bare text. `node --test`: `test/prompts.spec.ts` extended, and a query test against a temporary database the way `test/migrate.spec.ts` works. |
| 1 | The three sends | `targets` accepted on `thread:reply`, `thread:apply` and `thread:note`; the places are rows before the prompt is built; the ACT list carries §6.2's marker; a `documentId` main cannot find refuses the whole send. |
| 2 | The card | The landing rule; the strip with its numbers, remove, reorder and `new comment ›`; the outlines numbered on; the turn chips; the tab conditions. A synthesis card sends selections to the panel. |
| 3 | The live run | §9.1. |

### 9.1 How milestone 3 is checked

In `~/Projects/Github/lukaskellerstein/my-ecommerce`, opened as the workspace,
with two Markdown documents that disagree about something small.

1. Comment on a passage in the first document. **ASK** a question about it.
2. With the card open, open the second document from the tree and select the
   sentence that disagrees. Done when: the card stays on screen, the Selection
   tab still reads `0`, the strip shows the place as `2` in the draft colour,
   and the document shows a `2` outline.
3. Type *"Look — 2 says the opposite. Read it."* and **Send**. Done when: the
   head lists two places in two documents; the `YOU` turn carries a `2` chip
   that jumps to the second document; the trace shows a `Read` of the second
   file; the answer quotes it; the second document's highlight is painted; the
   tree shows a count on the second file.
4. Switch to **ACT**, type *"Make 1 agree with 2"*, send. Done when: a working
   copy exists for the first document and not the second; the ACT prompt in the
   trace shows `2.` ending in `added with this instruction` on the previous
   message and nothing on this one.
5. Select a third place, type a line, send in **NOTE**. Done when: the head
   lists three places, the note turn carries the chip, nothing ran.
6. Select a fourth place and press `new comment ›`. Done when: the Selection tab
   comes forward reading `1`, numbered `1`, and the card's strip is gone.
7. `git status --porcelain` in the repository shows nothing but the working copy
   approval you chose to make.

---

## 10. Rejected

| Idea | Why not |
|:--|:--|
| Paste the passage into the reply | §1.2. Text with no address: no highlight, no `go to`, nothing the agent can open, nothing a later reader can find. |
| An `Add to comment 4` button on the selection panel | The conversation is hidden while the reviewer writes their reply to it. Answering an answer you cannot see is the fault, not a fix for it. |
| One list, two verbs — the panel holds the places and both `Ask about 2` and the card's `Send` can take them | The panel numbers from 1 and the card must number from 4 (§3.3), so the same outline would wear two numbers depending on the tab. And the tab's count would say `2` about places the card is about to send. |
| A second comment linked to the first, as a synthesis is | The reviewer is continuing one argument, not opening a second. The answer has to land in the thread that was wrong. |
| Store the places inside `Message.content` as markup | §6.3. Content is what was typed. And a place has to be a `thread_target` row or the sweep, the tree's counts and Apply never see it. |
| Hand pending places to the panel whenever the card closes | §3.5 — `goToPlace` closes and reopens the card on every cross-document jump. |
| Let a sent place be removed | §8.2. |
| Relist every place in the ASK follow-up | Buries the new ones under the old on a session that already remembers the old. The ACT prompt relists because it is built fresh every run and has to. |

---

## 11. Where the build departed from version 1.0

### 11.1 The card survives a change of document

Version 1.0 said "while a card is on screen" and never asked how the reviewer
gets to the other document with the card still there. They cannot: `openDocument`
(`renderer/overlay/App.tsx`) closed the open card on every open, so the moment
the reviewer clicked `components.md` in the tree, the card was gone and the
selection went to the panel — the exact flow §1.1 describes, unchanged. The
first live run found it at step 2 of §9.1.

`openDocument` no longer clears `activeId`. The reason it did — *"the comment
you were reading need not be about the document you just opened"* — is still
true and is no longer a reason: the comment list is workspace-wide (spec 05
§5.3), a card already lists places in documents that are not on screen (spec 08
§7.3), and the sweep that follows the open paints the comment's places in the
new document violet through `activeIdRef`. The trace sheet is closed on open
instead, because it covers the document pane and the reviewer has just asked to
see a document. `goToPlace` keeps its `setActiveId` after the open; it is now
redundant and harmless.

§3.5's argument for not handing pending places to the panel when the card closes
loses its example — `goToPlace` no longer closes the card — and keeps its
conclusion: pending places belong to the comment they were picked for.

### 11.2 `passageSection` grew three options, not one

§6.1 asked for `from`. The follow-up also needed `nameEveryDocument`, because
`passageSection` skips the `###` heading for a single document on the grounds
that the opening prompt names it at the top — and a follow-up has no such line.
And ACT's marker (§6.2) is `addedWith`, the sending message's id, matched
against each target's `messageId`; a null `addedWith` marks nothing, which
`test/prompts.spec.ts` pins because every opening place has a null `messageId`
and a null-equals-null match would have marked all of them. `heading` became
nullable so the follow-up can write its own sentence above the list.

### 11.3 One helper in `ipc.ts`, shared by the opening and the follow-up

The opening prompt's path map, repository root and `locate` were built inline
in `thread:ask`. The follow-up needs the same three, so they moved into
`readContext(thread)` and both sends call it — otherwise the two could disagree
about which version of a document the agent is pointed at while a working copy
exists (spec 16 §5.4). `recordUserText` returns the `Message` it records, as
§4.1 asked.

### 11.4 How it was tested

`node --test`: `test/prompts.spec.ts` (17, six new) and `test/appendTargets.spec.ts`
(7, new — the append, the tags, the count, the refused foreign key, and the
migration run twice). `tsc --noEmit` is clean and `nvim-tools --json --all`
reports the baseline's 26 findings, none in a touched file.

The live run of §9.1 was driven over CDP with `playwright-core` against an
isolated instance (`REX_CDP_PORT=9444`, its own `REX_DB_PATH` and
`REX_WORK_PATH`, `my-ecommerce` as the workspace), because port 9334 held the
reviewer's own REX. Three agent runs; `git status --porcelain` in the repository
before and after are identical, and the work store holds `GOAL.md`'s copy and
nothing else. Two things the run taught, recorded for the next one: a real
mouse drag cannot be scripted — `page.mouse.move` with the button held never
returns over CDP on Electron — so the selection is made in the frame and the
`mouseup` the surface listens for is dispatched; and the send tooltip, the
strip's label under each mode, the chip under the `YOU` turn, `new comment ›`
and the ACT working copy were each checked from the DOM, not assumed.
