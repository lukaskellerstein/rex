---
category: Controls
---

# TextButton

An action that must not look like a button: `show trace ›`, `go to ›`, `details ⌄`, `clear`.

It is a real `<button>`, because it does something rather than going somewhere — but it is set in link blue at 11px with no border and no fill, so it can sit beside a `Button` without competing with it.

## Rules

- **Keep the trailing glyph.** `›` opens a view; `⌄` unfolds in place. The glyph is how a reader tells the two apart before clicking.
- `quiet` drops it to `--muted`, for a secondary action like `clear` that should not draw the eye at all.
- A disclosure is better than a tooltip for anything longer than a few words: a tooltip is not reachable by touch or keyboard, and REX's notes are longer than a tooltip holds.

## Examples

```tsx
<TextButton>show trace ›</TextButton>
<TextButton>go to ›</TextButton>
<TextButton quiet>clear</TextButton>
```
