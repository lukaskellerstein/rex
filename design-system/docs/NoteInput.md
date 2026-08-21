---
category: Controls
---

# NoteInput

Where a comment gets written, and where a reply gets typed.

A textarea rather than an input, and resizable vertically, because a comment on a document is a sentence or two more often than it is a line. 58px is about two lines at REX's 13px — enough to start, not so much that an empty box dominates the foot of the panel.

## Rules

- **It sits at the foot of a full column**, under whatever it is about. That is what the sidebar's two tabs bought: with the selection list no longer capped to leave room below it, the note and `Ask` have the bottom of the panel to themselves.
- The placeholder asks a question rather than naming the field. `What is wrong with this?` gets a better comment than `Comment`.
- Focus moves the border to `--action` and removes the outline. That is the one place the steel is spent on a control rather than a state.

## Examples

```tsx
<NoteInput placeholder="What is wrong with this?" />
<NoteInput placeholder="Reply to this thread" rows={3} />
```
