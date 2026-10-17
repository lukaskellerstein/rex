# REX 59 — running the page

**Version:** 1.0 · 2026-10-17
**Status:** **built, milestones 0–1.** §7 was checked on 2026-10-17 in an agent
REX built from this tree, against the MAMI review and a hostile page (§6).
Not checked live: §7 criterion 3 for a working copy, which is the
`doc.working === null` test in `DocumentView.tsx`.
**Amends:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §5.4 and
[`03-rich-rendering/SPEC.md`](../03-rich-rendering/SPEC.md) §4.1 — §2 lists
both rows.
**Depends on:** spec 01 §5.4 (the sandboxed iframe), spec 03 §6 (the
`rex-doc://` scheme and the renderer's CSP), spec 27 §4.1 (the corner the
switch sits in).

---

## 1. Why

A local HTML file can carry its own script, and some of what a reviewer is
asked to read only exists while that script runs. The reviewer's words,
2026-10-17, about `agentic-SDLC/docs/mami-review/index.html`:

> In Section 1.2, "How Arun Works," there is a graph. The graph has buttons:
> Back, Next, and Play. … When I click on them nothing happens inside the Rex.

That figure is seventeen steps of one run. The figure, its buttons and its
caption are in the HTML; the seventeen sentences are strings in an inline
`<script>` at the end of the file. REX strips that script twice — DOMPurify
removes it, and the iframe is `sandbox="allow-same-origin"` with no
`allow-scripts` — so the buttons are inert and the steps are never on screen.

Spec 03 §4.1 calls the review frame's sandbox "not negotiable", and this spec
keeps it. `allow-scripts` together with `allow-same-origin` lets the document's
script reach the overlay that hosts it, which is REX itself. And the review
frame **needs** `allow-same-origin`: the resolver, the highlights, the pick
layer, Mermaid and PDF.js all reach into it from outside.

So the page is run somewhere else: a second frame, for looking, beside the one
for commenting.

## 2. Changes to earlier specs

| Spec | Section | Was | Now |
|:--|:--|:--|:--|
| 01 | §5.4 | No script from a local HTML file ever runs | Still true in the review frame. A **Live** frame, opened only by the reviewer, runs the file's own script in an opaque origin (§3) |
| 03 | §4.1 | "No script runs inside the iframe" | Unchanged for the review frame. The Live frame is a different frame with a different sandbox, and nothing REX draws ever enters it |

## 3. The Live frame

### 3.1 What it is

A second iframe in the document pane, drawn over the review frame while the
reviewer has Live on:

```html
<iframe sandbox="allow-scripts" src="rex-doc://doc/…/index.html">
```

| Decision | Choice | Why |
|:--|:--|:--|
| Sandbox | `allow-scripts` and nothing else | No `allow-same-origin`, so the page gets an **opaque origin**: it cannot read the parent, the overlay, `localStorage` or cookies. No `allow-popups`, `allow-top-navigation`, `allow-forms` or `allow-modals` |
| What it loads | the file on disk, by URL, over `rex-doc://` | Not `srcdoc`: a `srcdoc` frame inherits the renderer's CSP, which has no `script-src` for it. A URL load takes its policy from its own response (§3.2) |
| Which files | `.html` and `.htm`, with no pending working copy | A Markdown page is REX's own HTML, and has no script to run. A working copy lives under `~/.rex/`, and Live of the file on disk would show the version the reviewer is not reading |
| Comments | none while Live is on | The overlay cannot see into an opaque-origin frame, so there is nothing to anchor against. Every mark, the pick and pen layers and the mode strip are put away |
| The review frame | stays loaded underneath | Turning Live off returns to the same scroll position, the same resolved anchors and the same selection. Nothing reloads |
| Opening another document | turns Live off | Live is a look at one file, not a mode the app is in |
| Where it opens | at the last element with an id at or above the top of the review frame, as a URL fragment | The Live frame is cross-origin, so nothing can scroll it from outside. Without this, Live on the MAMI review opened at the top, 3 000 px above the figure. An element that draws nothing — an SVG `<title>` — reports a zero box and is skipped, or it wins every time |

### 3.2 The policy the page runs under

Every `.html` or `.htm` response from `rex-doc://` carries this header. Only
the Live frame loads HTML by URL — the review frame is a `srcdoc` and its links
never navigate (spec 53) — so the header governs nothing else.

```text
default-src 'none';
script-src 'unsafe-inline' 'unsafe-eval' rex-doc: https:;
style-src 'unsafe-inline' rex-doc: https:;
img-src rex-doc: data: blob: https:;
font-src rex-doc: data: https:;
media-src rex-doc: blob:;
connect-src 'none'; frame-src 'none'; form-action 'none'
```

| Directive | Why this value |
|:--|:--|
| `script-src … https:` | The point of the spec. A figure built on a library from a CDN is as common as one written inline. The sandbox, not this list, is what keeps the script away from REX |
| `style-src`, `font-src https:` | Web fonts. The MAMI review loads three families from Google Fonts |
| `img-src https:` | The same privacy trade spec 03 §6 already makes for the review frame |
| `connect-src 'none'` | A page that `fetch`es is a page that can report what it holds. Nothing a figure needs |
| `frame-src 'none'`, `form-action 'none'` | No page inside the page, and nothing posted anywhere |

The renderer's own `frame-src 'self' rex-doc:` still applies to the Live frame,
so a script that navigates it to an `https://` URL is refused.

**`.js` stays `text/plain`, and that was never a guard.** Measured with the
hostile page: Chromium runs a `<script src>` served as `text/plain`, because
nothing sends `nosniff`. The review frame runs no script because of its
sandbox, not because of this type, and `docHeaders.ts` now says so.

### 3.3 What the sandbox was measured to stop

A hostile page in the Live frame, 2026-10-17:

| The page tried | Result |
|:--|:--|
| `window.parent.document`, `window.top.document`, `window.parent.rex` | `SecurityError` |
| `localStorage`, `document.cookie` | `SecurityError` |
| `window.origin` | `"null"` — opaque |
| `window.open("https://…")` | `null`; no window, and nothing reached `setWindowOpenHandler` |
| `alert()` | nothing shown |
| `fetch` of its own file, and of an `https://` URL | `TypeError` — `connect-src 'none'` |
| `location.href = "https://…"` | refused; the frame shows Chromium's error page |
| an inline `<script>` and a `<script src>` beside it | both ran |

## 4. The switch

A `live` button in the pane's corner — the row spec 27 §4.1 put the paper
switches in — on every document §3.1 allows. On, it reads `live` in the
solid on-state and the pane shows the Live frame. Off, the review frame is
back exactly as it was.

No key. A key pressed inside the Live frame never reaches REX — the frame is
cross-origin, so `forwardKeysToParent` cannot be attached to it — and a key
that works only while the pointer is elsewhere is a key that seems broken.

## 5. Non-goals

| Not building | Why |
|:--|:--|
| Script in the review frame | Needs `allow-same-origin` dropped, which takes the resolver, the highlights and the pick layer with it |
| Comments on the Live page | Nothing can be anchored in an opaque-origin frame. A sentence that exists only in a script is a reason to put it in the HTML |
| Live for a working copy | §3.1 |
| Find, zoom and the paper switches in Live | All three reach into the frame from outside |

## 6. Milestones

0. **The policy.** `.html` and `.htm` responses carry §3.2's header.
   `npm run test:live` asserts the header and that no other type carries it.
1. **The switch and the frame.** §3.1 and §4, checked by hand on the MAMI
   review: Back, Next and Play step the figure. And checked against a hostile
   page: its script cannot read `window.parent.document`, `localStorage`, or
   `fetch` a file, and `window.open` and an `https://` navigation do nothing.

## 7. Acceptance criteria

1. On `mami-review/index.html`, `live` is drawn; Next shows step 1 of 17 and
   Play advances it.
2. Live off returns the review frame at the same scroll position, with the
   comment bars where they were.
3. A Markdown file, a PDF and a document with a pending working copy draw no
   `live` button.
4. In Live, a page's script that tries to reach REX gets a `SecurityError`, and
   its `fetch` is refused by the policy.
