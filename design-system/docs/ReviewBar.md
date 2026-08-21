---
category: Thread
---

# ReviewBar

What sits under the document after the agent has changed it, while the reviewer decides.

**A bar, not a dialog, and that is the whole point.** A modal over the document answers "what does this patch say" while hiding the thing it says it about. Here the reviewer reads the document as it now stands, with the changed sections outlined in it, and this sits under it carrying `OK` and `Undo`.

## Rules

- **It wears the write tint**, because a write-capable agent has already touched the disk.
- **The changed sections in the document are outlined in the same red — never the selection's blue.** Mid-Apply a reviewer must not have to work out which marks are their own selection and which are the agent's edit. Red is the second and last thing colour is spent on in this design.
- **The file that is already open is not a link**, because there is nowhere to go.
- Apply is off for PDF and DOCX: there is no honest source line to write a prose edit back to. A comment whose places include one still applies to the Markdown beside it, with the PDF named as skipped in `note`.
- The heading prop is `heading`, not `title` — `title` on a `<div>` is the browser tooltip.

## Examples

```tsx
<ReviewBar
  heading="Apply changed 2 files"
  note="1 skipped — spec.pdf has no source line"
  actions={<><Button variant="primary">OK</Button><Button>Undo</Button></>}
  files={[
    { path: 'docs/architecture/components.md', added: 12, removed: 4, open: true },
    { path: 'docs/README.md', added: 1 },
  ]}
/>
```
