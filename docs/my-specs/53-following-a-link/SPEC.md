# REX 53 — following a link, and getting back

**Version:** 1.2 · 2026-09-10
**Status:** **built, and driven in a live window.** Milestones 53.0 to 53.5 are
in the tree. §1.2 was measured before the change and §8 after it, both on
2026-09-10 in an isolated REX on port 9444. §10 records what the build changed
from version 1.0 and what each run measured.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §5.4 (sanitising a
document before it fills the frame), §6.3 (the normalised text index), §7 (the
shadow root), §10 (the IPC surface);
[`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md) §5.1 (link
extraction), §5.2 (resolving one link), §7 (a workspace);
[`03-rich-rendering/SPEC.md`](../03-rich-rendering/SPEC.md) §5.3
(`data-src-line`), §5.5 (GitHub's heading slug), §11 milestone 11 item 4 (the
acceptance criterion this spec widens);
[`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md) §6.1 (two panes);
[`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md) §4.2 (the
original pane is a surface too);
[`26-widening-a-place/SPEC.md`](../26-widening-a-place/SPEC.md) §5.4 (keys
forwarded out of the frame);
[`28-find-and-search/SPEC.md`](../28-find-and-search/SPEC.md) §5.3 (the one
chord that is forwarded), §5.5 (a jump that waits for the document to open).

> [!important]
> **The frame must never navigate.**
>
> Every rule in this spec follows from one fact: the document lives in a
> `srcdoc` iframe, and a navigation inside it destroys the page REX drew, the
> anchors resolved against it, and the surface every gesture goes through.
> There is nothing to recover it with, because REX never asked for the
> navigation and does not know it happened.
>
> So a click on a link is **always** answered by REX, and the `<a>` is
> **always** stopped. What REX then does depends on where the link points.

> [!note]
> **Version 1.2 — say where a link goes before it is clicked.** Asked for the
> same day 1.1 was built: *"I would like to also see a tooltip with the full
> path to the file, including a section where it should link to, when I hover
> over the link."* That is §4.7 and milestone 53.5, and it is one addition to a
> feature rather than a new one: the answer comes from the same
> `resolveForClick` a click already asks, so the tip and the click can never
> disagree about where a link goes. Nothing in 1.1 changed.

> [!note]
> **Two words, on purpose.** A *fragment* is a place inside a document —
> `#persistent-state`. A *place* is where the reviewer was: a document, a source
> line and a scroll offset. Back restores a place. A link lands on a fragment.

---

## 1. Why

### 1.1 The reviewer's words, 2026-09-10

> In the file git integration.md, when I open it in Rex and I want to click on
> some links […] it is doing nothing. […] some links work, for example, the
> repository fixture link works.

And, on what following a link has to come with:

> 1. I am reading a file.
> 2. I am seeing a link.
> 3. I am clicking on the link.
> 4. I am getting redirected to another file.
> 5. I am reading a little bit of the file.
> 6. Now I want to get back to the original file.
>
> I need to either have some button to go back or have some shortcut that will
> get me back to the file that I came from and ideally to the same row where I
> was. Again not only the file but also the row. […] I should be able to open a
> file on some specific row that will be in the middle of the screen.

### 1.2 What REX does today, measured

Three clicks in a running REX on an isolated instance, in a Markdown document
inside a reviewed repository:

| The link | `href` in the file | What happened |
|:--|:--|:--|
| a place in the same file | `#repository-fixture` | the page scrolled, 234 → 19271. Correct |
| a place in another file | `components.md#authentication-and-credential-isolation` | REX served the file `200 application/octet-stream`, Chromium read that as a download, the sandbox has no `allow-downloads`, `net::ERR_ABORTED`. Scroll unchanged at 1976 |
| a place in a file one level up | `../architecture.md#persistent-state` | the same, scroll unchanged at 2057 |

And a fourth, in `documentation-sample/one/sample-document.md`:

| The link | `href` | What happened |
|:--|:--|:--|
| an external site | `https://example.com/ci` | `Framing 'https://example.com/' violates … "frame-src 'self' rex-doc:"`. The frame navigated to `chrome-error://chromewebdata/` and the **document pane went blank**, while the top bar went on naming the file |

The last row is the serious one. A cross-file link does nothing, which is only
useless. An external link **destroys the open document** and leaves REX looking
as if it failed to render a file it had already rendered.

### 1.3 The cause, in one line

`frame.ts`'s click listener answers a link only when its `href` starts with
`#`:

```ts
if (!href?.startsWith("#") || href.length < 2) return;
```

Every other link is left to the browser. Spec 03 §11 milestone 11 item 4 asked
only that *"all nine table-of-contents links jump to their heading"*, and that
is exactly what was built. Cross-file links were never specified, so nothing
decided what should happen and the default happened instead.

### 1.4 What REX already has

Almost all of it. This spec is mostly wiring.

| Already built | Where | What it gives |
|:--|:--|:--|
| resolving one `href` against the file it is in | `src/main/workspace/links.ts`, `resolveTarget()` | a path, a fragment, and whether the target exists. Directories already resolve to their `index.md` / `README.md` |
| opening a document by path | `COMMAND.docOpen`, `App.tsx`'s `openDocument` | the whole pane, the threads, the sweep |
| GitHub's heading slug | `src/main/render/markdown.ts` (`markdown-it-anchor`, `githubSlug`) | `#authentication-and-credential-isolation` is already an id in the rendered page |
| the source line of a block | `data-src-line` (spec 03 §5.3) | what "the same row" can mean, for Markdown |
| a jump that waits for the surface | `onSurfaceReady`, two of them already | how to scroll a document that is still opening |
| the one-third scroll | `scrollToAnchorIn` | REX's existing rule for bringing a place into view |

---

## 2. The rule

**A click on a link in a document is REX's, never the browser's.** The `<a>` is
stopped, and one of five things happens:

| The link points at | REX does |
|:--|:--|
| a place in this document | scrolls to it, as it does today |
| a document REX can open | opens it, and scrolls to the fragment if there is one |
| a place REX has been before | the same, and the place it left is pushed onto the back stack |
| an `http`, `https` or `mailto` URL | hands it to the system browser or mail client. The frame does not move |
| anything else — a missing file, a file REX cannot render, an unknown scheme | says so in the notice bar. The frame does not move |

And **the reviewer can always get back**, to the file *and* the row, with a
button and with a key.

---

## 3. Changes to specs 01, 02, 03, 16 and 26

| Spec | Section | What changes |
|:--|:--|:--|
| 01 | §5.4 | The sanitised page keeps its `<a href>` exactly as before. What changes is that **no link reaches the browser**: the frame's own click listener answers every one of them. `<base href>` still exists for images and stylesheets |
| 02 | §5.2 | `resolveTarget()` gains a second caller. It was the reference graph's alone; it is now also what a click asks. Its answer is unchanged, and `test/links.spec.ts` still pins it |
| 03 | §11, milestone 11 item 4 | Widened. "All nine table-of-contents links jump to their heading" becomes §8's list, which adds the cross-file cases and the external one |
| 16 | §4.2 | The original pane gets the same handler. A link followed there opens the document in the **current** pane, because the original pane shows one file's past and a second file has no past to show beside it |
| 26 | §5.4 | The forwarded-key set grows from `⌘F` alone to `⌘F`, `⌘[` and `⌘]`. Same mechanism, same reason: after a click the focus is inside the frame, and a binding registered on the overlay's document never sees it |

Nothing in this spec touches invariant I1, I2 or I3. The resolver stays in the
renderer, the filesystem stays in main, and no port is opened.

---

## 4. What the reviewer does

### 4.1 A place in the same document — unchanged

`#repository-fixture` scrolls the page. This already works and is not touched,
except that the code that does it moves into the new handler.

### 4.2 A document, and a place in it

Clicking `components.md#authentication-and-credential-isolation`:

1. The pane opens `components.md`, exactly as the explorer would open it.
2. When the new page's surface is ready, REX scrolls to the element whose id is
   `authentication-and-credential-isolation`.
3. The top bar's path changes to the new file, and its **Back** button becomes
   live.

A link with no fragment opens the document at the top.

A fragment that names no element in the new document opens the document at the
top and says so once in the notice bar: `No "#persistent-state" in
architecture.md.` The document still opens — the reviewer asked for the file,
and the file is what REX has.

### 4.3 Back, and forward

**Back** returns to the document the reviewer left, **and to the row they left
from**. The row is the block the link they clicked was in, not the top of the
screen, so the reviewer comes back looking at the sentence that sent them away.

| Gesture | Does |
|:--|:--|
| `⌘[` | back |
| `⌘]` | forward |
| the ◂ button in the top bar | back |
| the ▸ button in the top bar | forward |

`⌘[` and `⌘]` are what macOS already means by back and forward, in Safari and
in Finder. They also pair with the bare `[` and `]` that REX already uses for
the two side panels, so the left key means left in both.

Both buttons sit between the workspace toggle and the path, which is where a
browser puts them. A button with nothing to go back to is disabled and dimmed,
never hidden — a control that appears and disappears is a control nobody learns
the position of.

### 4.4 What "the same row" means

A history entry remembers three things about a place:

| Remembered | Used when |
|:--|:--|
| the source line, from `data-src-line` | always, when the document has lines. It survives a re-render, a width change and a zoom change |
| the scroll offset in CSS pixels | when the document has no lines — a DOCX through mammoth, an HTML file, a PDF |
| the zoom that offset was read at | to scale the offset if the zoom moved in between |

The line is preferred because it is the only one of the three that is still
true after the file changes. The offset is the honest fallback for the formats
that carry no line information at all, and spec 02 §5.2 already records that
those same formats yield no links to click.

A restored place is scrolled to **one third of the way down the pane**, which
is what `scrollToAnchorIn` already does for every other jump in REX. The
reviewer asked for "the middle of the screen" and this is the same intent — a
row pinned to the top edge reads as if its context has been cut off. Two
conventions would read as a bug, so there is one, and it is a single constant.

### 4.5 A link REX will not follow

Nothing navigates. The notice bar says why, in one sentence naming the file:

| Case | The notice |
|:--|:--|
| the file is not there | `No such file: CONTRIBUTING.md` |
| the file is there, REX cannot render it | `REX cannot open build.gradle.` |
| the scheme is not one REX hands on | `REX does not open ftp: links.` |

`documentation-sample/one/sample-document.md` links to `./CONTRIBUTING.md` and
`./LICENSE`, and neither file exists. That is deliberate, it is the fixture for
the first row, and it is why the graph already draws broken links.

### 4.6 An external link

`https://…` and `http://…` open in the system browser. `mailto:` opens the mail
client. Everything else in a URL scheme is refused by name.

The allow-list is in **main**, not in the renderer. A document is untrusted
content (invariant I2), `shell.openExternal` hands a string to the operating
system, and a custom scheme is a way to start a program. Main re-checks the
scheme even though the renderer already asked about it, because the renderer's
check is a convenience and main's is the guard.

### 4.7 Where does this link go? — the hover tip

Resting the pointer on a link for a third of a second draws a small panel
beside it, saying where the click would land. Up to three lines:

| Line | What it says |
|:--|:--|
| the destination | the **full path**, with home written `~`. Or the URL, for an external link. Or `This document`, for a place in this same file |
| the section | the fragment, exactly as the author wrote it — `#authentication-and-credential-isolation` |
| the refusal | why the click will not work. Only when it will not |

The third line is what makes this more than a convenience. A broken link looks
exactly like a working one until it is clicked, and this is the only place REX
can say so beforehand: `No such file: CONTRIBUTING.md` under the path it would
have opened.

**REX draws it, not the operating system.** A `title` attribute is the only
tooltip the document could carry itself, and it fails three ways: it belongs to
the OS rather than to REX, it arrives after about a second, and it cannot show a
path, a section and a refusal as three separate things. Writing one into the page
would also mean REX editing the document under review, which spec 01 §6.7
refuses for a `<mark>` and refuses here for the same reason.

**It comes from the same answer the click does.** `resolveForClick` is asked, and
its reply is cached for the life of the document. So the tip and the click can
never disagree about where a link goes, and a table of contents with twenty
links to five files costs five questions rather than twenty.

Three rules it keeps:

1. **It takes no pointer events.** A tip that could be hovered would sit between
   the reviewer and the link they are reaching for, and moving onto it would
   count as leaving the link — so it would flicker.
2. **It flips above the link near the foot of the pane**, so a link on the last
   line is not explained off the bottom of the screen.
3. **It does not appear during a pick or a drawing.** Both layers swallow the
   pointer while they are on, which is the right answer and costs no code.

The delay is 300ms. A line of prose with three links in it must not flash three
tips as the pointer crosses it, and an answer that waits much longer stops
feeling like part of the hover.

---

## 5. Where the code goes

### 5.1 The files

| File | New? | What it holds |
|:--|:--|:--|
| `src/renderer/overlay/history.ts` | new | the back and forward stacks, as a pure reducer. No DOM, so `node --test` loads it |
| `src/renderer/overlay/LinkTip.tsx` | new | §4.7's panel. Position and three lines, and nothing else — it makes no decision |
| `src/renderer/overlay/frame.ts` | changed | `jumpToFragmentsInsteadOfNavigating` becomes `answerLinkClicks`, which stops every link and calls back |
| `src/renderer/overlay/anchoring.ts` | changed | three methods on `DocumentSurface` and on `FrameSurface` |
| `src/renderer/overlay/App.tsx` | changed | the history state, the two commands, the two keys, the arrival-when-ready ref |
| `src/renderer/overlay/TopBar.tsx` | changed | the two buttons |
| `src/renderer/overlay/DocumentView.tsx`, `OriginalPane.tsx` | changed | pass the link callbacks into the frame |
| `src/main/links.ts` | new | `resolveForClick()` and the external-scheme allow-list |
| `src/main/ipc.ts` | changed | two handlers |
| `src/shared/channels.ts` | changed | two commands, and their types |
| `src/shared/types.ts` | changed | `DocumentPlace`, `LinkResolution` |
| `src/preload/index.ts` | changed | two lines |
| `test/history.spec.ts` | new | the reducer |
| `test/linkClick.spec.ts` | new | `resolveForClick()` and the scheme allow-list |

### 5.2 The handler inside the frame

An event inside an iframe never reaches the parent, so this stays where it is
(spec 01 §5.4 step 2, spec 26 §5.4). What changes is that it never returns
early.

```ts
export interface LinkActions {
  /** A place in this document. False when no element carries the id. */
  fragment(id: string): boolean;
  /** Anything else. `line` is the source line of the block the link sits in. */
  follow(href: string, line: number | null): void;
}

export function answerLinkClicks(inner: Document, actions: LinkActions): void;
```

Three details that are easy to get wrong and are already known:

1. **`event.target` is not `instanceof Element`.** The target belongs to the
   iframe's realm and `Element` in the overlay is a different constructor. The
   existing code notes this; the new code keeps the duck-typed `closest` check.
2. **`preventDefault()` runs for every link**, before anything is resolved,
   including one whose target turns out not to exist. Resolution is
   asynchronous and the browser will not wait for it.
3. **The line comes from the link, not the viewport.** `link.closest("[data-src-line]")`,
   parsed, or null. That is what makes Back land on the sentence the reviewer
   was reading.

### 5.3 The two commands

```ts
linkResolve: "link:resolve",
linkExternal: "link:external",
```

```ts
/** What a clicked `href` turned out to be. */
export type LinkResolution =
  | { kind: "self"; fragment: string | null }
  | { kind: "document"; path: string; fragment: string | null }
  | { kind: "external"; url: string }
  | { kind: "refused"; reason: string };

linkResolve(from: string, href: string): Promise<LinkResolution>;
/** Hands `url` to the system. Main re-checks the scheme. */
linkExternal(url: string): Promise<void>;
```

`display` is §4.7's line one: the same path with the reviewer's home folder
written `~`, which only main can produce and which nothing ever opens. A
`refused` carries it too, because the tip's most useful moment is naming the file
a broken link was pointing at.

`resolveForClick()` in `src/main/links.ts` is a thin layer over spec 02's
`resolveTarget()`. It adds exactly two judgements that the graph does not need:

- a target that exists but is not `isDocumentPath()` is `refused`, with the
  reason naming the file;
- a scheme is `external` only when it is `http:`, `https:` or `mailto:`, and
  `refused` by name otherwise.

Resolution stays in main because it reads the filesystem, and the renderer may
not (invariant I2). This is one round trip per click, on a gesture that is
about to open a file anyway.

### 5.4 The history

```ts
export interface DocumentPlace {
  path: string;
  /** `data-src-line` of the block, when the format stamps it. */
  line: number | null;
  scrollY: number;
  /** The zoom `scrollY` was read at. */
  zoom: number;
}

export interface History {
  /** Most recent last. Capped at HISTORY_DEPTH. */
  back: DocumentPlace[];
  forward: DocumentPlace[];
}

export const HISTORY_DEPTH = 50;

export function pushPlace(history: History, leaving: DocumentPlace): History;
export function goBack(history: History, here: DocumentPlace): { history: History; to: DocumentPlace } | null;
export function goForward(history: History, here: DocumentPlace): { history: History; to: DocumentPlace } | null;
```

The rules, and each one's reason:

1. **Every change of document pushes the one being left**, not only a link
   click. Opening a file from the explorer is a navigation too, and a Back that
   works after a link but not after a click in the tree is a Back nobody
   trusts.
2. **A link click records the link's own line.** Any other departure records
   the top visible line and the current offset, because there is no clicked
   element to ask.
3. **Pushing truncates `forward`.** Standard, and the only alternative is a
   tree nobody asked for.
4. **`goBack` takes the place it is leaving** and puts it on `forward`, so the
   pair is symmetric and the reviewer can walk back and forth over the same two
   files.
5. **The stack is this session's.** It is renderer state, it is not written to
   SQLite, and closing REX forgets it. §6 says why.

### 5.5 Three methods on the surface

```ts
/** §4.2 — a `#fragment` in this document. False when nothing carries the id. */
scrollToFragment(id: string): boolean;
/** §4.4 — put the reviewer back where they were. */
scrollToPlace(place: DocumentPlace): void;
/** §5.4 rule 2 — where the reviewer is now, for the stack. */
placeHere(): DocumentPlace;
```

`scrollToFragment` decodes the id before looking it up, exactly as the current
listener does: a heading slug can be percent-encoded in the `href` and is not
in the DOM.

`scrollToPlace` prefers the line. It looks for `[data-src-line="N"]`, and when
that exact line is not a block start it takes the nearest block at or above it
— `data-src-line` marks where a block begins, so a line in the middle of a
paragraph has no element of its own.

### 5.6 The arrival, which has to wait

A document that is still opening has no DOM to scroll. `onSurfaceReady` already
carries two waiting jumps for exactly this reason (a panel row, and a finding's
Open). This adds a third:

```ts
const arriveWhenReady = useRef<{ path: string; at: Arrival } | null>(null);
type Arrival = { kind: "fragment"; id: string } | { kind: "place"; place: DocumentPlace };
```

Guarded on the path, as the existing two are, so a second navigation started
before the first finished does not land the wrong jump.

### 5.7 The keys out of the frame

`forwardKeysToParent` currently forwards one `⌘` chord — `⌘F` — and lets every
other modified key alone, because `zoomFromInside` answers `⌘+` inside the
frame and a forwarded copy would zoom twice. `⌘[` and `⌘]` mean nothing inside
the frame, so the same argument that let `⌘F` through lets these through, and
the original is stopped so Chromium cannot act on it.

---

## 6. What this does not do

| Not built | Why |
|:--|:--|
| History that survives a restart | It is a reading position, not a document. Nothing is lost by forgetting it, and a stack restored against files that changed while REX was closed would put the reviewer somewhere arbitrary |
| A dropdown of the whole history | Back and forward answer the reviewer's six steps. A list is a second control for the same job |
| Trackpad swipe, and the mouse's fourth and fifth buttons | Both are real gestures and neither is asked for. The Electron `swipe` event can be added later without changing anything in §5 |
| Clickable wikilinks | `[[Target]]` is a link to the reference graph (spec 02 §5.1) and plain text in the rendered page. Making it clickable is a change to the Markdown renderer, not to this handler |
| Following a link inside a DOCX, PDF or PPTX | Spec 02 §5.2 already declines to read links out of those formats, for the reason recorded there: pattern-matching their bytes invents links. Nothing here changes that |
| Opening an image link in the lightbox | `./scaling.png` is `refused` with a reason. The lightbox is for figures in the page, and a link to a picture is a different gesture |
| A link that leaves the workspace | It is followed like any other. `docOpen` already calls `allowDirectory` for whatever it opens, so the new document's own images resolve |
| A browser-style status bar in the corner | §4.7 answers the same question beside the link instead. A review pane is not a browser window: the reviewer is reading prose in the middle of the screen, and a caption in a corner is somewhere they are not looking |
| Resolving a fragment to its heading TEXT in the tip | REX has the slug, not the words, until the other file is rendered. Showing `#second-section` is what the author wrote and is honest; rendering a file to caption a hover is not |

---

## 7. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| 53.0 | Two pure modules and their tests | `npm run test:history` and `npm run test:linkClick` pass. No UI has changed |
| 53.1 | **The frame never navigates** | Every link is stopped. External links open in the browser, refused links say why. The blank-pane failure in §1.2 cannot happen |
| 53.2 | Cross-file links open, fragments land | §4.2 works in both directions and one level up |
| 53.3 | Back and forward | Keys, buttons, and the row. §4.3 and §4.4 work |
| 53.4 | Driven in a live window | §8, in full |
| 53.5 | The hover tip | §4.7. The three lines are right for all five kinds of link, and the tip goes when the pointer does |

53.1 is deliberately before 53.2. It is the half that fixes a document being
destroyed, and it is worth having on its own even if the rest slips.

---

## 8. Acceptance

Driven in an isolated REX on port 9444, against
`~/Projects/Github/lukaskellerstein/documentation-sample` and against this
repository's own `.claude/` documents, which link to each other and one level
up. Every step observed in the window, not asserted in a test.

1. In `one/sample-document.md`, all nine table-of-contents links still jump to
   their heading. Spec 03 §11 milestone 11 item 4, unchanged.
2. In `.claude/CLAUDE.md`, clicking `rules/02-understand.md` opens that file.
   The top bar's path changes. Back becomes live.
3. `⌘[` returns to `.claude/CLAUDE.md`, scrolled so that the line holding the
   link that was clicked is a third of the way down the pane. Not the top of
   the file.
4. `⌘]` goes forward to `rules/02-understand.md` again.
5. In `rules/06-testing.md`, clicking `machine-tools.md` opens it. Clicking
   `06-testing.md` inside it comes back. Back still walks the chain in order.
6. A link with a fragment to another file — written into a scratch copy, since
   neither sample repository has one — opens the file **and** lands on the
   heading.
7. A fragment that names nothing opens the file at the top and shows one
   notice.
8. `./CONTRIBUTING.md` in `one/sample-document.md` shows `No such file:
   CONTRIBUTING.md`. The document pane is untouched.
9. `https://example.com/ci` in the same file opens the system browser. **The
   document pane still shows the document** — this is the §1.2 failure, and it
   is the single most important line in this list.
10. The same nine steps with the keyboard focus inside the document, after a
    click in the prose. §5.7.
11. Back with an empty stack does nothing, and the button is disabled rather
    than absent.
12. `nvim-tools --json --all` adds no finding against the baseline.

---

## 9. Rejected

| Rejected | Why |
|:--|:--|
| Serving `.md` as `text/markdown` so the frame can navigate to it | It would show raw Markdown and destroy the overlay. The frame navigating is the bug, not the MIME type |
| Giving the frame `allow-top-navigation` or `allow-downloads` | Both widen the sandbox around untrusted content to work around a click REX should be answering itself |
| `Alt+←` / `Alt+→` for back and forward | `⌥` is REX's hold-to-pick modifier (spec 26 §3), and the browser chord is the wrong one on macOS anyway |
| Resolving the link in the renderer | It needs `existsSync` and `statSync`. Invariant I2 puts the filesystem in main, and `resolveTarget()` is already there and already tested |
| Remembering only the scroll offset | It is wrong the moment the file changes, and a review tool exists because files change |
| Remembering only the line | Three of REX's five formats stamp no line at all, and a Back that silently does nothing on a DOCX is worse than an approximate one |
| A `webview` per document, with its own history | Spec 01 §5.4 chose `srcdoc` so the renderer can reach into the DOM. The anchor resolver depends on that and it is invariant I1 |

---

## 10. Where the build departed from version 1.0

Six changes, each forced by something the spec had not looked at.

### 10.1 `src/main/links.ts` imports no `electron`

§5.1 gave this module an `openExternalLink()` that would call
`shell.openExternal`. That one import would have made the module unloadable
under plain `node --test`, and `test/linkClick.spec.ts` is the file that proves
the scheme guard.

So the module exports `checkedExternalUrl(url)` — the guard, and nothing else —
and `ipc.ts` makes the call. `workspace/links.ts` is kept testable by the same
rule, and the guard is now *easier* to test rather than harder: the test can
try `file:`, `javascript:` and `data:` against it directly.

### 10.2 One function owns the one-third rule

§4.4 said the convention would stay one convention. It is now one *function*:
`bringIntoView(view, rect)` in `anchoring.ts`, which `scrollToAnchorIn`,
`scrollToFragment` and `scrollToPlace` all call. Before, the arithmetic was
written out inside `scrollToAnchorIn` and the two new methods would have copied
it.

### 10.3 A link to this same file is a scroll, not a reload

Not considered in §5.3. `alpha.md#the-far-section`, written inside `alpha.md`,
resolves to `{kind: "document"}` with the path it is already showing. Opening it
would reload the page — throwing away every resolved anchor — to land where a
scroll lands. `followLink` checks the path first and scrolls.

### 10.4 A bare `#`, and `<a name>`

Two small cases the spec did not name. A bare `#` is a link to the top of the
page, which the browser used to answer and nothing else here expresses, so the
handler scrolls to the top. And `scrollToFragment` falls back to
`a[name="…"]` after `getElementById`, because a hand-written HTML document can
still carry the older spelling.

### 10.5 What the live run measured

Against a scratch pair of linked Markdown files, and against
`documentation-sample`:

| Step | Measured |
|:--|:--|
| a link on **line 127** of `alpha.md` to `sub/beta.md#second-section` | beta opened, scrolled to 2395, its line 109 at the top — the heading a third down |
| `⌘[` | alpha at 2474, **line 113 at the top** — the link's own line 127, a third down. The row came back |
| `⌘]` then `⌘[` | the same two places, in order, both ways |
| a chain of three files | walked back in order, and the buttons enabled and disabled to match |
| `https://example.com/ci` | **the document pane still showed the document.** The §1.2 failure is gone |
| `sub/nowhere.md` | `No such file: nowhere.md`, pane untouched |
| `sub/diagram.png` | `REX cannot open diagram.png. REX renders Markdown, HTML, PDF, DOCX and PPTX.`, pane untouched |
| `sub/beta.md#no-such-heading` | beta opened at the top, `No "#no-such-heading" in beta.md.` |
| `../alpha.md#the-far-section`, written with spaces inside the brackets | resolved and landed |
| the eleven fragment links in `one/sample-document.md` | all eleven jump. Spec 03 §11 milestone 11 item 4 still holds |
| `./CONTRIBUTING.md` in the same file | was silent before; now says `No such file: CONTRIBUTING.md` |
| a DOCX scrolled to 1400, left, and returned to | back at **1400**. `topLine` is null there, so this is the offset fallback of §4.4, measured |
| `⌘[` dispatched **inside** the frame | reached the shell and went back. §5.7 |
| `nvim-tools --json --all` | every tool `ok`, and the same six files with findings as the baseline. Nothing added |

### 10.6 One thing left open: the notice does not clear itself

A refusal writes to the notice bar, and the bar keeps it until the reviewer
presses `dismiss`. So `No such file: CONTRIBUTING.md` was still on screen four
navigations later, during the run above.

That is REX's existing notice behaviour and not something this spec introduced —
every command that fails leaves its sentence there. It is left alone rather than
fixed here, because clearing it on a successful `doc:open` changes what the bar
means for every other feature, and that is a decision about the bar rather than
about links.

---

## 11. What version 1.2 measured

The hover tip, in the same isolated REX, against the scratch pair of linked
Markdown files and against `documentation-sample`.

| Hovered | The tip said |
|:--|:--|
| `sub/beta.md#second-section` | the full path, then `#second-section`. No refusal |
| `sub/nowhere.md` | the path it would have opened, then `No such file: nowhere.md` |
| `sub/diagram.png` | the path, then `REX cannot open diagram.png. REX renders Markdown, HTML, PDF, DOCX and PPTX.` |
| `https://example.com/ci` | the URL, and nothing else |
| `sub/beta.md#no-such-heading` | the path and the section. **No refusal**, correctly: the file is real and REX cannot know a fragment is missing until the file is open |
| `./CONTRIBUTING.md` in `one/sample-document.md` | `~/Projects/…/one/CONTRIBUTING.md`, then `No such file: CONTRIBUTING.md`. Home written `~`, as §4.7 says |
| `#license` in the same file | `This document`, then `#license` |
| the pointer leaving a link | the tip went |

Placement, measured rather than eyeballed: a link at `y=695` with `h=20` drew
its tip at `y=721`, which is six pixels below the link's own foot, at the same
`x`. A link scrolled to the last line of the pane drew `bottom: 35.89px` instead
of a `top` — §4.7 rule 2, the flip.

### 11.1 How the hover was driven, and what that does not prove

**This machine cannot deliver a real mouse event to an agent's REX window.**
The window is born on the `playwright` desktop, and a `mousemove` sent through
CDP — Playwright's and a raw `Input.dispatchMouseEvent` alike — reaches neither
the page nor the frame. Instrumented and measured on 2026-09-10: zero
`mousemove` and zero `mouseover` events arrived, at coordinates verified against
the frame's own `getBoundingClientRect()`.

So every hover above was driven by dispatching `mouseover` and `mouseout` inside
the frame, which is precisely the pair the listener hears. That proves the
listener, the resolution, the three lines, the placement and the teardown. It
does **not** prove that hardware pointer motion produces those events, which is
the browser's own contract and not REX's.

This is the same limit `01-project-config.md` already records under *"still
unproven"* for the packaged app: the document frame is sandboxed with scripting
off, and the last step needs real mouse input.
