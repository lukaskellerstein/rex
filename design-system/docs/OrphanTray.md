---
category: Thread
---

# OrphanTray

The strip that collects comments whose text is gone.

Dashed, because an orphan is a comment with nowhere to point — the border says so before the words do. It is the one control in REX that survives having no position at all: it cannot sit in the gutter, because there is no line to sit beside, so it lives at the top of the comments column and says how many.

## Rules

- **An orphan is not a document nobody opened.** A target in a file that has never been on screen is `not checked here`, in the grey this design uses for absence, and it is never counted in this tray. An orphan means the text is gone; unchecked means nobody looked. Confusing the two turns a quiet backlog into a false alarm.
- The comment and its quote are kept. An orphan is recoverable work, not a deletion.
- `note` is for the quiet count at the right edge — `3 in other documents`.

## Examples

```tsx
<OrphanTray count={1} />
<OrphanTray count={4} note="3 in other documents" />
```
