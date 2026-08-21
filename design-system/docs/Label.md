---
category: Type
---

# Label

The only heading REX's chrome has: `ANCHOR`, `PLACES`, `MOST REFERENCED`, `EVIDENCE`.

Ten pixels, semibold, tracked wide at `0.09em`, in `--muted`. It names a region without competing with anything inside it — which is the whole job, because in a review tool the loudest thing on screen should always be the document.

## Rules

- **Write the capitals yourself.** The component does not `text-transform`, so an abbreviation reads correctly and the label can be copied as it appears.
- There is no second heading level. If a region needs a sub-heading, it is two regions.
- Never use it for a value. It is the name of a box, not the contents.

## Examples

```tsx
<Label>ANCHOR</Label>
<Label>PLACES</Label>
```
