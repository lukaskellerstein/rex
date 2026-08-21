# design-sync notes — @rex/design-system

Repo-specific things a future sync should know before it starts.

## What this package is

`design-system/` is a **nested package inside the REX app repo**, not a separate
repo. It was written on 2026-08-21 specifically so REX could have a Claude
Design project: REX's own components (`src/renderer/overlay/*.tsx`) are app
screens wired to `window.rex` IPC and cannot be pushed as a design system.

Every value here was lifted out of the running app —
`src/renderer/overlay/overlay.css` (46 chrome tokens) and `src/shared/tokens.ts`
(the paper half). **If either of those changes, this package is stale.** Nothing
enforces that link; it is a copy, and the copy is deliberate (the app must not
depend on this package).

## Gotchas hit while building it

- **`tokensPkg` must stay unset.** Pointing it at `@rex/design-system` makes the
  converter look for `node_modules/@rex/design-system/package.json`, which
  cannot exist — npm will not self-install a package. It crashes with `ENOENT`
  in `lib/css.mjs:57`. `tokensGlob` alone is enough; the tokens are already
  inside `dist/rex.css` through the `@import` closure.
- **`guidelinesGlob` must stay narrowed to `docs/guides/**/*.md`.** The default
  also matches `docs/*.md`, which copied all 24 per-component docs into
  `guidelines/` as duplicates of their own `.prompt.md`.
- **Playwright is not installed in this package.** It resolves upward to the
  REX app's `node_modules` (playwright 1.62.1, which pins chromium build 1234 —
  the build cached in `~/Library/Caches/ms-playwright`). Do not add playwright
  here; if the app drops it, install 1.62.1 rather than latest, or the cached
  chromium will not match.
- **`ReviewBar`'s heading prop is `heading`, not `title`.** `title` on a `<div>`
  collides with the HTML tooltip attribute and fails `tsc` against
  `HTMLAttributes<HTMLDivElement>`.
- **Every preview must wrap its content in `<Shell>`.** The palette is declared
  on `.rex-shell` only, so a preview without one renders as unstyled browser
  default and grades `needs-work` on Styled. This is the single most likely
  mistake when adding a component.

## Known render warns

All 20 `[GRID_OVERFLOW]` warns are expected and already answered by
`cfg.overrides.*.cardMode: "column"`. REX's real measures are wide — a comment
column is 384px and the Apply bar is drawn at 720px — so a card that fits a
narrow grid cell would be lying about the design. A warn on a component NOT in
that overrides list is new: look at it.

No `[RENDER_THIN]`, `[RENDER_BLANK]` or `[FONT_MISSING]` warns remain.

## Re-sync risks

- **The app can drift away from this package silently.** `overlay.css` and
  `tokens.ts` are the source; nothing checks that the copy still matches. Before
  a re-sync, diff the `.rex-shell` block in `overlay.css` against
  `src/styles/tokens.css` here.
- **The fonts are copied, not linked.** `src/styles/fonts/` holds 7 woff2 files
  taken from the app's `@fontsource` packages (latin subset, 152 KB total). A
  `@fontsource` version bump in the app does not reach them.
- **This canvas's converter came from bundle 2.1.233**
  (`/private/tmp/claude-501/bundled-skills/2.1.233/…/design-sync`), which is not
  the bundle this session ran. It is a temp path and will not survive. A future
  run must re-stage from whatever design-sync bundle is current, and should
  expect the config schema to have moved.
- **Upload path used: atomic**, not incremental — everything was verified first,
  then uploaded in one pass. The base SKILL.md that describes the incremental
  router was not on disk, only `non-storybook/SKILL.md`.

## What was not done

- No component for the top bar, the explorer tree, the splitter, the reference
  graph or the trace sheet. They are app shell rather than design system, and
  the 24 here were the agreed scope.
- The three `docs/guides/` files are hand-written, not generated.
