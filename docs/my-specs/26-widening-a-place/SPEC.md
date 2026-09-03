# REX 26 — widening a place you already took

**Version:** 1.2 · 2026-09-01
**Status:** **built, and driven in a live window.** Milestones 0–3 are in the
tree; §7.1 was run against an isolated REX on 2026-08-31, and §9 records where
the build departed from version 1.0. **1.2 fixes the four faults behind one
report** — *"it works in maybe 80% of cases"* — and adds the rule they produced,
§4.4.1: a click takes what the bar shows.
**Depends on:** [`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md)
§3 (the selection panel), §3.1 (every click adds), §3.5 (`SelectionItem`), §4.1
(widening a row is re-anchoring it);
[`06-document-section-and-pen/SPEC.md`](../06-document-section-and-pen/SPEC.md)
§4.1 (`section` and `document` at the wide end), §6.1 (the path bar and its
words), §6.4 (what draws a box and what does not);
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §4.1 (one strip,
three states), §4.2 (the keys);
[`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md) §4 (a place has
a pane); [`24-pointing-mid-conversation/SPEC.md`](../24-pointing-mid-conversation/SPEC.md)
§3.1 (a place lands in the open card), §3.2 (the pending strip).

> [!note]
> **Nothing new is anchored.** Every scope this spec reaches is already built by
> `scopeChainForAnchor`, already re-anchored by `anchorFromAnchorScope`, and
> already offered — on one expanded row of one of the two lists. This spec moves
> that reach onto a bar the reviewer is already looking at, and gives it the two
> keys they already use.

---

## 1. Why

A place cannot be widened from where the reviewer is standing when they take it.

The reviewer's own words, 2026-08-31:

> I want to be able to select the element and then have an option to choose the
> parent elements as well. In some cases when I hit the option and pick the
> element, you are correctly showing in the bottom bar the whole path. I see
> where I am moving in the path for the markdown file for example.
>
> When I select the element I do not have any more possibility to select the
> parent elements because you are showing in the path, for example, some section
> and in the section I have a p element. If I select the p element I cannot
> select the whole section anymore. I would love to be able to select the whole
> section but I don't know how to do it.

### 1.1 What happens today, step by step

1. The reviewer holds `⌥` for 250ms (`ALT_PICK_DELAY`, `App.tsx:71`). Pick mode
   comes on and `PickLayer` is mounted over the pane.
2. They hover a paragraph. The path bar at the foot reads
   `section “3. Findings” › p`, and `p` is lit.
3. They click. `commitAt` (`App.tsx:2191`) probes again where the click landed
   and adds the paragraph as a place.
4. They let go of `⌥`. `onKeyUp` (`App.tsx:2603`) turns pick mode off,
   `PickLayer` unmounts, **and the path bar goes with it** — it is drawn inside
   that component (`PickLayer.tsx:264`).
5. The section they can see in their memory of the bar is now reachable by one
   route only: switch the sidebar to Selection, click the row to expand it, and
   click the `section` chip (`App.tsx:2275` `expandRow`, `SelectionPanel.tsx:258`).

Nothing on the collapsed row says the chips are under it, and step 5 is three
clicks away from a bar that had the answer on screen one second earlier.

### 1.2 The three routes, and where each stops

| Route | Reaches the parent? | Stops because |
|:--|:--|:--|
| `↑` / `↓` in pick mode (`PickLayer.tsx:120`) | **before** the click, yes | the keys are bound inside the layer, and the layer is mounted only while picking |
| Click again after `↑` | yes, but | §3.1 says every plain click adds, so the panel now holds `p` **and** `section` and one has to be deleted |
| The chips on an expanded row | yes | hidden until the row is clicked, mouse only, and the card's pending strip (spec 24 §3.2) has no chips at all |

### 1.3 The text drag has no bar at all

A place made by dragging over text never sees a path bar, because pick mode was
never on. `scopeChainForRange` (`pick.ts:732`) builds the same chain for it —
`text › p › section › document` — and the only thing that shows that chain is
the expanded panel row.

---

## 2. The rule

> **The path bar says what is chosen, and `↑` / `↓` walk it up and down the
> tree. What is chosen is the thing REX is outlining.**

The bar is not part of pick mode. It belongs to whatever is currently outlined,
which is one of exactly two things:

| What is outlined | The bar shows | `↑` / `↓` |
|:--|:--|:--|
| the hover, while pick mode is on and the pointer has moved since the last commit | the chain under the cursor | move the choice; the next click takes it — **unchanged from today** |
| a **place** — the one just taken, or the one whose row or outline was clicked | that place's chain, rebuilt from its anchor | **re-anchor that place**, in place. No second row |

Nothing else changes about picking. A click still adds, `esc` still leaves, the
three rules in `selection.ts` still decide what joins a list.

---

## 3. Changes to specs 05, 06, 08 and 24

| Spec | Section | Was | Becomes |
|:--|:--|:--|:--|
| 05 | §4.1 | a place is widened by the chips on its expanded panel row | the chips stay and gain a second, always-visible route: the path bar (§4) |
| 06 | §6.1 | the path bar is drawn while pick mode is on | drawn whenever something is outlined — a hover, or a focused place (§4.1) |
| 06 | §6.1 | the crumbs are tag names from `labelOf` — `p`, `td`, `tr` | the chips' words — `paragraph`, `cell`, `row` — from one function both callers share (§4.6) |
| 08 | §4.1 | the strip has three states: resting, path bar, pen bar | four, and the path bar is reached two ways (§4.7) |
| 24 | §3.2 | a pending place can be removed and reordered | and widened, through the bar — the strip itself grows no chips (§4.3) |

Nothing about anchors, the gate, the working copy, the prompt or the database
changes. This spec touches the renderer only.

---

## 4. What the reviewer does

### 4.1 The bar outlives the click

```text
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│   3. Findings                                                      │
│   ┌────────────────────────────────────────────────────┐           │
│   │ The retry budget is shared across the whole batch. │ 2         │
│   └────────────────────────────────────────────────────┘           │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ PATH 2   document › section “3. Findings” › paragraph  ▮▮▯         │
│          [↑][↓] widen / narrow   [⌥ wheel] the same   [esc] done   │
└────────────────────────────────────────────────────────────────────┘
```

| Part | What it is |
|:--|:--|
| `PATH 2` | The label, and the place's number in the list it landed in — the same number its outline draws, in the same colour. It says which row `↑` will move. Under a hover the label is bare `PATH`, as today. |
| The crumbs | Widest first, as today. The lit one is what the place currently is. Clicking one re-anchors the place to it. |
| `▮▮▯` | The strength of the lit scope (`AnchorStrength`), bars only. Its `title` carries the sentence the expanded row spells out — *"no id, but its text carries it if it moves"*. It is what tells a reviewer that one level wider is worth taking. |
| The hints | `widen / narrow` under a place; `click adds to the selection` under a hover, as today. |

Pressing `↑` re-anchors place 2 from the paragraph to the section. The outline
grows to the section's box, the row's label in the panel becomes
`Section · “3. Findings”`, and there is still one place. Pressing `↓` comes back
down, because the chain is rebuilt from the anchor the place had when it was
focused — the rule §4.1 of spec 05 already states, and the reason
`changeRowScope` reads `expandedBase` rather than the row's current anchor.

### 4.2 Which of the two things the keys move

The test is whether the pointer has moved over the document since the last
commit.

- A commit — a click, `Enter`, a pen drawing, a gap, a whole file from the tree
  — **focuses the place it made** and marks the hover chain spent.
- The next `pointermove` over either layer un-spends it, and the bar goes back
  to the hover.

So the reviewer's hand decides, and the answer is always on screen: the outline
under the cursor is a hover, the numbered outline is a place. This is the
promise `commitAt` already makes about the outline (*"the outline is REX's
promise about what a click takes"*), asked one step later.

A commit does **not** turn pick mode off. Hold `⌥`, click the paragraph, keep
`⌥` held, press `↑` — the place grows. Let go of `⌥` and the bar stays, because
it is no longer pick mode's.

### 4.3 A place in the card's strip widens the same way

Spec 24 put places on the open comment's pending strip instead of the panel
whenever a card is on screen. Those places are `SelectionItem`s like any other
and they focus like any other: the click that adds one focuses it, and `↑`
widens it. Their number is the strip's number — `targets.length + index + 1` —
so the bar, the strip row and the outline all say `4`.

The strip grows no chips of its own. One route that is always visible beats a
second copy of the panel's control in a second place.

### 4.4 `⌥` with the wheel

While the bar is up, `⌥` and the wheel widen and narrow, one scope per notch.
`⌥` up is wider, `⌥` down is narrower — the same direction as the keys, and the
same direction the crumbs read.

It exists for one flow: the `⌥` hold. The reviewer's left hand is already on
`⌥` and their right hand is on the mouse, so reaching for `↑` means letting go
of `⌥`, which under spec 08 §4.2 ends pick mode. With the wheel, the whole
gesture — arm, point, take, widen — is one hold and never leaves the mouse.

`⌘`/`ctrl` with the wheel keeps meaning zoom (`frame.ts:105`), and a bare wheel
keeps meaning scroll (`PickLayer.tsx:162`). `⌥` was free.

It is one branch in `PickLayer`'s `onWheel` and nothing else, because holding
`⌥` for 250ms is what mounts that layer (`ALT_PICK_DELAY`, `App.tsx:71`): while
`⌥` is down the layer is up and already owns the wheel. Two consequences to
know. A wheel notch inside those first 250ms scrolls, which is right — the mode
is not on yet. And the gesture is tied to the hold: a future spec that changes
how `⌥` arms pick mode has to bring the wheel with it, or `⌥ wheel` starts
scrolling the document instead.

### 4.4.1 What the click owes the outline

> **A click takes what the bar shows. Always, and without asking again.**

The click used to re-probe where it landed and let `keptIndex` carry the chosen
scope into the fresh chain. That works while the chosen element is still in that
chain, and `keptIndex` deliberately gives the choice up when it is not — for a
pointer that *moved*, the narrow scope is the right answer again.

**A scroll is not a pointer that moved.** The page slid under a cursor that
stayed still, and a reviewer who widened to a section and scrolled to see where
it ends has not changed their mind. Three rules follow, and together they are
the whole of it:

1. **A scroll never re-probes while a scope was chosen by hand.** The chosen
   element has not gone anywhere; only the viewport has. The outline is drawn
   from document coordinates, so it keeps pointing at the right box.
2. **A pointer move under 4 pixels is not a move.** A trackpad scroll nudges the
   cursor, and a mouse-down carries a `mousemove` with it. Nobody means anything
   by two pixels, and re-probing on them threw away a chosen section.
3. **A click after a hand-made choice commits that choice, with no fresh
   probe.** The re-probe exists for the case where no chain exists at all — a
   first click with no pointer move — and a hand-made choice cannot exist
   without a chain to have been made in.

A pointer that really moves still re-probes, and `keptIndex` still decides, so
pointing somewhere else gives the choice up exactly as it always did. What can
no longer happen is the bar saying one thing and the click doing another.

### 4.5 Focusing a place that is already listed

Three gestures focus one:

1. **Taking it.** Any commit, §4.2.
2. **Clicking its row** in the panel. This already expands the row and rebuilds
   its chain; now it also puts that chain on the bar. The chips and the bar show
   the same chain and either one moves it.
3. **Clicking its numbered outline** in the document. `PaneMarks` already draws
   the badge and a trash button in the margin; the badge becomes a button that
   focuses. It is the shortest route to *"not that, the section"* while the
   reviewer's eyes are on the page.

`esc` drops the focus and leaves pick mode. It never removes the place —
removing is the trash button and the row's `✕`, and those are unchanged.

The focus is dropped on its own when: the place is removed, the list is cleared,
the message carrying it is sent, or the document it belongs to is closed.

### 4.6 One vocabulary

The bar prints tag names and the chips print words, for the same chain:

| The chain | Bar today | Chips today |
|:--|:--|:--|
| `td` | `td` | `cell` |
| `tr` | `tr` | `row` |
| `p` | `p` | `paragraph` |
| `section` with a heading | `section “3. Findings”` | `section` |

Once the two sit within 200 pixels of each other this is a bug you can read off
the screen. **One function answers for both**, and its rule is:

> **The word, plus what identifies this one.**

| The chain | Reads |
|:--|:--|
| `td`, `th` | `cell` |
| `tr` | `row` |
| `p` | `paragraph` |
| `p` with a hand-written id | `paragraph #intro` |
| a section | `section “3. Findings”` |
| the file | `document` |
| a PDF page, a PDF line | `page 2`, `line` |
| a text selection | `text` |
| a tag with no word of its own | the tag |

The word half is the chips' vocabulary, because a reviewer choosing between
scopes is choosing between a cell and a row, not between `td` and `tr` — the
argument spec 06 §6.1 already makes for calling a PDF page `page 2` and not
`div`. The identifying half is what makes an anchor durable rather than
positional, so it is the half the reviewer can act on; it is **clipped to 24
characters** rather than dropped, because a chip that wraps is worse than a
heading you read the start of.

`chipWord` moves out of `SelectionPanel.tsx:97` into `pick.ts` beside `labelOf`,
as `scopeWord`, and both callers use it.

`PickScope.label` keeps `labelOf`'s value, which the panel row and the hover
badge still use. The word is computed from the scope, not stored on it.

### 4.7 The strip, and what it says when

Spec 08 §4.1 gave the foot of the pane three states and one at a time. It gains
a fourth, and the path bar is now reached two ways:

| State | When |
|:--|:--|
| Resting — `⌥ pick element`, `N pen`, `⇧ add` | no mode on, nothing focused |
| The path bar, about a hover | pick mode on, the chain not spent |
| The path bar, about a place | a place is focused — pick mode on or off |
| The pen bar | pen mode on |

The bar is drawn in the pane the focused place belongs to (spec 16 §4), which is
the same pane its outline is drawn in. A place taken from the original pane
widens in the original pane.

A focused place whose document is not open, or whose anchor no longer resolves,
has no chain. There is no bar, the strip rests, and the panel row keeps the
sentence it already says — *"This place cannot be widened — it no longer
resolves in the document."*

---

## 5. Where the code goes

### 5.1 The files

| File | Change |
|:--|:--|
| `renderer/anchor/pick.ts` | `chipWord` moves here and gains the id suffix (§4.6) |
| `renderer/overlay/PathBar.tsx` | **new.** The bar, lifted out of `PickLayer` — crumbs, number, strength, hints |
| `renderer/overlay/PickLayer.tsx` | loses the bar and keeps the pointer surface; `⌥ wheel` in `onWheel`; the arrow keys move to `App` |
| `renderer/overlay/DocumentView.tsx` | mounts `PathBar` beside `ModeStrip` in whichever pane is showing the focus; `ModeStrip`'s condition gains the focus |
| `renderer/overlay/App.tsx` | `pathFocus`, `pathScopes`, `pathActive`, `pickSpent`; `rescope` generalised out of `changeRowScope`; the arrow keys; every commit sets the focus |
| `renderer/overlay/PaneMarks.tsx` | the number badge becomes a button that focuses (§4.5 point 3) |
| `renderer/overlay/SelectionPanel.tsx` | `chipWord` imported instead of defined; the chips read `pathScopes` |
| `renderer/overlay/overlay.css` | the bar's number token and the bare strength bars |

### 5.2 The state that goes away

`rowScopes`, `rowActive` and `expandedBase` are the expanded panel row's private
copy of exactly what the bar needs. They become `pathScopes`, `pathActive` and
`pathFocus`, and the panel row reads them. One chain on screen, one chain in
state.

```ts
/**
 * Spec 26 §4.2 — the place the path bar is about, and the anchor its chain was
 * rebuilt from.
 *
 * The base anchor is kept rather than re-read from the item, for spec 05 §4.1's
 * reason: re-anchoring to the section and then rebuilding from *that* drops
 * every scope narrower than the section, and the reviewer widens once and can
 * never come back.
 */
interface PathFocus {
  itemId: string;
  /** Spec 24 §3.2 — the comment whose strip holds it, or null for the panel. */
  threadId: string | null;
  pane: DocumentVersion;
  base: { anchor: Anchor; kind: SelectedKind };
}
```

### 5.3 One function re-anchors, whichever list holds the place

`changeRowScope` (`App.tsx:2316`) already does the work for the panel. It stops
reading `expandedBase`, takes the focus, and writes back through the same
two-list pattern `removeItem` (`App.tsx:1952`) already uses — the panel list and
`pendingByThread`, because a place is drawn the same way from either.

```ts
/** Spec 26 §4.1 — re-anchor the focused place to one scope of its chain. */
const rescope = useCallback((index: number): void => { /* … */ }, [/* … */]);
```

The surface calls are the ones that exist: `scopesForAnchor(anchor, kind)` to
build the chain, `anchorFromAnchorScope(anchor, kind, index)` to take one. No
new method on `DocumentSurface`.

### 5.4 The keys move up

`PickLayer`'s `keydown` effect (`PickLayer.tsx:101`) handles `↑`, `↓`, `Enter`
and `esc`, and it works only while the layer is mounted. `↑` and `↓` move to
`App.tsx`'s own `onKeyDown`, where they read the focus. Two guards come with
them, unchanged in substance:

- The `TEXTAREA` / `INPUT` test through `composedPath()[0]`, because the shadow
  boundary retargets `event.target` to the host. `App.tsx` has `typing()` for
  this and it is the same test.
- `⌥` with an arrow belongs to the comment list while focus is in it (spec 14
  §4.5, `App.tsx:2467`). Bare arrows are not that binding, and the guard is
  already written.

`Enter` and `esc` stay in the layer for the hover, and `esc` gains the focus
drop in `App`.

---

## 6. What this gives up

1. **`↑` and `↓` have two meanings.** They are told apart by whether the pointer
   moved, which is visible on the page — the hover outline against a numbered
   one — but not from the keys themselves. The bar's hint line says which
   meaning is live, and that is the whole mitigation.
2. **The resting chips are hidden while a place is focused.** `⌥ pick element`
   and `N pen` are not on screen until `esc`. They are hints for modes the
   reviewer is already inside, and the keys still work.
3. **Only the focused place widens.** Take three places and only the third is on
   the bar. Widening the first means clicking its row or its outline. A bar
   showing three chains at once is a panel, and there is one of those already.
4. **A region is still cut from the expanded row.** `a region of it` needs a
   drag inside a target box, and that flow starts at the chip. The bar arms
   nothing.

---

## 7. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| 0 | One vocabulary | `chipWord` in `pick.ts`, used by the bar and the chips; `td` reads `cell`, `p` reads `paragraph`, `section` keeps its heading, a PDF page keeps `page 2`, and a stable id survives as `paragraph #retry-policy`. `node --test` covers the table and the id suffix. |
| 1 | The bar, about a place | `PathBar` mounted from `DocumentView`; `pathFocus` / `pathScopes` / `pathActive` replace the row trio; clicking a panel row puts its chain on the bar; `↑` / `↓` and a crumb re-anchor the place and leave the list one row long; the panel row's label and the outline both follow. |
| 2 | The gestures | `pickSpent`, so a click focuses what it made and a pointer move gives the bar back to the hover; `⌥` with the wheel; the outline badge focuses; `esc` drops the focus without removing the place; a place in the card's strip widens; the bar is drawn in the focused place's pane. |
| 3 | The live run | §7.1. |

All four are built. §9 records where the build departed from the design above.

### 7.1 How milestone 3 is checked

In `~/Projects/Github/lukaskellerstein/my-ecommerce`, opened as the workspace,
on a Markdown document with a heading, a paragraph under it and a table.

1. Hold `⌥`, click the paragraph. Done when: one row in the panel reading
   `Paragraph`, one outline numbered `1`, and the bar reads
   `PATH 1  document › section “…” › paragraph` with `paragraph` lit.
2. Still holding `⌥`, wheel up one notch. Done when: the outline grows to the
   whole section, the panel still holds **one** row, and its label is
   `Section · “…”`. Wheel down once and it is `Paragraph` again.
3. Let go of `⌥`. Done when: pick mode is off, the bar is still there, and `↑`
   still widens.
4. Move the mouse over the table and press `P`. Done when: the bar goes back to
   the hover chain — bare `PATH`, `cell` lit — and `↑` moves the hover, not
   place 1.
5. Drag over a sentence with no mode on. Done when: the row is added, the bar
   shows `text › paragraph › section › document`, and `↑` twice makes the row
   the section.
6. Open a comment's card so a selection lands in its pending strip (spec 24
   §3.1). Pick a paragraph there and press `↑`. Done when: the strip still holds
   one row, numbered on from the comment's places, and the bar's number matches
   the outline's.
7. Click place 1's number badge in the document. Done when: the bar is about
   place 1 again and `↓` narrows it.
8. Press `esc`. Done when: the bar is gone, the resting chips are back, and both
   places are still in their lists.
9. `git status --porcelain` in the repository shows nothing. This spec writes no
   file and runs no agent.

---

## 8. Rejected

| Idea | Why not |
|:--|:--|
| Expand the newly added panel row on its own, and stop there | The cheap version of §4. It is mouse only, it needs the sidebar to be on the Selection tab, it does nothing for a place in the card's strip, and it puts the answer in the sidebar while the reviewer is looking at the document. |
| Make the click **replace** the place instead of adding a second | Spec 05 §3.1 — every plain click adds, and a reviewer who picks the section around the paragraph they picked usually wants both. Replacing is what §3.1's `isExtendedDrag` already does, for the one gesture where it is right. |
| A modifier with the click — `⌥`-click for the parent | Spec 05 §1 fault 1: on macOS `ctrl`-click is a right-click and the OS takes it, `⌥` already arms pick mode and `⇧` already arms Add. There is no modifier left, and building selection on a held one is the mistake spec 05 was written to undo. |
| A right-click menu on the element, listing the ancestors | A menu is a place you go and dismiss. The chain is already drawn at the foot of the pane, permanently, in the order it reads. |
| Let `↑` / `↓` walk the DOM directly, with no chain | The chain is what removes `<tbody>`, inline runs, `.textLayer` and `.markedContent`, and what appends `section` and `document` past the ancestor cap. Walking `parentElement` offers scopes nobody means — `pick.ts` lists each exclusion and why. |
| A tree view of the document, with the current element selected | A whole new view for one gesture, and it answers a question the bar answers in 34 pixels. |
| Keep `↑` / `↓` in `PickLayer` and mount the layer whenever a place is focused | The layer swallows every pointer event. A reviewer who has just taken a place wants to read on, and a transparent sheet over the document that eats clicks and text selection is the thing §5.2's own comment calls "a mode you leave". |
| Show every selected place's chain on the bar at once | That is the selection panel, which exists and has room for words, strength and a trash button. |

---

## 9. Where the build departed from version 1.0

### 9.1 One chain, built one way — not the commit's own

1.0 said the bar takes the chain the commit already built, because every
`Selected` carries one and reusing it costs no second pass over the DOM. That is
true and it is wrong: the chain a commit builds is **not** the chain
`anchorFromAnchorScope` indexes into when the reviewer then presses `↑`.

The §7.1 run caught it at step 11. After a text drag the bar read
`document › section › paragraph › [text]` — four scopes, built by
`scopeChainForRange` — and one `↑` produced the **section** rather than the
paragraph, because the chain rebuilt from the stored anchor has no `text` scope
and index 1 means something else in it.

So every route into the bar now goes through `focusPlace`, which rebuilds with
`scopesForAnchor`. A commit pays one extra resolve against the live DOM, once
per click, and the chain on screen is the chain the widening acts on by
construction.

**A consequence worth knowing:** a place made by dragging over text offers no
`text` scope once it is in a list — the narrowest thing the bar offers is its
paragraph. That is `scopeChainForAnchor`'s behaviour and it predates this spec:
the panel's chips have always shown the rebuilt chain, so they never offered one
either. Spec 26 makes it visible rather than causing it.

### 9.2 `esc` had nowhere to be handled

§4.5 says `esc` drops the focus, and the bar draws `esc done`. Both were true of
the design and neither was true of the build: `esc` was answered inside
`PickLayer`, and with pick mode off that layer is unmounted — so a bar left over
from a committed place could not be dismissed at all while telling the reviewer
to press `esc`. Step 7 of the §7.1 run found it. `App.tsx` answers `Escape` when
a place is focused; pick mode's own `esc` still comes through the layer, and both
end at `leavePick`, which is idempotent.

### 9.3 The frame had to be told to let the arrow keys go

`forwardKeysToParent` sends a **copy** of each key to the overlay and leaves the
original inside the iframe, so `preventDefault` on the parent's copy does
nothing about the frame's own scrolling: `↑` would widen the place *and* scroll
the document a line under the outline that had just grown. It takes a
`wantsArrows` ref now — the same shape `zoomFromInside` already takes, and for
the same reason — and swallows the original only while the bar is up.

### 9.4 The meter and the callbacks moved

`Strength` is its own file (`Strength.tsx`) with a `bare` switch, because the bar
draws it too and two copies would be free to disagree about how many bars a
`fair` anchor lights. `surfaceFor` and `focusPlace` moved above `guard` in
`App.tsx`: a `useCallback` dependency array is evaluated during render, so a
callback declared below one that names it throws rather than merely reading
oddly.

`rowScopes`, `rowActive` and `expandedBase` are gone as §5.2 promised, and
`PickLayer` lost the path bar, the crumbs, its `onActive` prop and the arrow
keys — 41 lines of it.

### 9.5 How it was tested

`node --test`: `test/scopeWord.spec.ts` (10, new — the word table, the
fall-through, the PDF labels, the id suffix and its clipping, text, section with
and without a heading, document, gap) and the fifteen existing suites, 218 tests,
all passing. `tsc --noEmit` is clean and `nvim-tools --json --all` reports the
baseline's 26 findings, none in a file this spec touched.

The live run of §7.1 was driven over CDP with `playwright-core` against an
isolated instance (`REX_CDP_PORT=9444`, `PW_CDP_PORT=9444`, its own
`REX_DB_PATH` and `REX_WORK_PATH`, a scratch workspace holding one Markdown
file), because port 9334 held the reviewer's own REX and the MCP is pinned to it.
Every check was read out of the shadow root — the crumbs, which one is lit, the
bar's number, the panel row's label, the outline badges — rather than looked at.
Three things the run taught, recorded for the next one:

- `npm run dev -- <path>` does not work: `electron-vite` takes the path as its
  own argument and fails on a missing entry point. Build first and launch
  `npx electron . <path>`, which is what the README already says.
- `playwright-launch.sh` reads the port it guards from `.mcp.json`, so an
  isolated instance needs **`PW_CDP_PORT`** set as well as `REX_CDP_PORT`;
  without it the launcher refuses on the reviewer's busy 9334.
- A note saved in NOTE mode is the cheap way to get a comment on screen for the
  §4.3 check — it writes the row, runs no agent and spends nothing.

### 9.6 The click did not keep the bar's promise — 2026-09-01

Version 1.1 shipped and the reviewer reported it working *"in maybe 80% of
cases"*:

> From time to time I am selecting the element and then scrolling. It selects
> the parent element or shows the highlighted parent element but when I click it
> still selects the element I am on top of, not the parent element that I scroll
> on.

**Four faults, one symptom.** §4.4.1 is the rule they produced.

| # | Fault | Why it only sometimes showed |
|:--|:--|:--|
| 1 | `commitAt` re-probed at the click point and let `keptIndex` carry the choice. When the chosen element was not in the fresh chain it fell back to the narrowest scope — silently, while the bar still showed the wide one | only when the scroll had gone far enough to put the click under a different heading |
| 2 | The wheel's re-probe dropped a hand-made choice the same way, because scrolling out of a section takes its heading out of the chain | only on a scroll that crossed a heading |
| 3 | `pathActiveRef` and friends were assigned during **render**, a whole render behind their setters. Every reader is an event handler, and events do not wait for React: a wheel notch that widened and a click that followed were two events with no guaranteed render between them | a timing window, so it depended on how fast the click followed |
| 4 | Releasing `⌥` ended pick mode even when `P` had turned it on. ⌥ is how the wheel widens, so the reviewer's own widening gesture disarmed the mode; the click then landed on the document and added **nothing** | only when they let go of ⌥ before clicking |

Fault 4 is the oldest and the least related to spec 26 — the keyup did
`if (!arming) setPicking(false)` unconditionally, while the `onBlur` beside it
already tested `heldPick.current` and carried the comment *"only what a hold
turned on is turned off"*. §4.4 made ⌥ a widening gesture and so put that fault
directly in the reviewer's path.

Fault 3's fix is `showChain`, which writes the state and its ref together, and
is now the only way a chain reaches the bar. It also fixed a smaller bug nobody
had reported: two quick notches of ⌥ + wheel widened one step, because the
second read the index from before the first.

`PickLayer` learned to say **why** it is asking for a probe — `"move"` or
`"scroll"` — because App cannot otherwise tell the reviewer pointing somewhere
else from the page moving under a still cursor. That distinction is the whole of
rules 1 and 2 in §4.4.1.
