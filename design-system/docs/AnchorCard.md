---
category: Thread
---

# AnchorCard

The block at the top of an open thread: what this comment is about, and what it says.

It wears the same wash as the `ThreadCard` in the list, so opening a card is visibly the same object getting bigger rather than a new screen.

## Rules

- **The order is fixed**, and it is the design's own rule — the answer outranks the machinery. The comment is above the quote, the conversation is below both, and the tool steps are one collapsed row under that.
- The wash is the only thing carrying state here. There is no second badge, because the head already has room for a `StatePill`.
- The head is where `go to ›` lives: it opens the document of the comment's first place and scrolls there.

## Examples

```tsx
<AnchorCard
  state="moved"
  head={<>
    <Token index={2} state="moved" />
    <StatePill tone="moved">TEXT MOVED</StatePill>
    <TextButton>go to ›</TextButton>
  </>}
  note="This contradicts §4 — which one is current?"
>
  <Quote>The resolver runs in the renderer, on the live DOM.</Quote>
</AnchorCard>
```
