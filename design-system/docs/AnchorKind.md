---
category: Anchor
---

# AnchorKind

What sits where a quote would sit, when the anchor is not text.

A figure or a table has no words to quote. This line is never left blank, and it is never filled with a description REX made up — REX does not describe a picture it cannot read. It says what the anchor **is**, plus the geometry, and stops there.

## Rules

- **Never invent a description.** `Figure` and `1024 × 384` are facts. "A diagram showing the request flow" is a guess, and a guess in a review tool is a lie with good intentions.
- **The geometry earns its place.** A region anchor is pure geometry, so it always resolves to *somewhere*. `RegionRef` therefore carries a fingerprint of the element's rendered content, and a mismatch reports `orphaned` with the comment and its quote kept. A redrawn figure must orphan while its untouched neighbour still resolves — this is the one anchor kind that can otherwise fail in silence.
- Its known limit is recorded in `create.ts`: a raster replaced at the same URL and the same dimensions is not detected.

## Examples

```tsx
<AnchorKind title="Figure" geometry="1024 × 384" />
<AnchorKind title="Region of a figure" geometry="x 210 · y 96 · 320 × 180" />
<AnchorKind title="Table" geometry="rows 3–7" />
```
