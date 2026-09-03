# REX 28 — find in the page, and search across the workspace

**Version:** 1.2 · 2026-09-01
**Status:** **built, and driven in a live window.** Milestones 0–4 are in the
tree; §7.1 was run the same day against an isolated REX on port 9444 with a
scratch workspace of all five formats, and §9 records what the build changed
from version 1.1 and what the run measured. Milestone 3 — the PDF — landed
rather than falling back: pdf.js's legacy build reads a page's text under Node
26 in main, and `hello.pdf` was among the search results.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §6.3 (the
normalised text index), §6.7 (the CSS Custom Highlight API, and why nothing may
wrap a range), §7 (the shadow root), §10 (the IPC surface);
[`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md) §4 (the
tree scan and its limits), §7 (a workspace);
[`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md) §6 (the
selection's blue); [`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md)
§3.1 (one control that switches what a pane shows), §4 (a control belongs where
it acts); [`10-figure-preview-and-exclusions/SPEC.md`](../10-figure-preview-and-exclusions/SPEC.md)
§3 (an exclusion narrows what REX looks at);
[`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md) §6.1 (two panes);
[`18-what-the-colours-mean/SPEC.md`](../18-what-the-colours-mean/SPEC.md) (the
colour vocabulary); [`26-widening-a-place/SPEC.md`](../26-widening-a-place/SPEC.md)
§5.4 (keys forwarded out of the frame);
[`27-width-and-dark-paper/SPEC.md`](../27-width-and-dark-paper/SPEC.md) §4.1
(the corner the paper strip sits in), §6 point 2 (a light band on dark paper).

> [!note]
> **Version 1.1 — VS Code is the model.** Version 1.0 was answered with *"the
> same behaviour as in VS Code"*, and three things moved to match it. The page
> gains an **overview ruler** — the thin strip at the right edge that shows
> where the matches are along the whole document (§4.1.1, new). The Search
> view is a **tab** beside the tree, drawn with the segmented control the
> sidebar already uses, and not a link (§4.2). And a hit clicked in the results
> opens the file **with every match painted and the bar closed** — the results
> list is how you walk between hits, as it is in VS Code, and `⌘F` is one press
> away when you want the bar (§4.2, §5.5). Nothing else in 1.0 changed.

> [!note]
> **Two words, on purpose.** *Find* is one document — the page on screen, `⌘F`.
> *Search* is the workspace — every document in the tree, `⌘⇧F`. VS Code makes
> the same split with the same keys, and it is kept here so that neither word
> ever has to mean both.

---

## 1. Why

The reviewer's words, 2026-09-01:

> I want to be able to search in one document via Control F and I also want to
> be able to search across all documents via Control, Shift F.

And, asked what that should look like:

> The search should work in the same way as it works in VS Code. If I am
> searching on the document itself, it will just highlight the search text and
> I can scroll through the document and quickly see the highlighted text.
> Ideally it will show me on the right side the same kind of small thin sidebar
> that shows in what section of the document the searched text is in […]. If I
> am searching globally via Ctrl+Shift+F, the left sidebar, where now it shows
> workspace, will show or switch to the search mode or search tab. There it
> will list all the files where the search term is found and I can click on the
> files and it will show me again the file with highlighted text.

REX has neither. `⌘F` in the window does nothing at all: Electron ships no find
bar, and the document sits in a sandboxed iframe whose keystrokes never reach
the overlay (spec 26 §5.4). A reviewer who wants the third mention of
*invariant* in an 1,100-line spec scrolls for it, and one who wants every
document that mentions it opens each in turn.

### 1.1 What REX already has

Most of a find is already built, for the anchors:

| Needed for a find | Already there | Since |
|:--|:--|:--|
| the text of the page, whitespace-normalised, with a map back to the DOM | `buildTextIndex` — `TextIndex.text`, `offsetsToRange` | spec 01 §6.3 |
| a way to paint a range without touching the document | `CSS.highlights`, `highlight.ts` | spec 01 §6.7 |
| a way to bring a range into view | `scrollToAnchorIn` — a third of the way down | spec 05 §3.3 |
| a key pressed inside the frame reaching the overlay | `forwardKeysToParent` | spec 08 §4.2, 26 §5.4 |
| a control that switches what a column shows | the segmented tabs, `SidebarTabs` | spec 08 §3.1 |
| the list of every document in the workspace, exclusions applied | `documentPaths(scanWorkspace(…))` | spec 02 §4, 10 §3 |
| a rendering of every format as HTML in main | `renderDocument` | spec 03, 11, 19 |

One thing is genuinely new furniture: the **overview ruler** (§4.1.1). REX has
never drawn a picture of the whole document's height; the margin bars are in
document coordinates and scroll with the page. Everything else here is a query,
a bar and a panel over what exists — which is why §5's file map is mostly small
changes, and why §8 rejects the one shortcut that would have made it smaller
still.

---

## 2. The rule

> **A find is a question about the text on the page. It is answered from the
> same text the anchors are answered from, painted the way they are painted, and
> it never touches the document or its selection.**

Three consequences, and they settle §4.3, §4.4 and §5.4:

1. **Matching runs on `TextIndex.text`** — the normalised text of spec 01 §6.3.
   What the page shows is what a find can find: a `<style>` block or a `data-`
   attribute cannot match, and a query typed with two spaces matches text that
   has one. Whitespace is the one thing normalised and case is the one thing
   folded. Nothing else is (§4.3).
2. **Matches are painted with the Highlight API** in a colour of their own
   (§4.4), and the document's own selection is left alone. The selection is how
   a place is taken (spec 04, spec 05 §3), and a find that moved it would take
   places behind the reviewer's back.
3. **A search across the workspace searches the text each document opens as** —
   rendered, not raw — with the same matcher. A hit found in main is therefore a
   hit the page can show, and §5.5 is how it gets there.

---

## 3. Changes to specs 01, 02, 18, 26 and 27

| Spec | Said | Now |
|:--|:--|:--|
| 18 §3 | Two families, seven meanings, one colour each. | A **third family with one meaning: the reviewer's question.** Yellow `--find` means "the words you typed are here". No existing colour changes. §4.4. |
| 02 §4 | The explorer's column shows the tree. | It shows the tree **or the search results**, under two tabs — `Files` and `Search` — drawn with spec 08 §3.1's segmented control. The tree and its head are unchanged under the first tab. §4.2. |
| 26 §5.4 | `⌘`/`ctrl` combinations are left where they are inside the frame. | The **F chord is the one exception**: it is forwarded with its modifiers. The zoom keys are still not — `zoomFromInside` answers them, and a copy would zoom twice. §5.3. |
| 27 §4.1 | The paper strip sits alone at the top right of the pane. | It **shares the corner** with the find bar. The strip does not move; the bar appears to its left. §5.6. |
| 01 §10 | The command list. | Gains `workspace:search`. Nothing else on the surface moves. |

Nothing else in any spec moves. The anchors, the panes, the agent, Apply and the
working copy are untouched.

---

## 4. What the reviewer does

### 4.1 Find — `⌘F`

| Key | Does |
|:--|:--|
| `⌘F` or `ctrl F` | opens the bar at the top right of the pane and focuses its field. If the bar is open already: focuses it and selects its text — the browser's own behaviour, so the reviewer can type over the last query |
| typing | every match on the page is painted as you type, and the count reads `k of n` |
| `↵` / `⇧↵` | next / previous, wrapping at either end |
| `↑` `↓` `×` on the bar | the same three, for the mouse, each with a `title` |
| `esc` | closes the bar and drops every match's paint |

**Both modifiers**, for the reason `keys.tsx` gives for `⌘↵`: `⌘F` is what a
reviewer's hands know on macOS and `ctrl F` is what was asked for, and neither
costs the other anything.

**The page is the answer.** Every match is painted the moment it is typed, and
the reviewer scrolls the document and sees them — that is the whole request,
and the count and the arrows are conveniences on top of it. The paint stays
while the bar is open, through a scroll, a zoom and a `W`.

**The current match** is one of them, drawn stronger (§4.4). When the query
changes it is the first match at or below the top of what is on screen, so a
reviewer who scrolled to §6 and typed finds §6's match current rather than page
one's. `↵` moves it on. Either way the page is scrolled to it **only when it is
not already on screen** — VS Code's `revealRangeInCenterIfOutsideViewport`, and
the difference between a page that keeps still while you type and one that
jumps on every letter.

**The field starts with the words you were looking at.** If the document has a
text selection when the bar opens — one line, at most 100 characters — that is
the query; failing that, if the page is painted with a Search's query (§4.2),
that is. Select a word, `⌘F`, `↵`: the next place it appears. Chrome, Safari
and VS Code seed the same way.

**It works from inside the frame.** Clicking into the prose moves focus into the
iframe, and every key pressed there is invisible to the overlay unless the frame
forwards it (spec 26 §5.4). The F chord is forwarded, §5.3, so the bar opens
whichever side of the frame boundary the caret was on. Measured on 2026-08-25
for the mode keys: a binding that dies when the reviewer clicks the page reads as
"does not work".

**The bar** is one row — `[ field ][ k of n ][↑][↓][×]` — drawn as the paper
strip's pills are drawn: the same light `.rex-mode` pill, the same 26px height.
It sits beside those pills on the paper, so it has to read on both papers, and
the strip's pills already do. The field is 200px; the count is `k of n`, or
`no matches`, or `k of 1000+` past the cap (§4.3).

**Where it acts.** The pane the reviewer is reading. With two panes on screen
(spec 15 §6.1) that is the right-hand one — the version that will exist; with the
pane control on `Original` it is the original, which is then the only pane
visible. A find that painted a hidden pane would report `12 of 12` over an empty
screen. The bar and the ruler are drawn in the pane they act on (§5.6).

**Every format.** The index reads whatever the frame holds — a PDF's text layer,
a deck's slide text, a Word file's paragraphs, an HTML file's body — so nothing
here is per-format. The strip is Markdown-only because REX wrote that page's
stylesheet (spec 27 §2); a find asks nothing about the stylesheet.

**The bar outlives the document.** If it is open when another document is
opened, it stays, keeps its query, and the count answers for the new page the
moment its surface is ready.

**The graph in the centre.** `⌘F` shows the document and opens the bar — a find
is about the page, and the graph has no text to find in. With no document open
at all, `⌘F` does nothing.

#### 4.1.1 The overview ruler

A thin strip at the right edge of the pane, the full height of the pane, with
one mark per match at the height that match has in the whole document. VS Code
draws these marks in the scrollbar's track and calls the strip the overview
ruler; the name is kept because the reviewer asked for it by description.

```text
┌──────────────────────────────────────────┬─┐
│ ## 3. Changes to earlier specs           │ │
│                                          │▪│  ← a match, up in §1
│ | Spec | Said | Now |                    │ │
│ | 18 §3 | Two families … invariant …     │▪│  ← this one is on screen
│                                          │█│  ← the current match
│ …                                        │ │
│                                          │▪│
│                                          │▪│  ← two more, down in §8
└──────────────────────────────────────────┴─┘
```

- **It answers "where else, and how far".** Two marks close together low on
  the strip say the other mentions are near each other near the end; a strip
  that is solid yellow says the query is too short. Neither is visible from the
  count alone.
- **A mark is at `top / scrollHeight`** of the strip's height, at least 2px
  tall so a one-line match on a long page still shows. Marks are the ordinary
  yellow; the current match's is the stronger one, and a pixel wider.
- **Click a mark and the page goes there** — that match becomes current, the
  bar's count follows, and the page scrolls so it is a third of the way down.
  Between the marks the strip takes no clicks, so the frame's own scrollbar,
  which lives under it, still works.
- **It exists only while there are matches to show** — while the bar is open
  with a query that matches, or while the page is painted with a Search's
  query (§4.2). An empty strip is furniture, and the corner is furnished enough.
- **It is re-measured with every sweep**, which is every reason its marks could
  have moved: a zoom, a `W`, a pane resize, a Mermaid redraw. §5.2.

### 4.2 Search — `⌘⇧F`

The explorer's column gets two tabs, `Files` and `Search`, in a row above what
is there now — the same `.rex-segment` row the comments column switches
`Selection` and `Comments` with, because spec 08 §3.1 gave REX exactly one
control that means "switch what this pane shows" and this is that choice. The
existing head — `WORKSPACE · NAME`, `skipped`, `reload` — becomes the first row
of the `Files` view, unchanged. `⌘⇧F` selects the `Search` tab and focuses its
field. The `Search` tab carries a count: how many files the last search found
something in, dimmed at zero the way the empty `Selection` tab is.

```text
┌ [ Files ]  [ Search 6 ]                 ┐
│ [ orphaned                          ×] │
│ 14 matches in 6 files                   │
│                                         │
│ ▾ SPEC.md              docs/my-specs/01 │
│     … anchor must report ok, moved or   │
│     orphaned, and each classification … │
│     … the orphaned tray lists every …   │
│ ▾ components.md        docs/architecture│
│     … 3 comments are orphaned after …   │
│     and 12 more — ⌘F in the file        │
│ ▸ notes.docx                     sample │
│                                         │
│ not searched                            │
│   deck.pptx — could not be read: …      │
└─────────────────────────────────────────┘
```

- **It runs on `↵`, not as you type.** Reading every file in a workspace is an
  act, and a list that reshuffles under the pointer is a list nobody can click.
  The second search over the same workspace costs what a grep costs: the text
  is cached by path and mtime (§5.4). The field is `type="search"`, so the
  native `×` and `esc` clear it — and clearing it clears the results and every
  Search paint on the page.
- **Results are grouped by file, in tree order** — the order the explorer
  draws, directories first then alphabetical — so the reviewer's eye moves down
  the results the way it moves down the tree. A file row carries the file's
  name, its folder relative to the root, its count, and a twisty: a file with
  forty hits can be folded away, exactly as VS Code folds one. Under it, one row
  per hit: the words around the match, the match itself in `--find`.
- **The line above the list says the whole answer**: `14 matches in 6 files`,
  the way VS Code's does. Zero reads `no matches`.
- **A file row opens the file painted.** Click it: the document opens if it is
  not open, **every match of the query is painted on it**, the overview ruler
  shows them all, and the page lands on the first. The bar does **not** open —
  VS Code does not open its find widget from a search result, and a bar over a
  page you opened from the panel is furniture you did not ask for. The results
  list is how you move between hits; `⌘F` is one press away and its field
  already holds the query (§4.1) when you want the bar's `↵`.
- **A hit row lands on that hit.** The same, with that match current.
- **The list is a keyboard.** `↑` and `↓` move through the rows, `↵` opens the
  one under the focus, `←` and `→` fold and unfold a file. That is VS Code's
  results tree, and it is what makes walking every hit in a workspace a matter
  of holding one key.
- **The paint follows the Search, not the file.** While the Search view holds a
  result, **any** document opened — from the results, from the tree, from the
  graph — is painted with that query and carries the ruler, until the search is
  cleared or the bar is opened with a different query. That is VS Code's
  behaviour too, and it is what makes the tab and the page agree: the tab says
  6 files, and each of the 6 says where.
- **What is searched** is every document `documentPaths(tree)` lists — which
  means an excluded file or folder is not searched (spec 10 §3: an exclusion
  narrows what REX looks at), REX's own skip list is not, and a file with a
  working copy is searched as the version it opens as (spec 15 §6.1). What each
  format's text is, and what it costs, is §5.4.
- **The limits are said out loud** (spec 02 §4.2). 50 hits per file and 500 in
  all; a file past its cap ends with `and 12 more — ⌘F in the file`, and a
  search past the total says so on the line above the list. A truncated tree
  carries the tree's own warning line into the results. A file that could not
  be read is listed under **not searched**, with the reason — never silently
  missing.
- **The results are a snapshot.** Editing a file, an ACT run, a rename — none of
  it refreshes the list. `↵` again does. A list that rewrote itself while the
  reviewer was reading it is the fault above, arriving later.
- **The results survive the tab.** Switching to `Files` and back shows the same
  list; the `Search` tab's count says it is still there.
- **No workspace, no search.** With a single file open there is no tree, and
  `⌘⇧F` shows the notice *"Open a folder to search across documents."* rather
  than doing nothing.

### 4.3 What matches

One matcher, `findMatches(text, query, max)` in `src/shared/find.ts`, used by
both processes on both kinds of text.

| Rule | Because |
|:--|:--|
| **case is folded** — a `RegExp` with the `i` and `u` flags over the escaped query | offsets come back in the original string whatever the folding did to lengths, which a `toLowerCase()` on both sides cannot promise |
| **the query's whitespace is collapsed** to single spaces and trimmed | the index text is (spec 01 §6.3 rule 4), so a query has to be, or a double space could never match |
| **an empty query matches nothing** and paints nothing | |
| **the query is literal** — `.`, `*`, `(`, `?` are escaped | the reviewer asked for find, not grep. §8 |
| **matches do not overlap** — the `g` flag advances past each | `aa` in `aaa` is one match, as it is in every editor |
| **one character is a query** | the browser's rule, and the count says how many that was |
| **at most 1,000 matches are painted** on one page | the Highlight API is asked to paint every range on every keystroke; a single letter over a long document is thousands. The count reads `k of 1000+`, the ruler draws the first thousand, and the reviewer types a second letter |
| **accents are not folded** — `e` does not match `é` | a second normalisation the anchor index does not share would find text the index cannot express. §8 |

### 4.4 The colour — yellow, the eighth meaning

Spec 18 §3 gives REX two families: what the change did to the document, and
what happened to a comment. A find match is neither. It belongs to the
**reviewer** — what they are looking for, right now — so it is a third family
with one row:

| Meaning | Marker | Colour |
|:--|:--|:--|
| the words the reviewer is looking for | a wash on the text; a mark on the ruler | yellow `--find` |
| the one they are on | a stronger wash of the same yellow and a rule; a stronger, wider mark | |

Two intensities of one hue, for spec 15 §8.4's reason: "which one am I on" is a
question about one of the matches, and two colours would say they were two
kinds of thing.

**Yellow**, for two reasons. It is free on the text: nothing amber has been
painted on a passage since spec 15 §8.4 moved the state colours to the margin,
and `--moved` lives in pills and bars. And it is what every editor and browser
paint a find in, so the reviewer's hands already know what it means. It is
**lemon, not gold** — `--moved` is `#d9b23a`, and a find wash on a card beside a
moved pill must not read as the same thing.

| Role | Value | Where |
|:--|:--|:--|
| `HIGHLIGHT.findBg` — every match | `#fff1a8` | on the paper, with `PAPER.ink` stated beside it (`highlight.ts`'s rule) |
| `HIGHLIGHT.findCurrentBg` — the current one | `#ffd21f` | the same |
| `HIGHLIGHT.findRule` — under the current one | `#8a6a00` | a 2px `text-decoration`, the only underline the API paints |
| `--find` — a mark on the ruler; the match in a result row | `#f0d45c` | the chrome, as text on `--panel` and as a 2px mark on the ruler |
| `--find-strong` — the current match's mark | `#ffd21f` | the ruler |
| `--wash-find` | `#3d3512` | behind a result row's match — hue kept, lightness mirrored, spec 27 §4.4's rule |

`#fff1a8` against `PAPER.ink` is about 14:1 and `#ffd21f` about 11:1; `#f0d45c`
on `--panel` is about 10:1. `test/find.spec.ts` asserts all three the way
`paper.spec.ts` asserts the dark paper, so the numbers are measured once rather
than argued about later.

**On the dark paper** a match is a light band with dark ink — exactly spec 27
§6 point 2, louder than on paper and legible. The anchor washes made the same
choice for the same reason.

**The current match wins over the open comment.** A find inside the passage
whose card is open would otherwise vanish into the violet. The current match's
`Highlight` carries `priority` 2 and the wash 1; the anchor highlights keep 0.

---

## 5. Where the code goes

### 5.1 The files

| File | Change |
|:--|:--|
| `src/shared/find.ts` | **New.** `normaliseQuery`, `findMatches`, `contextOf`, and the three limits. Pure — both processes and `node --test` import it. |
| `src/shared/types.ts` | `SearchHit`, `SearchFileHits`, `WorkspaceSearchResult`, `FindMark`. |
| `src/shared/tokens.ts` | `HIGHLIGHT.findBg`, `findCurrentBg`, `findRule`. |
| `src/shared/channels.ts` | `workspace:search`, `WorkspaceSearchRequest`, and the method on `RexApi`. |
| `src/preload/index.ts` | The method on the bridge. |
| `src/main/search/text.ts` | **New.** `textOfHtml`, `documentText(path)` per format, the mtime cache. |
| `src/main/search/pdf.ts` | **New, milestone 3.** The PDF's text, through pdf.js's legacy build. |
| `src/main/search/index.ts` | **New.** `searchWorkspace(db, root, query)` — the paths, the loop, the caps, the `not searched` list. |
| `src/main/ipc.ts` | The handler. |
| `src/renderer/anchor/highlight.ts` | `paintFind(win, ranges, current)` and `clearFind(win)` — two more names in the registry, and their rules in the constructed stylesheet. |
| `src/renderer/overlay/anchoring.ts` | `find`, `findShow`, `findClear` on `DocumentSurface`; `FrameSurface` keeps the ranges and measures the marks. |
| `src/renderer/overlay/frame.ts` | `forwardKeysToParent` forwards the F chord. |
| `src/renderer/overlay/FindBar.tsx` | **New.** The bar. |
| `src/renderer/overlay/FindRuler.tsx` | **New.** The overview ruler. |
| `src/renderer/overlay/find.ts` | **New.** `useFind` — the bar's state, the Search paint, which of the two the page shows, the chord handlers, the jump. |
| `src/renderer/overlay/Tabs.tsx` | **New.** The segmented row, lifted out of `SidebarTabs` so both columns draw one control. `SidebarTabs` keeps its `⋮` menu and uses it. |
| `src/renderer/overlay/SearchView.tsx` | **New.** The field, the summary line, the results tree, the keyboard. |
| `src/renderer/overlay/Explorer.tsx` | The two tabs above the head; mounts `SearchView` under the second. |
| `src/renderer/overlay/DocumentView.tsx` | The corner shared with the strip; the ruler; hands both to the original pane when that is the pane being read. |
| `src/renderer/overlay/OriginalPane.tsx` | One optional `corner` slot and one optional `ruler` slot, drawn where the current pane draws its own. |
| `src/renderer/overlay/App.tsx` | The two chords in `onKeyDown`, the re-find after each sweep, `findWhenReady` in `onSurfaceReady`, the no-workspace notice, the search state. |
| `src/renderer/overlay/overlay.css` | `.rex-corner`, `.rex-find`, `.rex-ruler`, `.rex-search`, `--find`, `--find-strong`, `--wash-find`. |
| `test/find.spec.ts` | **New.** §7 milestone 0. |
| `package.json` | `test:find`. |

### 5.2 Find is three methods on the surface

```ts
/** Spec 28 §4.1 — paints every match, keeps them, and says where they are. */
find(query: string): { count: number; marks: FindMark[] };
/** Paints one as current; scrolls to it only if it is off screen (§4.1). */
findShow(ordinal: number): void;
/** Drops the ranges and every match's paint. */
findClear(): void;
```

with

```ts
/** §4.1.1 — one match's place along the whole document, both in 0..1. */
interface FindMark { top: number; height: number }
```

The surface is the right owner because the surface owns the index. `find` runs
`findMatches` over `this.index.text`, turns each hit into a live `Range` with
`offsetsToRange`, paints them all, and measures each against
`documentElement.scrollHeight` for the ruler. `findShow` repaints with one range
in the current colour and, if that range is outside the viewport, scrolls the
way `scrollToAnchorIn` scrolls — a third of the way down, because a match pinned
to the top edge reads as if its context were cut off.

**The sweep runs the find again.** `App.tsx`'s `sweep` is where the index is
rebuilt, and every reason to sweep is a reason the old ranges and the old marks
are wrong: a zoom and `W` reflow every line, a pane resize changes the height
every mark is measured against, and a Mermaid redraw replaces nodes and
collapses every `Range` inside them. So after `resolve`, if the page has a
query — the bar's or the Search's, §5.5 — `sweep` calls `find` again and the
bar's count and the ruler's marks are set from what comes back. It is a
fraction of the sweep's own cost, and it means the paint is never a picture of
a layout that has gone.

### 5.3 The chord out of the frame

`forwardKeysToParent` returns early on `⌘`/`ctrl`, and spec 26 §5.4 says why:
`zoomFromInside` already answers the zoom keys inside the frame, and a copy
would zoom twice. The F chord has no listener inside the frame, so it is the
exception: forwarded with `metaKey`, `ctrlKey` and `shiftKey` copied, and the
original `preventDefault`ed so Chromium does not act on it. The copy has no
target inside a field, so `typing()` in `App.tsx` reads it as "not a field" and
the binding fires — the same property the mode keys rely on.

### 5.4 The text main searches

`textOfHtml(html)` is spec 01 §6.3's walk, written over a string instead of a
DOM:

1. comments out;
2. `script`, `style`, `head`, `title`, `template`, `noscript` and `desc` out
   **with their content**, matched case-insensitively — an SVG `<style>`
   reports its tag in lower case, and on 2026-08-21 four thousand characters
   of Mermaid's CSS entered the index that way;
3. every other tag removed **with nothing in its place** — the DOM puts no
   character at a tag boundary and neither does this, so `<b>a</b>b` reads
   `ab` in both;
4. entities decoded, with `entities`, which is already a dependency;
5. whitespace runs collapsed to one space, and the leading one dropped.

On HTML REX wrote itself — markdown-it's, mammoth's, the deck renderer's — the
result **equals** `TextIndex.text`, and `test/find.spec.ts` asserts it does on
`renderMarkdown`'s output. On an author's own HTML it is close, and §5.5 says
what happens when it is not.

| Format | Text from | Note |
|:--|:--|:--|
| Markdown | `renderMarkdown(source)` → `textOfHtml` | rendered, not raw — a hit in a link's URL or a fence marker is a hit the page never shows, and the ordinal would disagree with the page. §8 |
| HTML | the file → `textOfHtml` | |
| DOCX | `renderDocx(path).html` → `textOfHtml` | mammoth, as opening does |
| PPTX | `renderPptx(path, hash).html` → `textOfHtml` | as opening does; its sidecar cache keyed by content hash makes the second read cheap |
| PDF | pdf.js, legacy build, `getTextContent` per page, items joined by spaces | **milestone 3.** Main does not read a PDF's bytes today (spec 03 §7.1) and the renderer's pdf.js needs a canvas; the legacy build runs under Node and extracts text without one. Imported dynamically, as the renderer imports the same library. Until it lands, and if it cannot, a PDF is listed under **not searched** |

A file with a working copy is read from `currentPath(meta)` exactly as
`doc:open` reads it — the version the reviewer sees is the version searched.

**The cache** is a `Map` from the path actually read to `{ mtimeMs, size,
text }`, checked with one `stat` per file per search. It lives for the session
and in memory only: a persistent index would make the database about something
other than comments, which spec 25 §6.1 warned against, and one reviewer's
workspace does not need one.

### 5.5 Two queries, one page — and the jump

The page can be asked to paint by two things: the bar, and the Search. One rule
decides which it shows:

> **The bar's query while the bar is open; the Search's query otherwise; nothing
> when neither has one.**

`useFind` holds both and derives the page's query from them. Opening the bar
over a Search-painted page seeds the bar with the Search's query (§4.1), so the
paint does not change under the reviewer's eyes — it merely gains a bar and a
current match. Closing the bar returns the page to the Search's paint. Clearing
the Search drops its paint from every page. Every document opened while a
Search has a result is painted on arrival: `onSurfaceReady` asks `useFind` for
the page's query and calls `find` before the first frame is shown.

**The jump.** Main returns, for every hit, its **ordinal** among the file's
matches and its **context** — up to 48 characters either side, cut at a word,
from `contextOf`. When a row is clicked the renderer, once the document's
surface is ready:

1. `surface.find(query)` — every match on the page, painted, and the ruler's
   marks;
2. take the match at `ordinal` if its context agrees with the hit's;
3. else the first match whose context agrees;
4. else the match at `ordinal`, if there is one;
5. else the first;
6. `surface.findShow(that)`.

Step 2 is the case on every page REX rendered, because §5.4's text equals the
page's. Steps 3 to 5 are for an author's HTML that the stripper read differently
from the DOM: the reviewer lands on *a* match of their words, the ruler shows
the rest, and the right one is a click away — never nowhere, and never a wrong
place reported as right.

This rides on the pattern `scrollWhenReady` already uses for a comment row
clicked while its document was closed: `findWhenReady` holds the hit until
`onSurfaceReady` fires for that document, then runs the six steps above.

### 5.6 The corner, and the ruler

The paper strip is at `right: 72px; top: 14px` inside `.rex-half-body` (spec 27
§4.1). It stays exactly there. The strip and the bar go into one right-aligned
row, `.rex-corner`, at that position, so the strip's right edge is where it was
and the bar grows leftwards from it. On a page with no strip — everything that
is not Markdown — the bar sits alone at the same corner.

The ruler is `.rex-ruler`: `position: absolute; right: 0; top: 0; bottom: 0;
width: 10px`, in the same `.rex-half-body`, above the frame in z-order and below
the corner. It is `pointer-events: none`; each mark is `pointer-events: auto`,
so the frame's scrollbar under the strip keeps working everywhere a mark is not.
A mark is `top: ${mark.top * 100}%; height: max(${mark.height * 100}%, 2px)`;
the current one is 2px wider and `--find-strong`. The comment bars are in the
paper's margin at document positions (`MarginBars`), not at the pane's edge, so
the two never meet.

When the pane being read is the original (§4.1), the bar and the ruler are drawn
in the original pane's body instead, through a `corner` slot and a `ruler` slot
on `OriginalPane`. The strip stays with the current pane: one strip governs both
(spec 27 §4.6), and a second copy is the control spec 27 declined to draw.

### 5.7 The Search view

`Explorer` gains the tabs row above its head, drawn by `Tabs` — the segment
lifted out of `SidebarTabs`, so the two columns cannot drift. Under `Files`
everything is as it was. Under `Search`, `SearchView`: the field, the summary
line, the results tree with its twisties, and the roving focus that makes `↑`
`↓` `↵` `←` `→` work, in the manner of `Sidebar.tsx`'s `moveByKey`.

The last result, the query and the folded files live in `App`, not in the view,
so switching tabs does not lose them, and so the jump (§5.5) can read the hit it
is about. A stale answer — the reviewer pressed `↵` twice before the first came
back — is dropped by comparing the answer's query to the field's.

---

## 6. What this gives up

1. **No regex, no whole word, no case toggle.** Three controls on a 260px bar
   for a tool whose `⌘F` in every browser has none. If one is ever wanted it
   is a switch on the same bar, not a rewrite.
2. **No accent folding.** §4.3's last row.
3. **No `F4`.** VS Code's "next search result" key walks the results without
   the list having focus. Here the list is the keyboard (§4.2), and it has to be
   focused to be one.
4. **Results are a snapshot.** §4.2.
5. **Search does not read the comments.** That is a different question with a
   different answer — the sidebar's chips — and one panel that answers two
   questions is the confusion spec 08 §3.1 removed.
6. **Search does not match file names.** The tree is alphabetical and at most
   5,000 rows; a name filter is its own feature.
7. **An author's HTML can put a hit's context out of step with the page.** §5.5
   says where the reviewer lands then, and the ruler shows the rest.
8. **The find does not skip hidden text.** The index does not either (spec 01
   §6.3), so a match inside a collapsed `<details>` scrolls to a closed
   disclosure, and its mark is on the ruler. The anchors have lived with this
   since milestone 0.
9. **The ruler shows matches and nothing else.** VS Code's also shows the
   cursor, errors and changes. Comments already have the margin bars, and a
   second picture of them is a second thing to keep in step.

---

## 7. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| 0 | The matcher and the stripper | `npm run test:find`: case folded; a query's whitespace collapsed; specials escaped; no overlap; the cap; `contextOf` cut at a word; `textOfHtml` over `renderMarkdown`'s output equals the text a DOM walk gives — script, style, head and an SVG `<style>` skipped, entities decoded, no character at a tag boundary; the three contrast ratios of §4.4. `node --test` green. |
| 1 | Find, and the ruler | `⌘F` and `ctrl F` open the bar on a Markdown file, an HTML file, a PDF, a DOCX and a PPTX, from the overlay and from inside the frame; every match is painted as you type; the ruler shows one mark per match with the current one stronger; the current match is the first from the top of the viewport and the page scrolls only if it is off screen; `↵`/`⇧↵` walk and wrap; clicking a mark goes there; `esc` drops the paint and the ruler; the paint and the marks survive a zoom, `W` and a pane resize; the strip has not moved; the bar seeds from a selection; with the pane control on `Original` the bar and the ruler are in that pane. |
| 2 | Search | `⌘⇧F` selects the `Search` tab and focuses the field; `↵` runs; `N matches in M files`; results in tree order, grouped, with twisties and counts; a file row in a closed document opens it painted, with the ruler, on its first match and **no bar**; a hit row lands on that hit; `⌘F` then opens the bar with the query in the field; `↑` `↓` `↵` walk the list; a document opened from the tree while a result stands is painted too; clearing the field drops every paint; an excluded folder's files are absent; the per-file and total caps are reported; a broken file is under `not searched` with its reason; the tab's count is the file count; no workspace shows the notice. |
| 3 | PDF text | a PDF's hits appear in the results and its jump lands; or, if the legacy build will not run in main, the PDF is listed under `not searched` with a reason that says so, and §9 records why. |
| 4 | Live, and clean | §7.1. |

### 7.1 How milestone 4 is checked

In an agent REX (`.claude/hooks/playwright-launch.sh npm run dev`), with this
repository opened as the workspace — its specs carry every construct a find has
to walk, and `sample-files/` and the fixtures carry the other formats.

1. Open `docs/my-specs/01-initial/SPEC.md`, scroll to §6. `⌘F`, type
   `invariant`. Done when: the bar is at the top right beside the strip, every
   match on the page is yellow, the ruler at the right edge shows a mark per
   match, the count reads `k of n` with `k` the first match at or below the
   top of the viewport and `n` what a grep of the rendered page gives, and the
   page did not scroll.
2. `↵` three times, `⇧↵` once. Done when: the count reads `k+2 of n`, the
   current match and its mark moved each time, and the page scrolled only when
   the next match was off screen.
3. Click the lowest mark on the ruler. Done when: the page is at the last
   match, painted as current, and the count says `n of n`.
4. Click into the prose, then `⌘F`. Done when: the bar takes focus with its
   text selected — the chord crossed the frame.
5. Press `W` with the bar open, then drag the explorer's splitter. Done when:
   the matches are painted on the reflowed lines, the marks moved to the new
   heights, and the count is unchanged.
6. `esc`. Done when: no yellow remains on the page, the ruler is gone, and the
   strip is where it was.
7. Select a word in the page, `⌘F`. Done when: the field holds the word.
8. Open an HTML file, a PDF, a `.docx` and a `.pptx`, `⌘F` in each. Done when:
   the bar opens, matches are painted, the ruler shows them, and `↵` walks them.
9. `⌘⇧F`, type `orphaned`, `↵`. Done when: the explorer shows the `Search` tab
   with a count, the line reads `N matches in M files`, and the results are
   grouped by file in tree order with twisties.
10. Click a file row for a document that is not open. Done when: the document
    opens with every match painted and the ruler showing them, the page is at
    its first match, and **no bar is open**. `⌘F`: the bar opens with
    `orphaned` in the field and `1 of n`. `esc`: the paint stays, because the
    Search still holds it.
11. With the list focused, `↓` `↓` `↵`. Done when: the page is at that hit.
12. Open another document from the tree. Done when: it is painted with
    `orphaned` too, and the ruler shows its marks.
13. Exclude a folder that had hits, `↵` again. Done when: its files are gone
    from the results and the tab's count fell.
14. Clear the field with its `×`. Done when: the list is empty, the tab's count
    is dim, and no page carries yellow.
15. Quit REX and start it again, `⌘⇧F`, the same query. Done when: the results
    return — nothing was persisted and nothing needed to be.
16. `git status --porcelain` in the workspace is unchanged. A find and a search
    write no file.
17. `nvim-tools --json --all` adds no finding against the baseline.

---

## 8. Rejected

| Idea | Why not |
|:--|:--|
| `webContents.findInPage` — Chromium's own find | It searches the whole window: the sidebar, every comment card, the top bar and both panes at once, and there is no way to scope it. It **moves the document's text selection** to each match, and a selection is how a place is taken (spec 04, 05 §3). Its highlight is a colour outside spec 18 that cannot be styled, and it cannot feed a ruler. And Electron ships no bar, so REX draws one either way — the shortcut saves the matcher and costs everything else. |
| Draw the marks inside the frame's own scrollbar, where VS Code draws them | The scrollbar belongs to the iframe and the overlay cannot paint in it. The ruler sits over that lane instead, and passes clicks through wherever a mark is not (§5.6). |
| Open the find bar when a search result is clicked | VS Code does not, and the reviewer asked for VS Code. The results list is how you move between hits; a bar over a page you opened from the panel is furniture you did not ask for, and `⌘F` is one press away with the query already in the field. Version 1.0 did this and 1.1 undid it. |
| A `search` link in the explorer's head instead of a tab | Version 1.0's answer, chosen for width. The reviewer said *tab*, spec 08 §3.1 already has the control, and a row above the head costs the tree nothing. |
| Regex, whole-word and match-case switches | §6 point 1. The reviewer asked for find. |
| Accent-insensitive matching | §4.3. A second normalisation the anchor index does not share finds text the index cannot express, and the highlight has nowhere to land. |
| Search as you type across the workspace | §4.2. Reading every file is an act, and a list that reshuffles under the pointer cannot be clicked. The in-page find is live because the page is already in memory. |
| Search the raw Markdown source | Hits in link URLs, fence markers and HTML comments that the page never shows — and an ordinal in the source that disagrees with the ordinal on the page, so the jump lands wrong and reports right. §5.4 searches what opens. |
| Put a DOM in main (`jsdom`, `linkedom`) to extract the text | Spec 01 §3.2 names neither, and §5.4's stripper is exact on every page REX wrote itself. Where it is not — an author's HTML — §5.5 lands on a match and shows the rest. |
| A persistent index in SQLite | The database is about comments (spec 25 §6.1), and one reviewer's workspace searches in the time a grep takes once the text is cached. |
| Search the comments in the same panel | §6 point 5. One panel, one kind of thing. |
| Replace | REX does not edit document content by hand, in any format — `docs/FORMATS.md` §1 rule 3. The agent changes text; the reviewer approves it. |
| `⌘G` / `F3` for next | `↵` in the bar is next, the bar is where the hands are, and a second key for the same act is a second thing to learn. |
| Put the Search view in the comments sidebar as a third tab | A search is about the workspace's files, and the files live in the left column — where VS Code puts it too. The right column is about comments and the selection, and is hidden behind the graph; the tree is not. |
| Close the bar when another document opens | It stays, with its query, so the count answers for the new page. §4.1. |
| Paint every match with the anchor's own hover violet | Violet means "the comment being pointed at" (spec 15 §8.4). A find is not about a comment, and a colour that means two things means neither. §4.4. |
| Scroll to the current match on every keystroke | VS Code reveals it only when it is off screen, and the reviewer's own words were "scroll through the document and quickly see" — the page is theirs to scroll. §4.1. |

---

## 9. Where the build departed from version 1.1

### 9.1 The paint is remembered by the hook, not the surface

§5.2 gave `FrameSurface` the ranges and the sweep the job of running the find
again, and the build keeps both. What moved is the memory of *which query is on
which surface*: it lives in `useFind` (`find.ts`), as one ref holding the
surface and the query it was painted with. The reason is the second paint that
§5.5 would otherwise have caused — clicking a hit closes the bar, which changes
the page's query, which repaints, which recomputes `nearest` and moves the
current match off the hit that was just landed on. With the memory in the hook,
a paint that would repeat the same query on the same surface is skipped, and
only the sweep's `keep` mode — which knows the index was rebuilt — is allowed
through.

### 9.2 `find` answers `nearest`, and `findShow` takes `reveal`

§5.2's three methods became five. `find` returns the index of the first match
at or below the top of the viewport beside the count and the marks, because
only the surface can measure it and §4.1 needs it on every keystroke;
`findShow(ordinal, reveal)` takes whether it may scroll, because the sweep must
never scroll and typing must; and `findContext` and `selectedText` exist so the
jump (§5.5) and the seed (§4.1) can ask the page rather than reach into it.

### 9.3 The ruler measures against the root's rect, not `scrollHeight`

Under CSS `zoom` on the frame's root, `getBoundingClientRect()` and `scrollY`
report the scaled geometry consistently (spec 03's `applyZoom` note), and
`scrollHeight` was not trusted to. The document's height is therefore
`documentElement.getBoundingClientRect().height`, in the same space the range
rects come back in. §7.1 steps 5 and the zoom that followed it confirmed the
marks land where the matches are, at 1× and at 1.1×.

### 9.4 A hit row shows 28 characters before the match, not 48

`contextOf` still keeps 48 either side, because the jump compares contexts and
the comparison wants words. But a 272px row that starts with 48 characters
ends before the match is drawn, so the row trims the words before to 28 and
puts the ellipsis on. The words after are cut by the row's own ellipsis, where
cutting costs nothing.

### 9.5 The explorer's head became the Files view's first row

§4.2 put the tabs "in a row above what is there now", and the build did that
by wrapping the head and the tree in one scrolling column under the tabs.
`.rex-explorer` stopped scrolling itself, so the tabs stay put while the tree
scrolls under them, and the head's `position: sticky` keeps working inside the
new column.

### 9.6 How it was tested

The reviewer's own REX held port 9334, so it was neither driven nor disturbed.
The run used a second instance — `npm run build`, then
`PW_CDP_PORT=9444 REX_CDP_PORT=9444 REX_DB_PATH=… playwright-launch.sh npx
electron . <ws>` — on a scratch workspace of eight files: four of this
repository's specs, a hand-written HTML page with a `<style>` block and a
`<script>`, a 27-slide `.pptx`, a `.docx`, and a one-page PDF written by the
test itself. Driven with `playwright-core` over CDP; keys dispatched on the
overlay's document, as the frame's forwarder does. 54 checks, all passed; the
55th was the driver expecting six `anchor`s in the HTML page where there are
five on the page and a sixth in a class name and a script, which the find
correctly does not see.

| Check | Result |
|:--|:--|
| `⌘F` on `01-initial.md`, scrolled to 3000px, `anchor` | `7 of 81`; 80 + 1 ranges painted; `innerText` grep 81; the current match was the 7th, which is the first whose bottom was at or below the viewport's top; the page did not scroll |
| The ruler | 81 marks, one of them current; clicking the lowest went to `81 of 81`, on screen |
| `↵` ×3, `⇧↵` | `9 of 81` |
| `esc` | no `rex-find` or `rex-find-current` in the registry; no ruler; the strip in the corner |
| `⌘F` dispatched inside the frame | the bar opened, the field held `anchor` |
| `W`, then `⌘=` | the count stayed 81, every mark's `top` changed, 81 ranges still painted after each |
| A selection on `renderer`, then `⌘F` | the field read `renderer` |
| HTML, PDF, DOCX, PPTX | `1 of 5`, `1 of 1`, `1 of 1000+` (1000 marks), `1 of 968`; `↵` walked each |
| `⌘⇧F`, `anchor`, `↵` | the `Search` tab on with `6`; `112 matches in 6 files`; files in tree order, `hello.pdf` and `index.html` among them |
| A hit row for a closed file | `01-initial.md` opened with 81 painted and 1 current, 81 marks, no bar, the landed match on screen and reading the row's words |
| `⌘F` after that, then `esc` | the field held `anchor`, `2 of 81`; the paint stayed |
| `↓` `↓` `↵` in the list, `←` | focus moved file → hit → hit; `↵` landed; `←` folded the file |
| Another file from the tree | `18-colours.md` painted on arrival, marks drawn, `scrollY` 0 |
| `workspaceExclude` on `18-colours.md`, `↵` | five files, `18-colours.md` gone |
| The field cleared | no rows, the tab dim, no yellow on the page, no ruler |
| `zzzzqqqq` | `no matches` |
| The workspace, before and after | the same MD5 over every file |
| The isolated instance's log | no errors |
| `nvim-tools --json --all` | 26 findings, the baseline's 26, `tsc` ok |

Not run: §7.1's `Original` pane case, which needs a working copy and therefore
a paid ACT run. It is built — `readPane` in `App.tsx`, the `corner` and `ruler`
slots on `OriginalPane` — and has not been seen on a screen.
