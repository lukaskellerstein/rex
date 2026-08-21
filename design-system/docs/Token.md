---
category: Anchor
---

# Token

The numbered circle on a comment card. State at full strength.

The number is the whole point: it ties this card to a mark in the document, so `3` in the card and `3` in the gutter are one comment seen twice.

## Rules

- **`resolved` is drained of colour but still numbered.** A resolved comment is not gone — you can still find what it was about, which is exactly what a reviewer needs when they are checking whether a change was actually made.
- `active` rings it in link blue. That is "this is the card you have open", and it is the same ring the gutter marker takes.
- The fill is the same four states the card wash uses. Card and token never disagree.

## Examples

```tsx
<Token index={1} />
<Token index={2} state="moved" />
<Token index={3} state="orphaned" />
<Token index={4} state="resolved" />
<Token index={5} active />
```
