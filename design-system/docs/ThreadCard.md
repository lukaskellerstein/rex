---
category: Thread
---

# ThreadCard

One comment in the list. Treatment **C · Wash** — the one of four that was built.

## The rule the four treatments were judged on

**A card carries its state as a wash with a matching border**, and selection deepens that same wash and brightens that same border. It never changes hue.

A reviewer must be able to read *what state this is in* and *whether it is the one I have open* at the same time, from one card. A selected card that changed colour would answer the second question by destroying the first.

Hover sits between resting and selected, on the same hue again — three steps of one colour, never two colours.

## Rules

- **The state is written in a word in the meta line as well as painted in the wash.** Nothing here rests on hue alone.
- **Every row names its documents**, always. The list is the workspace's.
- The lift (`--lift`) belongs to the selected card and to nothing else on screen.
- A resolved card keeps its note at `--fg-dim`. It is finished, not deleted.

## Examples

```tsx
<ThreadCard
  token={<Token index={1} />}
  note="Is 40ms still the target here?"
  documents="docs/architecture/components.md"
  meta={<span>read · 2 turns</span>}
/>

<ThreadCard
  state="moved"
  selected
  token={<Token index={2} state="moved" />}
  note="This paragraph contradicts §4."
  documents="components.md · architecture.html"
  meta={<span className="rex-state-moved">text moved</span>}
/>
```
