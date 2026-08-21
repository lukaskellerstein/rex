---
category: Anchor
---

# GutterMarker

A comment's mark in the margin of the document, in the 32px gutter beside the paper.

## Rules

- **It is drawn in the gutter, never on the document.** REX does not mutate what it is reviewing — not a wrapper element, not a style attribute, nothing. The same rule is why highlights use the CSS Custom Highlight API rather than `<mark>`: wrapping a range would shift every offset the other anchors depend on.
- **An orphan pins to the foot** with the word `LOST` under it. Never leave it floating at a guessed height: a marker beside the wrong paragraph is worse than a marker that admits it has nowhere to go.
- The gutter's two greys are literal rather than tokens, because the gutter is on the paper. It has to read against a document, and a document is light whatever REX's chrome is doing.
- `resolved` is white with a grey rule — drained, still numbered.

## Examples

```tsx
<div className="rex-gutter" style={{ height: 220 }}>
  <GutterMarker index={1} />
  <GutterMarker index={2} state="moved" />
  <GutterMarker index={3} state="resolved" />
  <GutterMarker index={4} state="orphaned" pinned />
</div>
```
