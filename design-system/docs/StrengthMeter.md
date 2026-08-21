---
category: Controls
---

# StrengthMeter

How likely this anchor is to still find its text tomorrow.

## The three tiers

| Tier | Bars | What it means |
|---|---|---|
| `durable` | 3, green | The element has an `id`, an `aria-label`, a `data-testid`, a `name` or a `title`, and that name matches exactly one element. |
| `fair` | 2, amber | Found by its heading and its text. Survives an edit elsewhere; not a rewrite. |
| `weak` | 1, red | A positional path and nothing else. Any reordering above it moves the comment. |

## Rules

- **It is shown because the reviewer can act on it.** A bare `<div>` with no id and no text is a positional path, and widening one level before clicking turns a weak anchor into a durable one. A meter nobody can act on would just be anxiety.
- It sits on the expanded selection row, beside the scope chips — the moment you are choosing what to point at is the moment the number can change what you do.
- The lit and unlit bar colours travel as custom properties, not as per-tier overrides of `i`. An override outranks `i.rex-off` on specificity and lights every bar, which is exactly what "Fair showing three bars" meant.

## Examples

```tsx
<StrengthMeter strength="durable" />
<StrengthMeter strength="fair" />
<StrengthMeter strength="weak" />
```
