---
category: Type
---

# Meta

The quiet line under something: `read · 2 turns · 6 steps · 12.4s · $0.031`.

Eleven pixels in `--muted`. It is the register REX uses for a fact *about* a thing rather than the thing itself, and it is deliberately hard to mistake for the answer above it.

## Rules

- **Separate the parts with ` · `, not commas.** The parts are peers, not a sentence.
- `tabular` for anything numeric that updates in place — a cost, a duration, a count. Proportional digits shimmer as they change.
- `mono` for an address: a path, a document name, a session id. Never for prose.
- No new data is needed to fill a meta strip on a comment. `Message` already stores `costUsd`, `durationMs`, `inputTokens`, `outputTokens` and `seq`; `Thread` already stores `profile`, `model` and `sessionId`.

## Examples

```tsx
<Meta tabular>read · 2 turns · 6 steps · 12.4s · $0.031</Meta>
<Meta mono>docs/architecture/components.md</Meta>
```
