---
category: Controls
---

# ScopeChip

How wide the thing you picked is: `sentence`, `paragraph`, `cell`, `row`, `table`, `figure`.

Selecting is a phase, and widening is part of it — you drag over a word in a table, then walk out to the cell, the row, the table. The chips are that walk, and the one that is on is where the anchor sits now.

## Rules

- **The chips appear on the expanded selection row only.** Nine collapsed rows each carrying a full set of scope chips is a wall, and the panel exists to make a nine-place selection readable.
- **`tbody` is walked through, never offered.** Nobody comments on a table body, and offering it put two chips both reading "table" side by side.
- **There is no held modifier and there must never be one.** On macOS `ctrl`-drag is a right-drag and the OS takes it before the page sees it. Widening is a click on a chip, or the `[` and `]` keys.

## Examples

```tsx
<div className="rex-scopes">
  <ScopeChip>sentence</ScopeChip>
  <ScopeChip on>cell</ScopeChip>
  <ScopeChip>row</ScopeChip>
  <ScopeChip>table</ScopeChip>
</div>
```
