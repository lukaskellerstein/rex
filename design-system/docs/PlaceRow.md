---
category: Anchor
---

# PlaceRow

One place a comment is about, in a list of them.

**The comment list is the workspace's, not the open document's.** So every row names its document always — a list where the document appears sometimes is a list you have to read twice — and a comment about two files is one comment seen from either of them.

## Rules

- **Pointing at a row lights it**, and draws its number on the mark in the document, in the open comment's violet.
- **A place in a document that is not open has nothing to light.** That row says which document it is in, and opens it. This is what makes a workspace-wide comment list usable at all: a gutter marker can only reach the document on screen.
- **`unchecked` is not `orphaned`.** A target in a document nobody has opened gets the grey this design uses for absence, never red, and is never counted as an orphan. An orphan means the text is gone; unchecked means nobody looked.
- Violet outranks state here. A reviewer with a card open is asking "where is this one?", not "what state is it in" — the card already says the state in words.

## Examples

```tsx
<ol className="rex-places">
  <li><PlaceRow index={1} document="components.md" active>the resolver</PlaceRow></li>
  <li><PlaceRow index={2} document="architecture.html" lit>invariant I1</PlaceRow></li>
  <li><PlaceRow index={3} document="SPEC.md" unchecked>§6.5</PlaceRow></li>
</ol>
```
