# REX 61 — counting the tokens

**Version:** 1.0 · 2026-10-17
**Status:** **built, milestones 0–1** (2026-10-17). Unit-tested on both sides
of the pipe; not yet driven in a live window.
**Amends:** [`42-the-agent-library/SPEC.md`](../42-the-agent-library/SPEC.md)
§7 (what `input_tokens` means); [`36-tools-in-the-chat/SPEC.md`](../36-tools-in-the-chat/SPEC.md)
§2 (the chat's numbers on the card and in the detail head).

## 1. Why

The card's run line and the chat detail head say a chat's turns, time and
price. They never said its size.

> The reviewer, 2026-10-17: *"I also want to see how many tokens there were, in
> and out. All tokens is the most important number for me. Maybe if I hover on
> the number, it will show a small dialog with the number in tokens and the
> cached tokens if it provides them."*

Measuring first turned up a second problem. `message.input_tokens` was already
stored, and for a Claude run it was wrong: the reviewer's database held a
$2.26 Opus run with **40 tokens in**. Anthropic's `input_tokens` counts only the
part of the prompt that was neither read from the cache nor written to it, and
in an agent loop that is almost nothing. A total built on it would be off by
four orders of magnitude.

## 2. Changes to earlier specs

| Spec | Was | Now |
|:--|:--|:--|
| 42 §7 | `input_tokens` is whatever the SDK called input | §3: every token the model read, the cache included |
| 42 §7 | `Completed` carries in and out | §3: also `cache_read_tokens` and `cache_write_tokens` |
| 36 §2 | turns · time · price | §5: turns · time · **tokens** · price |

## 3. One meaning for the counts

`input_tokens` is every token the model read, cached ones included, so
`input_tokens + output_tokens` is the run's whole size. The two cache counts are
**parts of** `input_tokens`, never additions to it. Each is null when the SDK
reported nothing, never 0 (spec 42 §7 rule 2).

| SDK | Its `input` | What the adapter does |
|:--|:--|:--|
| Claude Agent SDK | leaves the cache out | adds `cache_read_input_tokens` and `cache_creation_input_tokens` |
| Codex | already includes `cached_input_tokens` | passes it through |
| OpenCode | leaves `cache.read` and `cache.write` out | adds them |
| Deep Agents (LangChain) | already includes `input_token_details.cache_*` | sums the details per step |

## 4. Storage

Two nullable columns on `message`: `cache_read_tokens`, `cache_write_tokens`,
added by `migrateMessageCacheTokens`. Only the `completed` row fills them.

Rows written before this spec keep the `input_tokens` they were written with.
For a Claude run that is the cache-less number, and nothing can recover the
part the SDK never sent. Old Claude chats therefore read small; new ones read
true.

## 5. On the screen

`totalsOf` gains `tokens`: `{ total, input, output, cacheRead, cacheWrite }`,
or null when no run in the chat reported a count. One helper, so the card, the
detail head and the comment's debug report cannot disagree (spec 08 §6.2).

- The card's run line and the detail head draw `128.4k tokens` between the
  time and the price. Nothing is drawn when `tokens` is null.
- Hover or focus opens a small box: **total** first and bold, then `in`, the
  cache counts indented under it (only those reported), then `out`, each as the
  exact number.
- The box is `position: fixed`, because the detail head clips its summary with
  `overflow: hidden` and a `[data-tip]` label would be cut off.
- The debug report's TOTALS block gains one line with the same numbers.

## 6. Non-goals

| Not doing | Why |
|:--|:--|
| Tokens on each answer's foot | Not asked for; the foot is already the busiest line |
| Backfilling old Claude rows | The cache counts were never stored, so any number would be a guess |
| Reasoning tokens as their own row | Every SDK already counts them inside `out` |

## 7. Milestones

0. The four adapters normalise to §3; the protocol, schema and migration carry
   the two cache counts.
1. `totalsOf().tokens`, `TokenCount` on the card and the detail head, the
   debug report line.

## 8. Acceptance criteria

1. A new Claude run's `input_tokens` equals its uncached input plus both cache
   counts.
2. A chat whose runs reported no tokens draws no token count, never `0 tokens`.
3. The card and the detail head show the same total for the same chat.
4. Hovering the count shows total, in, out, and each cache count the SDK gave.
