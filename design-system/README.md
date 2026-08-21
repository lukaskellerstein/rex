# @rex/design-system

REX's design system as a real React package, so it can live in Claude Design.

**Project**: <https://claude.ai/design/p/9298aa4b-fdd2-4a00-bbbd-026c262c9f22>

## Why this exists

REX's own components (`src/renderer/overlay/*.tsx`) are app screens wired to
`window.rex` IPC. They cannot be pushed to a design system, and they should not
be — a design system is the vocabulary, not the app.

So the vocabulary was lifted out into 24 components. **Every value is copied,
none invented**: the chrome half from `src/renderer/overlay/overlay.css` (46
tokens), the paper half from `src/shared/tokens.ts`.

## Layout

```text
design-system/
├── src/
│   ├── index.ts            the public surface
│   ├── components/         24 components
│   ├── internal/           cx(), the AnchorState vocabulary
│   └── styles/             tokens, base, fonts, and one CSS file per group
├── docs/                   one .md per component — becomes its .prompt.md
│   └── guides/             the four rules, composing a screen, showing absence
└── .design-sync/           config, notes, and one authored preview per component
```

## The groups

| Group | Components |
|:--|:--|
| Foundations | `Shell` `Panel` `Swatch` |
| Type | `Label` `Meta` `Quote` |
| Controls | `Button` `TextButton` `Segmented` `Chip` `ScopeChip` `NoteInput` `StrengthMeter` |
| Anchor | `StatePill` `Token` `GutterMarker` `PlaceRow` `AnchorKind` |
| Thread | `ThreadCard` `AnchorCard` `Answer` `ToolSteps` `OrphanTray` `ReviewBar` |

## Using it

```tsx
import '@rex/design-system/styles.css';
import { Shell, ThreadCard, Token } from '@rex/design-system';
```

**Wrap everything in a `Shell`.** The palette is declared on `.rex-shell` and
nowhere else, so a component outside one renders as unstyled browser default.

## Building and re-syncing

```bash
npm install
npm run build       # tsup → dist/index.js + dist/index.d.ts, esbuild → dist/rex.css
npm run typecheck
```

The push to Claude Design is done by the `design-sync` skill in Claude Code,
which stages its own converter into `.ds-sync/` and writes the upload bundle to
`ds-bundle/`. Both are gitignored and fully derived.

**Read [`.design-sync/NOTES.md`](.design-sync/NOTES.md) before re-syncing.** It
records the traps — `tokensPkg` must stay unset, previews must wrap in `Shell`,
and this package can drift away from the app silently, because the tokens are a
copy and nothing checks them.

## The four rules

1. **Colour means state.** Steel resolved, amber moved, red lost, green
   finished. Red is spent on exactly two things — a lost anchor and the
   write-capable agent — so it never stops meaning "look at this".
2. **Selection is a change of intensity, never a second mark.**
3. **The answer outranks the machinery.**
4. **A quote never speaks in REX's voice.** Newsreader appears in one place
   only: text taken out of the document.

The long form is in `docs/guides/the-four-rules.md`.
