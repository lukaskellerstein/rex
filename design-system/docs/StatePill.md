---
category: Anchor
---

# StatePill

A state, said in a word and a colour at once.

## Tones

| Tone | Colour | Means |
|---|---|---|
| `ok` | green ground | Resolved exactly. |
| `moved` | amber | Re-found after the text around it changed. |
| `lost` | red | The text is gone. |
| `write` | red, write tint | The agent that can edit a file on disk. |

## Rules

- **Always give it a word.** Nothing in REX rests on hue alone — a reviewer with a colour-vision difference must read the same state a reviewer without one reads, from the same pixel. The dot is drawn from `currentcolor`, so the pill can never say one thing in its text and another in its mark.
- **`lost` and `write` are the same red on purpose.** Red is spent on exactly two things: an anchor whose text is gone, and the agent that can change a file. Both mean "look at this before you go on". A third meaning would teach the reviewer to ignore the first two.
- A superseded claim is **amber**, not red. An old decision replaced by a new one is not a fault.

## Examples

```tsx
<StatePill tone="moved">TEXT MOVED</StatePill>
<StatePill tone="lost">ANCHOR LOST</StatePill>
<StatePill tone="write">WRITE PROFILE</StatePill>
```
