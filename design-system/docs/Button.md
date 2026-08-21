---
category: Controls
---

# Button

REX's action control. 28px high, 4px radius, no shadow.

## Variants

| Variant | Use for |
|---|---|
| `default` | Every ordinary action. Sunk face, rule border. |
| `primary` | The one thing the panel exists to do — `Ask`. Steel fill. |
| `write` | The agent that can edit a file on disk. The mark's red. |

## Rules

- **One `primary` button per panel.** In the selection panel it is `Ask`; in a dialog it is the confirming action. If a panel seems to need two, one of them is `default`.
- **`write` is not a style choice.** Red is spent on exactly two things in this design — a lost anchor, and the write-capable agent — so that it never stops meaning "look at this". Never use `write` to make an ordinary action look urgent.
- **A destructive action stays away from the primary one.** `clear` lives inside the selection list it acts on, not beside `Ask` at the foot: a destructive control next to the primary one is a slip waiting to happen.
- Disabled drops to `--faint` and keeps its box. A control that vanishes when it cannot be used is a control the reader has to hunt for later.

## Examples

```tsx
<Button variant="primary">Ask</Button>
<Button>Resolve</Button>
<Button variant="write">Apply</Button>
<Button variant="primary" disabled>Ask</Button>
```
