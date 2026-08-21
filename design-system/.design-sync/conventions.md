# @rex/design-system

The design system REX is drawn in.

REX is a desktop app for commenting on documents and discussing each comment
with an AI agent: select text, write a comment, **Ask**, and one agent answers
that one comment. Every value here was lifted out of the running app —
`src/renderer/overlay/overlay.css` for the chrome, `src/shared/tokens.ts` for
the paper — with nothing rounded and nothing invented.

## Before you build with it

**Wrap everything in a `Shell`.** The palette is declared on `.rex-shell` and
nowhere else, so a component used outside one renders as unstyled browser
default. In REX itself that Shell is a shadow root: the document under review
must not be able to style REX's controls, and REX's CSS must not change how the
document looks.

Import the stylesheet once at the root:

```tsx
import '@rex/design-system/styles.css';
```

## The four rules

1. **Colour means state.** Steel resolved, amber moved, red lost, green
   resolved-and-finished. Red is spent on exactly two things — a lost anchor and
   the write-capable agent — so it never stops meaning "look at this". Violet is
   the one exception and it outranks state: it marks the comment you have open.
2. **Selection is a change of intensity, never a second mark.** A card deepens
   its own wash and brightens its own border. It never changes hue.
3. **The answer outranks the machinery.** The agent's reply is body text at full
   contrast; the tool calls fold into one row; the trace leaves the sidebar
   entirely.
4. **A quote never speaks in REX's voice.** Newsreader appears in exactly one
   place — text taken out of the document — and nowhere else.

Nothing rests on hue alone. Every state is written in a word beside the colour
that carries it.

## Two dark surfaces and one light one

REX's chrome is dark. The document is light, and it is not REX's — it is written
by the Markdown renderer and may equally be sanitised author HTML or a live URL.
Components that touch the paper (`GutterMarker`, and the pathbar) carry literal
greys rather than tokens for exactly this reason: they must read against a
document, and a document is light whatever the chrome is doing.

The paper tokens (`--paper`, `--paper-ink`, `--hl-*`) are here so the
highlights painted on a document can never drift out of contrast with the page
they sit on.

## Groups

| Group | What it holds |
|---|---|
| Foundations | `Shell`, `Panel`, `Swatch` — the surface and the palette. |
| Type | `Label`, `Meta`, `Quote` — the three registers REX writes in. |
| Controls | `Button`, `TextButton`, `Segmented`, `Chip`, `ScopeChip`, `NoteInput`, `StrengthMeter`. |
| Anchor | `StatePill`, `Token`, `GutterMarker`, `PlaceRow`, `AnchorKind` — how REX points at a passage. |
| Thread | `ThreadCard`, `AnchorCard`, `Answer`, `ToolSteps`, `OrphanTray`, `ReviewBar` — a comment and its conversation. |

The longer guidance is in `guidelines/`: the four rules in full, how the columns
compose, and how this design shows absence without lying about it.
