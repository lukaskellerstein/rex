# Composing a screen

## Start with a Shell

The palette is scoped to `.rex-shell`. A component used outside one finds no `--fg`, no `--sans` and no wash, and renders as unstyled browser default. Wrap everything.

In REX itself the Shell is a shadow root, because the document under review must not be able to style REX's controls and REX's CSS must not change how the document looks.

## The three columns

REX at 1440×900 is: explorer 272px, document, comments 384px. Both side columns are splittered.

| Column | Surface | Holds |
|---|---|---|
| Explorer | `Panel tone="panel"` | The workspace tree. |
| Document | the paper — `--paper`, not the chrome | The document, plus a 32px gutter. |
| Comments | `Panel tone="panel"` | The selection panel, then the comment list. |

## What goes where, and why

- **The comment list is the workspace's, not the open document's.** Every row names its documents, always. A comment about two files is one row seen from either of them, and a row can have no gutter marker at all — its places are somewhere else. That is what `PlaceRow` and `TextButton`'s `go to ›` are for.
- **A control that switches what a pane shows is a `Segmented`.** `Document | Graph | Facts` and `Selection | Comments` are the same kind of choice, so they wear the same control.
- **A mode control belongs where the mode acts.** `pick element` sits at the foot of the paper, in the strip that becomes the path bar — not in the top bar among facts about the document.
- **A sheet, not a pane, for anything that belongs to one comment.** A trace belongs to a single comment, so a `Trace` button in the workspace switch would come and go. It gets a sheet over the document pane instead. Apply's review bar settles the same question the same way.
- **A bar, not a dialog, over a document being reviewed.** A modal answers "what does this patch say" while hiding the thing it says it about.

## Widths that are not negotiable

- **384px is the comments column.** It cannot hold a bash line, a path or a diff without wrapping it into mush. Anything wide goes in a sheet over the document.
- **620px at 15/1.68 is the document measure** — and it applies only to Markdown REX renders itself. Sanitised author HTML and webview URLs keep their own styles. The design must survive a document looking like anything at all.
