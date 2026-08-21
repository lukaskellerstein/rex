---
category: Controls
---

# Chip

A filter over the comment list: `All 12`, `Open 7`, `Resolved 4`, `Orphaned 1`.

## Rules

- **The chip carries its own count**, which is why REX has no separate tally line anywhere. One row answers both "what can I filter by" and "how many of each are there".
- **The count badge only takes its state colour while the chip is on.** An entire row of coloured badges would spend steel, green and red on a control, and those three colours are needed for the cards below it.
- The counts are the workspace's, not the open document's — a comment about two files counts once.

## Examples

```tsx
<Chip on count={12}>All</Chip>
<Chip count={7} tone="open">Open</Chip>
<Chip count={4} tone="resolved">Resolved</Chip>
<Chip count={1} tone="orphaned">Orphaned</Chip>
```
