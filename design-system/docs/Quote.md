---
category: Type
---

# Quote

Text taken out of the document under review.

**This is the only place Newsreader appears in the whole of REX.** Everything REX says is set in IBM Plex Sans; everything the document says is set in a serif, in italic, behind a rule. So a reader can never mistake a quote for REX's own voice — which matters, because the two sit centimetres apart in the same card and one of them is evidence.

## Rules

- **Never set REX's own text in the serif.** One family, one speaker. Breaking this is the fastest way to make a review tool untrustworthy.
- The height cap is deliberate and is not a bug. A quote here is an address, not the passage: if you need the whole thing, the document is on the left.
- `small` caps it at about two lines, for a collapsed row in a list.
- A figure or a table has no words to quote — use `AnchorKind` instead. Never invent a description of a picture.

## Examples

```tsx
<Quote>The resolver runs in the renderer, on the live DOM.</Quote>
<Quote small>Anchors are stored by the main process and never resolved there.</Quote>
```
