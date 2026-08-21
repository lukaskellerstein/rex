---
category: Thread
---

# ToolSteps

Every tool the agent called, collapsed into one row.

The rule is **the answer outranks the machinery**, and this is the machinery. It folds to a single 30px row so a reader who wants the answer never has to scroll past a transcript, and it keeps its monospace register when open so it can never be mistaken for the answer above it.

## Rules

- **A denied call stays in red and wraps rather than clipping.** The `read` profile cannot write, and the deny gate firing is the proof — hiding it would hide the one thing that makes the profile split trustworthy.
- **The name column is 76px, not the 34px the board drew.** That column was drawn against `Bash`, `Read` and `deny`; a real transcript also carries `ToolSearch` and `WebFetch`, which at 34px printed straight over the argument beside them.
- **For the full thing, use the trace sheet over the document pane.** 384px of sidebar cannot hold a bash line, a path or a diff without wrapping it into mush.
- The fold and `show trace ›` are two buttons in one row, never a clickable span inside a button. The inner one would be unreachable by keyboard, which would put the whole trace behind a mouse.

## Examples

```tsx
<ToolSteps
  open
  onShowTrace={() => {}}
  steps={[
    { name: 'Read', arg: 'docs/architecture/components.md' },
    { name: 'Grep', arg: '40ms' },
    { name: 'Write', arg: 'docs/architecture/components.md', denied: true },
  ]}
/>
```
