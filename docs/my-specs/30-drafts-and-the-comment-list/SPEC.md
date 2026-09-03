# REX 30 — drafts, and the comment list

**Version:** 1.1 · 2026-09-01
**Status:** **built, and driven in a live window.** All six milestones are in the
tree; `npm run test:comments` is 40 tests green and `npm run test:migrate` is 19;
§9.1 was run on 2026-09-01 against an isolated REX on port 9444 holding a copy of
the real database, and §12 records the five places the build departed from this
document and the one step it did not run.

**Depends on:** [`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md)
§3 (selecting is a phase, and the panel is where it stands), §3.2 (only `clear`
or Ask empties it), §5.2 (one row per place), §5.4 (a thread's worst target
state); [`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §3.1 (the tab
bar is furniture), §3.2 (the selection panel is the tab's whole body);
[`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §2 (the two modes), §3
(the mode is something the reviewer picks), §3.3 (a message records the mode it
was sent in); [`14-naming-order-groups/SPEC.md`](../14-naming-order-groups/SPEC.md)
§4.1 (rank inside a group), §5.7 (an empty group stays visible);
[`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md) §8 (how a
commented passage is marked), §8.4 (only the open comment and the pointed-at one
are painted), §8.5 (an orphan has no bar);
[`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md) §7.2 (each pane
draws its own sweep's bars); [`18-what-the-colours-mean/SPEC.md`](../18-what-the-colours-mean/SPEC.md)
§2 (resolved is terminal), §2.1 (`moved` is not a lane), §3 (the vocabulary),
§5.2 (the filter row fits one line);
[`24-pointing-mid-conversation/SPEC.md`](../24-pointing-mid-conversation/SPEC.md)
§5.2 (the message that added a place);
[`25-choosing-the-model/SPEC.md`](../25-choosing-the-model/SPEC.md) §2.3 (a NOTE
has no model).

Approved 2026-09-01 with questions 4 and 5 answered — the filter row may wrap,
and a note keeps a **Save** box with no mode switch and no model picker. Version
1.1 promoted NOTE from a flag to a lane of its own and added the upgrade to a
draft (§2.2, §3.5), which costs the filter row a fifth pill (§4.4). Version 1.0
left NOTE inside `open`; §10 records why that could not stand.

> [!note]
> **One sentence holds the whole spec: a comment you have not sent is still a
> comment.** REX has had nowhere to put one. The places sat in renderer memory,
> behind a tab, and were lost on reload. Making them a comment with a state of
> its own is what lets the sidebar drop its tab bar, and what frees the row the
> file scope needed. A second, quieter change rides on the same rule: NOTE has
> been a flag on a comment since spec 12, and once a note can be *upgraded* into
> a draft it is a lane like the rest. §2 is the rule, §3 is the shape that
> follows, and §8 lists the three specs this reverses.

---

## 1. Why

### 1.1 The filter stops at the list

Measured on 2026-09-01, on a document with nine open comments, two resolved and
one gone. The reviewer pressed `open`. The sidebar listed nine. The paper kept
drawing all twelve bars.

The state lives in `Sidebar.tsx:98` as the panel's own `useState`, and nothing
outside the panel ever sees it. The paper draws from `paneResolved`, handed to
`DocumentView` at `App.tsx:3554` with no filter applied at any point on the way.

So the one control REX offers for "show me less" narrows half of what is on
screen. The reviewer's words: *"we only see the comments that are selected in the
right sidebar"* — which is what a filter is, and what this one is not.

The same `useState` has a second fault. `Sidebar` unmounts whenever a comment
card opens, so the filter goes back to `open` every time the reviewer reads a
comment and presses back.

### 1.2 The tab bar makes a form into a destination

`Selection │ Comments` is a segmented control, and a segmented control says *two
destinations, pick one*. Only one of the two is a destination. The other is a
form the reviewer fills in and leaves.

REX already knows the right shape for that, and uses it for the other half of
the same job. An existing comment takes the whole column and returns to the list
with a back arrow (`App.tsx:3761`). A new comment is the same kind of thing — one
or more places, a note, a mode, a model — and it is reached a completely
different way.

### 1.3 An unfinished comment has nowhere to live

The reviewer picks three places, is called away, and comes back to a `Sidebar`
that has re-mounted. Or reloads the window. In both cases the places are gone,
because `selection` is renderer state and always has been.

This is the fault the other two hang off. A half-built comment that survives is
a comment; and once it is a comment it needs a state, a lane, a colour and a
pill — and once the pill row has four entries and the composer has a back arrow,
the tab bar has nothing left to do.

### 1.4 The file chip reads as a fourth state

`open · resolved · gone │ file` is four identical pills in one row, split by a
hairline. Spec 18 §5.2 chose the hairline deliberately and said what it was
for. It is not enough. The reviewer's words: *"having the same PIL separated only
by a vertical separator may not provide the best user experience"*.

After §5 the two controls do not even have the same reach — the state pills act
on the list and the paper, the file scope acts on the list alone — so drawing
them alike is no longer only unclear, it is wrong.

---

## 2. The rule — five lanes, and status is not mode

**A comment is in exactly one of five lanes.**

| Lane | Meaning | Reached by |
|:--|:--|:--|
| draft | has places, has never been sent, and is meant to be | pressing back with at least one place |
| note | text on a place, for the reviewer alone. No agent will ever see it | pressing **Save** |
| open | sent. Waiting on the reviewer | pressing **Ask** or **Change** |
| gone | draft, note or open, and the text it was written on no longer exists | the document changing under it |
| resolved | dealt with. Terminal | the reviewer, by hand |

`draft` is the first lane and `resolved` is still the last one. Spec 18 §2's rule
is unchanged where it bites: **a resolved comment whose text is later removed
stays resolved.** The gone lane widens to catch drafts and notes, for the reason
it caught open comments — the reviewer has not dealt with it, and the text it
points at has vanished.

### 2.1 A draft is not a note, and they coexist

These look alike and are not the same. Getting them confused would be the one
mistake that makes this spec worthless, so the difference is written down before
anything is built on it.

| | draft | note |
|:--|:--|:--|
| What it says | *I have not finished this* | *this is for me* |
| Has an answer | not yet | never, by design |
| Will be sent | yes, that is the point | no |
| Its card offers | places, a question, a mode, a model | places and text (§3.5) |

`types.ts:316` drew this line before there was a state on the other side of it:

> It is not "has no answer yet": an ASK that failed has no answer either, and the
> two must not look alike.

`draft` is exactly the *"has no answer yet"* case that sentence refuses to call a
note. This spec adds the lane that comment implied was missing, and promotes
`note` from a flag to a lane beside it.

### 2.2 The moves between them

Every arrow is a gesture the reviewer makes. Nothing moves on its own except
into `gone`, which the document does.

```text
                    Ask / Change
   (new) ──back──▶ draft ─────────────▶ open ──resolve──▶ resolved
                    │  ▲                  ▲
               Save │  │ Turn into        │ Ask / Change
                    ▼  │ a comment        │
                     note ────────────────┘
```

| From | To | Gesture |
|:--|:--|:--|
| new | draft | back, with at least one place |
| draft | open | **Ask** or **Change** |
| draft | note | **Save** |
| note | draft | **Turn into a comment** (§3.5) |
| note | open | **Ask** or **Change**, once it is a draft |
| open | resolved | the resolve button, as today |
| resolved | open | reopen, as today |
| draft, note, open | gone | the text it points at disappears |

**Upgrading a note is the move this section exists for.** A remark you wrote for
yourself turns out to be worth asking about. Today that costs retyping it as a
new comment; after this it is one button that keeps the places and the words.

### 2.3 Status is not mode

**The mode says what pressing the button will do. The status says which button
was pressed.** They are two different facts and nothing may blur them.

Spec 12 §2 is untouched: ASK runs a read agent, ACT runs a write agent, NOTE runs
nothing. What changes is only that the third one now has a lane to land in
instead of a flag.

A draft whose mode switch reads NOTE is still a draft. It becomes a note the
moment **Save** is pressed.

### 2.4 A draft needs a place

**A comment with no places is not saved, in any lane.** It is discarded without a
prompt, and nothing is written.

This is not a rule for drafts, it is `ipc.ts:577`, which has always refused a
comment about nothing: *"a payload with no target has no document either, and a
thread with neither is a comment about nothing"*. `thread.document_id` is
`NOT NULL`, so there is no row to write.

Two consequences, and they are the reviewer's own words:

1. Open the composer, pick nothing, press back → **nothing is saved**, silently.
2. Open the composer with no document open at all → the same, always, because
   there is nothing to pick from.

### 2.5 Delete works in every lane

A draft is deleted by its row's delete button and its card's, exactly as every
other comment is. Nothing about this needs building — `ThreadRow` and
`CommentCard` already carry it and do not read `status` — and it is written down
because the reviewer asked for it explicitly: *"I should always be able to delete
comments as I want."*

---

## 3. The sidebar has one home and two screens

The tab bar goes. The column has one home and two screens that lead back to it.

| Screen | Reached by | Leaves by |
|:--|:--|:--|
| **The list** | home | — |
| **One comment** — `CommentCard` | clicking a row | ← back |
| **A new comment** — the composer | `＋`, **or** picking a place | ← back |

### 3.1 The composer has two doors, and the document is the main one

Spec 05 made selecting start in the document, and that does not change. Picking a
first place opens the composer by itself, which is what `App.tsx:458` does today
by swapping the tab. Four sites set the tab and all four become "open the
composer" or "go back to the list": `App.tsx:458`, `:651`, `:2018`, `:2325`.

`＋` is the second door, and it is for the two cases the document cannot serve:
starting a comment about the whole document, and **getting back to a draft**.

### 3.2 What back does

The gesture carries the decision, and there is no dialog either way.

| Places in the composer | Pressing ← | Written |
|:--|:--|:--|
| none | discards | nothing |
| one or more | saves as a draft | one `thread` row, `status='draft'`, plus its targets |

Reopening the draft and pressing back again **updates that same thread**. The
composer holds the id of the draft it is editing, or `null` for a new one, so a
draft edited five times is one comment and not five.

Pressing **Ask**, **Change** or **Save** promotes the same row to `open` rather
than creating a second one.

> [!warning]
> **`Clear` still means clear.** Spec 05 §3.2 promised that only `clear` or a
> send empties the panel, and back is neither. Back with places **keeps** them,
> in the lane whose whole purpose is keeping them. `Clear` remains the only
> gesture that throws work away, and it still confirms above three places.

### 3.3 A standing draft is visible from the list

Saving a draft and then not being able to find it is the failure this section
exists to prevent. Three things say where it went, and all three are needed:

1. **It is a row in the list**, numbered and coloured as a draft (§6).
2. **It has a bar in the margin**, in the same colour, so the paper says a
   comment is here.
3. **The filter moves to `draft`** on the save, so the row the reviewer just made
   is on screen rather than behind a pill they did not press.

Point 3 is the same principle spec 08 §3.1 used for the tab — *the panel follows
what the reviewer is doing* — applied to the control that replaced it.

### 3.4 The composer with no document open

`＋` opens the composer whether or not a document is open. It shows its empty
state, nothing can be picked, and back discards. It is offered rather than
disabled so that `＋` means one thing at all times.

### 3.5 A note's card is not a comment's card

**A note is text on a place. Its card shows text and places, and none of the
machinery for sending things.** The reviewer's own words: *"it does not have the
modes and stuff like that"*.

| On a comment's card | On a note's card |
|:--|:--|
| the mode switch — ASK / ACT / NOTE | **gone.** Nothing about a note is a choice between agents |
| the model picker | **gone.** Spec 25 §2.3 — a note has no model, and never had |
| **Ask** / **Change** / **Save** | **Save**, on a plain box with no chrome |
| the trace sheet | **gone.** Nothing ran, so there is nothing to trace |
| the places | kept, and pointing still works |
| resolve | **gone.** §2.2 — a note leaves its lane by being upgraded, not by being resolved |
| delete | kept. §2.5 |
| — | **Turn into a comment** |

**Turn into a comment** is the upgrade. It moves the note to `draft`, keeps every
place, carries the note's text into the composer as the question, and opens the
composer on it. From there it is an ordinary draft: finish the question, pick the
mode, send it.

Nothing is thrown away and nothing is retyped, which is the whole point. If the
reviewer changes their mind, pressing back puts it in `draft` — not back in
`note`, because the upgrade was a deliberate act and undoing it is what **Save**
is for.

### 3.6 A comment can be named from the moment it is started

**The composer's heading is its name box.** It is there when `＋` is pressed,
before a single place is picked, and it stays as places are added.

Naming waited on two things before this, and both were wrong. A comment could
not be named until it existed, so the reviewer had to send it or save it first
and then find its pen; and the composer had no name field at all, so even with
places in it there was nowhere to type one. Reported 2026-09-02.

| | |
|:--|:--|
| Where | the composer's header, in place of the `New comment` / `Draft` heading |
| When | from `＋`, and from the first picked place |
| Empty means | **named by the note** — spec 14 §3.1, unchanged |
| Written by | `thread:create` and `thread:draft-save`, both of which now carry a `title` |

**The heading IS the field**, drawn with no border and no ground until it is
hovered or focused. A comment is named the way a file is — you type over the
heading — and a bordered input in the header would read as one more thing to
fill in before anything can be done. The old heading's words become its
placeholder, so the screen still says what it is.

**The name travels with the places.** It goes in on `thread:create` rather than
as a `thread:rename` afterwards, so a comment is never written under one name
and corrected to another; a draft saved and reopened comes back named; and
**Clear** empties it along with everything else it empties.

> [!note]
> **A comment with neither a name nor a note is now reachable**, and it was not
> before. Every comment used to be made by a send, and a send needs a question —
> but a draft is saved by walking away, and walking away immediately is allowed.
> Such a row drew a blank headline. `commentName` falls back to **Untitled**,
> which is what "named by the note" says when there is no note to be named by.

---

## 4. The header — two rows, and one of them is new

### 4.1 What the rows hold

```text
┌────────────────────────────────────────────────┐
│ ┌──────────────┬─────────────────┐    ＋    ⋮  │  scope + commands
│ │ All files 14 │ 01-initial.md 5 │             │
│ └──────────────┴─────────────────┘             │
├────────────────────────────────────────────────┤
│ (draft 1)(note 1)(open 9)(done 2)(gone 1)      │  state
├────────────────────────────────────────────────┤
│   1  EARS                                      │
│   4  Implement vs. Test workers                │
```

**Row 1 is the list's header.** It says which list this is, and carries the
commands that act on the list as a whole. **Row 2 is the filter, and nothing
else.**

> [!note]
> **§13.8 made this three rows.** `＋` left row 1 for a make row between the two,
> where it stands beside `New folder` as `＋ New comment`. Row 1 keeps the switch
> and the `⋮`.

The scope is one box split in two, not two free-standing pills. A segmented
control says *pick one of these two*; the round chips below say *pick one of
these four*. Two shapes for two questions, which is what the hairline was trying
to say and could not.

### 4.2 Nothing is lost when the tab bar goes

| Was | Is now |
|:--|:--|
| `Comments 14` count | the `All files 14` segment |
| `Selection 0` count | the `＋` button, while a draft is being composed |
| `⋮` — delete all comments | the right end of row 1 |

The `⋮` menu is better placed than it was. It acts on the whole list, and row 1
is now the list's own header rather than a bar about navigation.

### 4.3 The file name truncates

At the 300px sidebar minimum the scope switch and two icon buttons need about
284px, so the file name takes an ellipsis and the full name stays in the
`title`. The row keeps `flex-wrap`, so a name that still will not fit drops to
its own line rather than pushing `＋` off the edge.

### 4.4 Five pills, and `resolved` becomes `done`

Five is one more than the row has ever carried, so it is measured rather than
assumed. From `overlay.css` — `.rex-chip` is 18px of padding plus a 6px gap plus
its count pill, and the row spends 28px on its own padding:

| Row | Width |
|:--|:--|
| `draft · note · open · resolved · gone` | ≈ 415px |
| `draft · note · open · done · gone` | ≈ 389px |
| the sidebar's default width | 384px |
| the sidebar's minimum | 300px |

**So `resolved` is shortened to `done`**, exactly as spec 18 §5.2 shortened
`orphaned` to `gone` and for the same measured reason. `done` is not a new word
either: `--done` has been the token name for the resolved colour since spec 18
§3, so the screen catches up with the palette.

That still leaves the row 5px over at the default width, and well over at 300px.
`.rex-filters` keeps `flex-wrap`, so it takes a second line there and the
reviewer widens the panel — up to 640px — if they would rather it did not. A
wrapped filter row is a worse outcome than a fitted one and a much better one
than a lane nobody can find.

> [!note]
> **This is the one place the spec spends the row it saved.** Removing the tab
> bar bought a row; the scope switch spends it; a wrapped filter row at narrow
> widths spends it again. §11 question 4 is whether five lanes are worth that,
> and it is the reviewer's call, not the spec's.

---

## 5. The filter reaches the paper

**The state pills narrow the list and the document. The file scope narrows the
list alone.**

### 5.1 Why the two reach differently

The scope has nothing to do on the paper. The sweep resolves anchors against the
open document only (`App.tsx:810`), so a comment about another file has no bar
there to hide. Narrowing by file would be a control with no visible effect on
half the screen.

This is the argument for §4.1's two rows. Two controls with different reach must
not be drawn as one row of identical pills.

### 5.2 Where the cut is made

One cut, in `App.tsx`, on `paneResolved.current` and `paneResolved.original`
before they are handed down. `MarginBars`, the block outlines and the gap rules
in `PaneMarks.tsx` all read the same `ResolvedThread[]`, so filtering it once
moves all three and they cannot disagree.

**`threads` is never filtered.** `MarginBars.tsx:108` and `Sidebar.tsx:135` both
number comments by position in the full list. Filtering it would renumber the
document every time a pill was pressed, and comment 9 must be comment 9 in every
lane.

### 5.3 The open comment is always drawn

The active thread passes the filter whatever it says. Open a resolved comment,
then press `open`: the card is still on screen, and its violet passages stay
painted. A reviewer reading a comment is not asking to have it hidden.

### 5.4 `gone` leaves the paper bare, on purpose

An orphan has no place in the document by definition, so it has no bar —
`MarginBars.tsx:120`, spec 15 §8.5. Under the `gone` pill the list fills and the
paper shows nothing at all.

That is correct and it looks broken. The panel says so, in the same place and the
same voice as the orphan note it already prints:

> The text these were written against is gone, so none of them is marked on the
> page.

### 5.5 The filter outlives the card

`filter` and `onlyThisFile` move from `Sidebar` into `App`. This is required by
§5.2 — the paper needs them — and it fixes §1.1's second fault for free: reading
a comment and pressing back no longer resets the row.

---

## 6. The colours — a shape, not a hue

**A draft is drawn in the open comment's blue, with a dashed edge.**

Spec 18 §3 set the precedent and gave the reason: *"Gone is a glyph, not a
colour ... taking it off the colour axis is what leaves red and green free to
mean one thing each."* The axis is full — blue, amber, grey, white, red, and the
note's slate. A seventh hue would buy one state and cost the five that are
already legible.

| Lane | Marker | Colour |
|:--|:--|:--|
| draft | **dashed** edge | blue `--action` |
| open | filled | blue `--action` |
| note | hollow | slate `--note` |
| open, text re-found elsewhere | filled + card pill | amber `--moved` |
| gone | `?` | grey `--gone` |
| resolved | filled | white `--done` |

Only one row of this table is new. The note's hollow slate is what
`rex-token-unsent`, `rex-margin-unsent` and `rex-thread-unsent` already draw —
promoting it from a flag to a lane changes what decides it, not what it looks
like.

The draft's dashed blue is the new one, and the argument for it is that a draft
*is* an open comment that has not started. Dashed is the one convention every
reviewer already reads as unfinished, and it needs no seventh hue on an axis
spec 18 §3 already called full.

`wash.ts` decides all three surfaces in one place — the card wash, the numbered
token and the margin bar — and it stays the only place. Its branch order becomes
`draft`, then `note`, then `resolved`, then the anchor states. The two new lanes
go first because a comment in either of them cannot be in any state below.

> [!warning]
> **`isNote` leaves `wash.ts`'s signature.** All three functions take it as a
> third argument today and test it last. It is a lane now, so it arrives inside
> `status` and the parameter goes. `test/comments.spec.ts` loads this module
> directly, so the change is caught by a test rather than at runtime.

---

## 7. What changes in the data

### 7.1 The schema

One widened constraint, one migration, and one column that retires.

```sql
status TEXT NOT NULL DEFAULT 'open'
         CHECK (status IN ('draft','note','open','resolved'))
```

SQLite cannot alter a `CHECK`, so `migrate.ts` rebuilds the table the way it
already rebuilds for a widened constraint. The same migration carries the
existing notes across:

```sql
UPDATE thread SET status = 'note' WHERE is_note = 1 AND status = 'open';
```

Only `status = 'open'`. A note that was resolved stays resolved, because §2's
rule that `resolved` is terminal is older than this spec and outranks it.

`ThreadStatus` in `shared/types.ts:205` gains `"draft"` and `"note"`. Every
`switch` over it is then found by the type checker rather than by grep.

### 7.2 `thread.is_note` retires — but `message.mode` does not

**`is_note` stops being read and stays in the table.** Dropping a column
rewrites it, and this repo has left two retired columns in place already for
that reason — `thread.model` (spec 25 §4.3) and `thread.anchor_json`. The lane
is the record now.

**`message.mode` is untouched and must not be confused with it.** They are
different facts:

| | `thread.is_note` | `message.mode` |
|:--|:--|:--|
| About | the whole comment | one message |
| Says | it was never sent | which of ASK / ACT / NOTE sent this one |
| After this spec | retired, replaced by the lane | unchanged |

Spec 24 §4.3 lets a reviewer add a note to an *answered* comment — a message
with `mode='note'` on a thread in the `open` lane. That still works, that thread
is still `open`, and nothing about §2's lanes touches it. A note-the-message and
a note-the-comment are two things wearing one word, and only the second becomes
a lane.

### 7.3 The channels

| Channel | Change |
|:--|:--|
| `thread:create` | takes `status`, defaulting to `open`. A draft passes `'draft'` |
| `thread:draft-save` | **new** — replaces a draft's targets, note and title in one transaction |
| `thread:promote` | **new** — `note` → `draft`, for §3.5's *Turn into a comment* |
| `thread:ask` | sets `status='open'` before it runs, in place of the `clearNoteFlag` it does today |
| `thread:note` | sets `status='note'` when the thread is a draft, and leaves an `open` thread alone (spec 24 §4.3) |

**Replacing a draft's targets wholesale is safe**, and only for a draft. Spec 24
§5.2 gave a target a `message_id` naming the user message that added it; a draft
has no messages, so every one of its targets carries `NULL` and nothing points at
them. `thread:draft-save` refuses any thread whose status is not `draft`.

### 7.4 What is not stored

**The mode and the model stay in the renderer**, for a draft exactly as for
every other comment. Spec 12 §3.3 is explicit: *"the mode a thread will send its
next message in stays in the renderer and is deliberately not stored"*, and spec
25 §4.3 retired `thread.model` for the same reason. A draft that is reopened
after a reload offers the default mode and the default model. Its places and its
note are what it kept, and they are what the reviewer cannot retype.

---

## 8. What this reverses

Three earlier decisions, named so that nobody has to reconstruct them from a
diff.

### 8.1 Spec 08 §3.1 — the tab bar is furniture

That spec argued the bar must be on every screen, empty or not: *"navigation that
moves is worse than navigation that is sometimes empty."*

It is right about navigation and wrong about what it was navigating. It made
Selection and Comments co-equal destinations, and they are not co-equal — one is
a list you park in and one is a form you fill in. The composer keeps its own
permanent affordance (`＋`, §3.1), so nothing about it comes and goes. What is
removed is the claim that a form is a place.

### 8.2 Spec 18 §2 — exactly three lanes

Now five. Everything that made `resolved` terminal survives unchanged. `draft`
and `note` are added at the other end, before `open`, and the gone lane widens to
catch both.

Spec 18's §5.2 measurement is redone rather than discarded: §4.4 above spends the
budget it left, and shortens `resolved` the way spec 18 shortened `orphaned`.

Spec 18's §4 workspace tree is **not** changed by this spec. Drafts and notes get
no marker on a file row and are not counted in the row's open count. §11 records
that gap.

### 8.3 Spec 05 §3.2 — only `clear` or Ask empties the panel

Still true, and now truer. Back with places does not empty anything; it moves the
places into a comment. Back with no places empties nothing, because there was
nothing.

---

## 9. Milestones

Each ends in something runnable.

| # | What | Done when |
|:--|:--|:--|
| 0 | `draft` and `note` end to end: schema, migration, types, `thread:create` | a row of each written by hand in `sqlite3` lists, draws a bar, and deletes. `npm run test:migrate` green on a database made before this spec |
| 1 | The filter reaches the paper (§5) | pressing `done` leaves only resolved bars on the page, and comment numbers do not move |
| 2 | The header's two rows (§4), tab bar removed | the scope switch narrows the list, `＋` and `⋮` work, the count moves |
| 3 | The composer as a screen, with both doors (§3.1) | picking a place opens it; `＋` opens it; back returns to the list |
| 4 | Back saves and discards (§3.2), promotion on send (§7.3) | a draft survives a reload, is edited without duplicating, and becomes `open` on Ask |
| 5 | Five pills and the two new markers (§4.4, §6) | five pills, dashed blue on a draft, hollow slate on a note, on row, token and bar |
| 6 | The note's card and the upgrade (§3.5) | a note has no mode switch and no model picker; **Turn into a comment** moves it to `draft` keeping its places and words |

### 9.1 How it is checked

Against a real document in an agent REX, per `rules/06-testing.md`:

1. Pick three places, press back. One draft row appears, the pill moves to
   `draft`, three dashed bars are on the page.
2. Reload the window. The draft is still there with its three places and its
   note.
3. Open it, remove one place, press back. Still **one** comment, now with two
   places.
4. Press `open`. The draft's bars leave the page. Press `draft`. They return.
5. Open it, type a question, press Ask. It moves to the `open` lane, filled
   blue, and the agent answers.
6. `＋` with no document open, then back. `SELECT count(*) FROM thread` is
   unchanged.
7. Delete a draft from its row. Gone from list and page.
8. Make a second draft, press **Save**. It moves to the `note` lane, hollow
   slate, and its card shows no mode switch and no model picker.
9. Press **Turn into a comment** on it. It is a draft again, with the same
   places and the same words in the question box.
10. On a database made before this spec: every comment that was a NOTE is in the
    `note` lane, and a NOTE that had been resolved is still `resolved`.

---

## 10. Rejected

- **Draft as a fourth position on the mode switch.** The mode says what the
  button does; the status says which one was pressed. Folding one into the other
  is §2.1's mistake with a smaller footprint.
- **Reusing `is_note` for drafts.** It would make an unfinished question and a
  deliberate remark the same colour and the same lane, which is the exact
  conflation `types.ts:316` was written to prevent.
- **Leaving `note` inside the `open` lane.** Version 1.0 of this spec did, on
  the width argument in §4.4. It cannot survive §3.5: a lane you can be upgraded
  *out of* is a lane, and one the filter cannot show is a lane the reviewer
  cannot find. The width is paid instead, and §11 question 4 asks whether that
  was the right trade.
- **Dropping `gone` to make room.** It is the lane a reviewer most needs to be
  told about, because nothing on the page can say it — §5.4.
- **A dialog on back.** "Save this draft?" on every back press is a question the
  gesture already answers: places or no places.
- **Writing the draft on every pick.** One database write per click in pick
  mode, to store something the reviewer may abandon three seconds later. The
  write happens once, at back.
- **A new hue for drafts.** §6 — the colour axis is full, and spec 18's own
  argument applies unchanged.
- **Making the upgrade automatic.** A note that is asked about could promote
  itself. It must not: §2.1's whole point is that the reviewer *chose* the note,
  and a state that undoes a choice without being asked is the fault this spec is
  built to avoid.

---

## 11. Open questions

1. **Should the filter jump to `draft` when one is saved?** §3.3 says yes, so
   the reviewer sees where the work went. The cost is a list that changes under
   them. The alternative is to leave the pill alone and let the count increment
   carry it, which is quieter and easier to miss.
2. **Should the workspace tree count drafts?** §8.2 leaves it out. A file with
   four drafts and nothing else currently reads as a file with no comments, which
   is wrong in the one view meant to show where the work is. It needs a sixth
   marker on a 272px row, which spec 18 §4.1 already called the limit.
3. **Should `＋` be reachable by a key?** Every other screen change in REX has
   one. `N` is free.
4. ~~**Are five lanes worth a filter row that wraps?**~~ **Answered
   2026-09-01: yes.** The row may take a second line at narrow widths. The
   counts stay on the pills — spec 18 valued them as the row's tally — and the
   reviewer widens the panel if the wrap bothers them.
5. ~~**Can a note still be added to?**~~ **Answered 2026-09-01: yes.** A note's
   card keeps a plain **Save** box with no mode switch and no model picker, so a
   note can be extended without being upgraded. The fully static card was
   rejected: it would take away a capability spec 12 §3.1 shipped, to save one
   text box.
6. **Centred switch, or readable file name?** §13.6 — they do not both fit in a
   384px sidebar. Centring wins today and the name truncates to `sampl…`. The
   alternatives are to let the switch sit left of centre and keep the name in
   full, or to drop the two counts from it and buy back about 44px.

---

## 12. What the build changed

Written after the fact, against what §1–§11 promised. Five departures and one
step not run.

### 12.1 `thread:draft-save` carries the lane it lands in

§7.3 gave the channel three fields. It needed a fourth.

A fresh NOTE is **born** in its lane — `thread:create` takes a `status`, and
`askAboutSelection` passes `note` when the mode says so. A draft being saved as
a note had no such moment: `saveDraft` wrote the places and left the row a
draft, so pressing **Save** on a reopened draft would have kept it in the unsent
list wearing the wrong colour.

So `ThreadDraftSaveRequest` gained an optional `status`, defaulting to `draft`,
which is what back does. It rides along rather than being a second call because
sending a draft is **one act**: a draft that saved its places and then failed to
change lane is a comment the reviewer has sent, sitting in the unsent list.

### 12.2 `SidebarTabs.tsx` was renamed, not deleted

§8.1 says the tab bar goes, and it does. The file did not: `git mv` to
`ListMenu.tsx`, keeping the `⋮` menu and — more to the point — the
capture-phase close logic, the `composedPath()` shadow-root retarget, and the
button exception that spec 08 §3.1's own comment records as measured on
2026-08-28. Deleting the file and writing the menu again would have thrown that
away and rediscovered it.

### 12.3 The trace sheet needed no change for a note

§3.5's table says a note's card drops the trace sheet. Nothing was written: it
is already drawn behind `steps.length > 0`, and a note has no tool calls, so it
was structurally absent before this spec.

### 12.4 The list row's resolve tick is hidden on both unsent lanes

§3.5 removed **Resolve** from a note's card and said nothing about the row's
tick in the list. It has to go too, on a draft as well as a note: `ThreadRow`'s
tick calls the same `setThreadStatus`, which writes `resolved` over whatever was
there, so the row was offering a lane change §2.2 does not allow. Guarded on
`UNSENT_STATUS`.

### 12.5 `wash.ts` lost a parameter rather than gaining a branch

§6 said `isNote` leaves the signature. In the event all three functions also
took a `status: string`, and it is `ThreadStatus` now — which is what makes the
type checker, rather than a grep, the thing that finds a missed lane.

### 12.6 The one step not run: §9.1 step 5

Every other acceptance step was driven in a live window. Step 5 — *"type a
question, press Ask; it moves to the `open` lane and the agent answers"* — was
not, because it starts a real agent run on the reviewer's own account and
nothing in this spec needs an answer to be checked.

What it would have proved is covered twice over: `markThreadSent` moves a draft
and a note to `open` and refuses to touch `resolved`
(`test/comments.spec.ts`), and the same promotion was driven live through
**Save**, which takes the identical `thread:draft-save` path and differs only in
the lane it names.

### 12.7 Observed, and left alone

A note's card prints its text twice — once as the card's title and once as the
note body — because `commentName` falls back to the note's first line and
`rex-card-note` prints the note whenever no message carries it. It predates this
spec: every NOTE made since spec 12 has looked this way, and no lane changed it.
Worth a fix, but it is spec 12's, not this one's.

---

## 13. After the first look

Five reports on 2026-09-02, from the reviewer using the built panel. Four were
this spec's own faults; the fifth is spec 26's, and reversing it is recorded
here because there is nowhere else it belongs.

### 13.1 The scope switch sits in the middle of its row

§4.1 drew it first in the row and said nothing about where. Pressed against the
left edge with a wide empty gap after it, it read as the first of a row of
controls rather than as the title of the list below.

It is centred on the ROW, which is harder than it looks. A flex row with the
commands pushed right centres the switch in what they LEAVE, not on the row — 34
to 41px off, measured. `1fr auto 1fr` does not fix it either: `1fr` is
`minmax(auto, 1fr)`, so the column holding 85px of buttons cannot shrink below
them while the empty one can, and the columns came out `17.6 / 251 / 85`.

The row is a three-column grid: `minmax(0, 88px) auto 88px`. The mirror takes
its full 88px whenever there is room, so the switch is exactly centred; below
about 470px it gives way, and the switch keeps its labels and drifts left. **A
centred switch nobody can read is worse than a readable one off centre**, and
only one of the two fits at the 384px default.

Two sizing rules make that order hold, and both are easy to get backwards:

- **No `min-width: 0` on the switch.** An `auto` track takes its minimum from
  the item's min-content. Zero it and the mirror wins instead: the switch got
  180px for 259px of labels.
- **`justify-self: center` on the switch.** Grid stretches `auto` tracks into
  leftover space, and a stretched item is a bordered box wider than its content
  with the gap opening between the two labels — which is exactly the shape §13.2
  was first blamed for.

### 13.2 The switch keeps its box — the ROW was the problem

Version 1 of this section read *"the switch carries no box"*, and stripping its
border, radius and background was wrong. The report was never about the
segmented control. It was about a rounded capsule drawn around the whole header
row, and §13.7 is where that came from.

The control is `Tabs`, unchanged and looking exactly as it does everywhere else
in REX. One thing about it is overridden here, and only in this row:

`.rex-segment.rex-tabs` carries `flex: 1` on itself and on its buttons, written
when it WAS the sidebar's full-width tab bar. Inherited by a switch that is no
longer full width, it split the row in two and pushed the two labels to opposite
ends. `flex: none` in `.rex-listhead` puts them back at their own widths.

### 13.3 `＋` became `＋ New`

§3.1 specified an icon. An icon alone says "add", and in a panel of comments the
first guess is "add what — a folder?" The word is the fix, and the tooltip
carries the rest.

### 13.4 A draft's margin bar keeps a solid numbered head

§6 said the bar is dashed, and the first build striped its whole length. The
number then sat on the stripes and alternated white-on-blue and white-on-paper
every 5px — unreadable at the 10px the number is drawn at.

The number keeps its own solid patch, so a draft's bar is numbered exactly as
legibly as every other bar, and the dash says what it says below it. **Colour is
never the only signal** (spec 18 §4.4) — and neither is a texture that eats the
signal beside it.

### 13.5 Spec 26 §4.1's worded strength meter is gone from the composer

Not this spec's, and reversed here anyway. The expanded row printed
`Durable — hand-written id, survives a rebuild` and its two siblings under the
scope chips.

It answered a question the reviewer was not asking. They are picking what a
comment is ABOUT, and the chips above already say what each level is; a strip
predicting how well the anchor would survive a rebuild is REX talking about its
own machinery in the middle of that. The bars survive in the path bar, drawn
bare with the sentence in a tooltip, so nothing is lost — it stops
interrupting.

### 13.6 What centring costs

The mirror spends up to 88px on the left and the commands 85px on the right, so
the switch is centred only while the row is wider than about 470px. Below that
the mirror collapses and the switch sits left of centre with both labels intact
— measured 44px off at the 384px default, with `All files` and
`sample-document.md` both whole.

Nothing truncates any more, so `All files` keeps its name; an interim build cut
it to `All` to buy width it no longer needs.

### 13.7 `rex-scope` was already taken

The rounded capsule around the header row — reported on 2026-09-01 and twice
more on 2026-09-02, and looked for twice in the wrong place — was a class name
collision, not a rule in this spec's own CSS.

`.rex-scope` has belonged to spec 26's scope chip since that spec shipped:
`heading #overview`, `section "Overview"`, `document`, drawn as a pill with
`border: 1px solid var(--rule)` and `border-radius: 999px`. Naming the header
`<nav>` `rex-scope` inherited both, 660 lines above the block that seemed to own
it. Hunting it in the new CSS found nothing twice, and the first search was
scoped to `.rex-side` and its descendants — which the nav is, but the scan
filtered for a border AND a radius on the same element and printed only the
matches it could fit.

The row is `rex-listhead` now, and its right-hand group `rex-listhead-end`. **A
class name in this file is global**, and the overlay has one stylesheet: a new
name has to be grepped before it is used, exactly as a new function would be.

### 13.8 The header grew a third row: the two ways to make something

Reported on 2026-09-02. **`＋ New` and `New folder` were as far apart as the
panel allows** — one at the right edge of row 1, one at the foot below the whole
list. They answer the same question, *how do I add something?*, and a reviewer
who has scrolled the list can see neither the foot's answer nor, having found
it, the one at the top.

Both are in one place now, in a row of their own between the header and the
filters:

```text
┌────────────────────────────────────────────────┐
│      ┌──────────────┬─────────────────┐     ⋮  │  scope
│      │ All files 14 │ 01-initial.md 5 │        │
│      └──────────────┴─────────────────┘        │
│  [＋ New comment] [🗀 New folder]               │  make
│  (draft 1)(note 1)(open 9)(done 2)(gone 1)     │  state
├────────────────────────────────────────────────┤
```

**A row of its own, and not back in row 1.** Two labelled buttons plus the
switch do not fit a 384px sidebar — the pair needs about 214px of the 356px the
row has — and the labels are the point: `New` beside a button that really does
make a folder no longer says which of the two it is, so it reads `New comment`.

Moving them out **undoes §13.6's cost** rather than adding to it. Row 1 spent
176px on the mirror and the commands and could only centre the switch above
about 470px; it spends 48px now — one `.rex-icon-button` at each end — so the
switch is centred *and* keeps both labels whole at every width the panel can be
dragged to. Measured at the 384px default: the switch takes 233px of 384px and
nothing truncates.

The make row draws no rule under itself. The header above and the filters below
already draw one each, and a third cut the 34px band out of the panel instead of
letting the two control rows read as one block of chrome.

Two smaller things follow from the buttons being at the LEFT edge:

- **`.rex-new` is `position: relative` now.** Its `data-tip` label was hanging
  off whatever ancestor happened to be positioned. At the right edge that landed
  against the panel edge anyway; at the left edge it would have appeared 350px
  from the button that summoned it.
- **`data-tip` gained a left-aligned variant**, `.rex-makerow [data-tip]::after`.
  Every other label right-aligns so it grows leftwards over the row's own text.
  These two would grow off the panel's left edge, where nothing can be read.

The foot keeps *Synthesis thread…* — the one command there that is about
comments which already exist.
