---
category: Foundations
---

# Swatch

One colour, its name and its value.

The chip carries a border in `--rule` for one reason: three of REX's surfaces are within a few percent of each other, and without an edge a `--panel` swatch on a `--bg` ground looks like a hole rather than a colour.

## Rules

- Pass the token, not the hex, when the swatch is documenting the system: `color="var(--moved)"` keeps the board correct after a token changes.
- Put the hex in `value`, so a reader can copy the number without opening the stylesheet.

## Examples

```tsx
<Swatch color="var(--action)" name="--action" value="#2f5da8" />
<Swatch color="var(--moved)" name="--moved" value="#f0b429" />
<Swatch color="var(--lost)" name="--lost" value="#d2402f" />
<Swatch color="var(--ok)" name="--ok" value="#4a9d7a" />
```
