---
category: Foundations
---

# Shell

The surface every other component stands on, and the only place the palette is declared.

In REX itself this is a shadow root. Every pixel REX draws lives inside one, so the document under review cannot style REX's controls and REX's CSS cannot change how the document looks. In a review tool that is a correctness requirement, not a preference — a stylesheet that silently restyled the thing being reviewed would make the review worthless.

Here it is a class, which buys the same thing one level weaker: the tokens are scoped to this element, so a card can be dropped into any page without leaking the palette into it.

## Rules

- **Wrap everything in one.** A component used outside a `Shell` finds no `--fg`, no `--sans` and no wash, and renders as unstyled browser default.
- Nesting one inside another is harmless but pointless — the inner one re-declares the same values.
- `fill` stretches it to the height of its container, for a full-window app frame.

## Examples

```tsx
<Shell>
  <ThreadCard note="Is 40ms still the target?" documents="docs/architecture/components.md" />
</Shell>
```

A whole window:

```tsx
<Shell fill>
  <TopBar />
  <Body />
</Shell>
```
