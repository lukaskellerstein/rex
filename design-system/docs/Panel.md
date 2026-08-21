---
category: Foundations
---

# Panel

A surface one step up from the shell ground.

## The four depths

REX has four surfaces and no shadows between them. Depth is carried by value alone, so the chrome stays flat and nothing on screen competes with the document for attention.

| Token | `tone` | Used for |
|---|---|---|
| `--bg` | — the shell ground | Behind everything. The tool-steps box sits on it. |
| `--panel` | `panel` | A column: the explorer, the comments. |
| `--sunk` | `sunk` | An inset: a button face, a tree row under the cursor. |
| `--well` | `well` | The deepest — where something is composed rather than read: the selection panel, the reply box. |

## Rules

- **The one lift in the design belongs to a selected card, not to a panel.** `--lift` says "this is the one you have open". Spending it on a container would make the sidebar look like it was floating over the document.
- `flush` drops the border and radius, for a panel that spans a whole column.
- A `well` inside a `panel` reads correctly. A `panel` inside a `well` does not — it looks like a hole.

## Examples

```tsx
<Panel tone="well" padded>
  <Label>SELECTION</Label>
  <NoteInput placeholder="What is wrong with this?" />
  <Button variant="primary">Ask</Button>
</Panel>
```
