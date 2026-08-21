---
category: Controls
---

# Segmented

REX has exactly one control that means "switch what this pane shows", and this is it.

It carries `Document | Graph | Facts` in the top bar and `Selection | Comments` in the sidebar. Both are the same kind of choice, so both wear the same control — a reader who has learnt one has learnt the other.

## Rules

- **It is not a mode switch.** A mode belongs where the mode acts: `pick element` sits at the foot of the paper, in the strip that becomes the path bar, not up here among facts about the document. Putting a mode in this control was the fault the redesign removed.
- **The bar stays put when it is empty.** An empty Selection tab dims and reads `0`; it does not disappear. A control that comes and goes is its own kind of confusing, which is the fault this set out to fix.
- **Each tab carries its own count**, so the bar doubles as the tally.
- A trace is not a peer of Document and Graph: a trace belongs to one comment, so the button would come and go. It gets a sheet over the document pane instead.

## Examples

```tsx
<Segmented
  aria-label="Workspace view"
  value="document"
  options={[
    { value: 'document', label: 'Document' },
    { value: 'graph', label: 'Graph' },
    { value: 'facts', label: 'Facts' },
  ]}
/>
```

The sidebar, with an empty selection:

```tsx
<Segmented
  aria-label="Sidebar"
  value="comments"
  options={[
    { value: 'selection', label: 'Selection', count: 0, disabled: true },
    { value: 'comments', label: 'Comments', count: 12 },
  ]}
/>
```
