# REX 55 — asking about one turn

**Version:** 1.0 · 2026-09-11
**Status:** **built, and driven in a live window.** Both buttons were pressed in
an agent REX on 2026-09-11 against the reviewer's own database, and the
clipboard was read back with `pbpaste`. §7 records what the two reports said
about chat `4b421f50` and turn `mtx9xwi5-1` — the same chat the reviewer asked
about, and every number matches the screen it was copied from.
**Depends on:** [`51-the-trace-at-four-depths/SPEC.md`](../51-the-trace-at-four-depths/SPEC.md)
(the four depths, and the join the report is built from),
[`13-debugging/SPEC.md`](../13-debugging/SPEC.md) §4 (the app's own report),
[`01-initial/SPEC.md`](../01-initial/SPEC.md) §6.2 (the comment's report).

## 1. What this is

Traffic answers *what did REX send, and what came back*. It answers it on the
screen. The reviewer's next move is almost always to ask somebody about it —
usually Claude Code — and at that moment the screen is the wrong shape: the
facts are in ten cells, the ids are in two more, and the log the reader needs is
a file the screen never names.

> The reviewer, 2026-09-11: *"there should also be a debug button. I should be
> able to just click on the debug button. It will copy important information
> from the turn or from the chat and I can paste it into Claude Code and ask a
> question about this particular chat or turn."*

So: one button in the head of depth 2 and one in the head of depth 3, each
copying a plain-text report about the thing on screen.

**This is the third report, and it is not either of the first two.** They are
kept apart by what they are about, which is the same rule spec 13 §4 used when
it added the second:

| Report | About | Where the button is |
|:--|:--|:--|
| the app's (spec 13 §4) | this REX — its port, its document, its recent errors | the top bar, `B` |
| the comment's (spec 01 §6.2) | one thread — its session file, its places, its refusals | the card and the trace sheet |
| **this one** | one chat's turns, or **one turn**, joined to what went over the wire | the Traffic head, depths 2 and 3 |

## 2. What is decided, and why

**The id alone is not the feature.** Both ids are already on screen with a copy
beside them (spec 51 §5.2, §5.3). A second control that copies the same string
would be one more thing to read past — spec 51 §5.4's rule about five copy
buttons, and the reviewer rejected that screen the same day. This button earns
its place by copying what the screen cannot show: the two read commands, the
log's own file names, and every fact in one block of text.

**Main builds the text.** The database path, the traffic directory and the
versions are main's, and main owns the clipboard. A renderer copy needs the
window focused, which fails in the case the button exists for. Spec 01 §6.2
settled this for the comment report and nothing here revisits it.

**The report speaks the machine's words where the reader will grep for them.**
`api anthropic`, not `API Anthropic`: the screen's job is to name the surface
for a person (`API_LABEL`, spec 51 §5.3) and this report's reader is about to
search a `.jsonl` for that exact string.

**One button, one component.** `DebugCopy` already holds the timer, the failure
path, the reset-on-change and the "hang the report in `title` so it can be read
before it is pasted" rule. It takes the work to do instead of a thread id, and
there is still exactly one of each of those things.

**The counts on the screen and in the report may never disagree.** Depth 2
builds its turns in the renderer (`trace.ts`), and main cannot import that. So
the facts move to `shared/turns.ts` and both sides read one function. A report
that disagrees with the screen it was copied from is worse than no report, for
spec 08 §6.2's reason: by then nobody can check it.

## 3. What the report says

Two shapes, one head. Sections that would be empty are left out.

### 3.1 One turn — depth 3

```text
REX traffic · 2026-09-11T18:40:02.115Z · TURN

READ
  turn       sqlite3 ~/.rex/rex.db "PRAGMA query_only = 1" ".mode line" "SELECT …"
  exchanges  jq -c 'select(.run=="mtx9xwi5-1")' ~/.rex/gateway/traffic/2026-09-11.jsonl
  bodies     the row's own line carries them, unless it points at an overflow file beside it

TURN
  turn       mtx9xwi5-1 · ASK
  chat       4b421f50-… · "Is this true?"
  document   ~/Projects/…/sample-document.md
  agent      claude-agent
  gateway    Built-in · http://127.0.0.1:24334
  model      lmstudio-google-gemma-4-26b-a4b-qat
  style      default
  api        anthropic
  when       2026-09-11T20:12:59Z → 20:13:54 · 52.7s
  tokens     59305 in · 1321 out · cost not reported
  counts     1 exchange · 3 blocks · 0 tool calls · 0 failed

EXCHANGES (1)
  1 2026-09-11#412 · 20:13:54 · 52.7s · 2 messages sent · 59305 in · 1321 out · ok

STEPS (3)
  1 user     <system-reminder> Codebase and user instructions are shown… · 113.4 KB
  …

DENIED / FAILED / ERRORS          (each only when there is one)

VERSIONS
  rex 0.1.0 · electron … · darwin arm64
```

### 3.2 One chat — depth 2

The same head, then the chat's own facts, then **one block per turn** carrying
the four "who answered" facts and the counts — depth 2's list, as text. Its
`READ` names the whole chat rather than one run, and its failures are the
chat's.

### 3.3 What it must not carry

No credential value, no auth header, no environment. A gateway's URL is printed
because a URL is where the request went; what got it in is printed nowhere.
Spec 43 §9's rule, unchanged.

Every step and every failure is **clipped to one line**. The full text is in the
database and `READ` says how to get it. A report that pastes a 113 KB message
into a chat window is a report nobody can send.

## 4. Acceptance criteria

| # | Criterion |
|:--|:--|
| A1 | Depth 2's head has a `debug` button. Pressing it puts a chat report on the clipboard and hangs it in the button's `title` |
| A2 | Depth 3's head has one. Its report names the turn, the nine facts, the exchanges and the steps |
| A3 | The turn report's `READ` block names `~/.rex/rex.db` and the day file every one of that turn's exchanges is in |
| A4 | The numbers in the report equal the numbers depth 2 draws, because both come from `turnFactsOf` |
| A5 | A chat with no exchanges (answered through `Original`) reports its turns and says the gateway saw nothing, rather than drawing a gap |
| A6 | No report carries a credential value, an auth header or a process environment |
| A7 | A turn whose run id is null — the rows from before spec 51 — still reports, and says the turn was never recorded |

## 5. Where the code is

| File | Change |
|:--|:--|
| `src/shared/turns.ts` | **new.** `turnFactsOf(messages)` — the facts of every turn, from `message` rows, with no DOM and no database |
| `src/renderer/overlay/trace.ts` | `turnsOf` keeps building the blocks and takes its facts from `turnFactsOf` |
| `src/main/trafficReport.ts` | **new.** The two reports |
| `src/main/debug.ts` | exports `tilde`, `clip` and `versionLine`, which the new file needs and which may exist once |
| `src/shared/channels.ts`, `src/preload/index.ts`, `src/main/ipc.ts` | one channel, `traffic:copy`, carrying a chat id and an optional run id |
| `src/renderer/overlay/DebugCopy.tsx` | takes the work to do, not a thread id |
| `src/renderer/overlay/TrafficChat.tsx`, `TrafficTurn.tsx` | the button, in the ids row of each head |
| `src/renderer/overlay/overlay.css` | `.rex-tt-debug` — the look the button takes in that row |
| `test/turns.spec.ts`, `test/trafficReport.spec.ts` | **new.** The facts, and the text of both reports |

## 6. The rules that will bite

1. **Invariant I2.** The renderer draws and main reads. The report is built in
   main because it reads `rex.db` and the traffic log, and it crosses by
   `invoke`.
2. **`src/shared/` may import neither `main/` nor `renderer/`.** `turns.ts`
   imports `types.ts` and nothing else, which is what lets `node --test` run it.
3. **The turn clock now ends at the run's last row.** `turnsOf` timed a turn
   from its first drawn block to its last; the facts are counted from the
   messages, and a run's `completed` row is a message that is drawn nowhere.
   That is the same end `runStatsOf` has always used for elapsed time, so this
   makes two numbers agree rather than moving one.
4. **A report is read before it is pasted.** The text goes into the button's
   `title`, as the comment report's does, because it carries the reviewer's own
   document.

## 7. What the live run measured

2026-09-11, an agent REX on port 9334, against `~/.rex/rex.db` — the reviewer's
own, read and never written. Chat `4b421f50-4274-42ff-85ef-01cbc8ad06c8`, the
one in the report that asked for this. Both buttons pressed, and the clipboard
read back with `pbpaste` rather than trusted.

| What | The screen | The report |
|:--|:--|:--|
| turn | `Turn 1` `ASK` `mtx9xwi5-1` | `turn mtx9xwi5-1 · ASK` |
| who answered | claude-agent · Built-in · `lmstudio-google-gemma-4-26b-a4b-qat` · default | the same four, and the base URL under the gateway |
| duration | 52.7s | 52.7s |
| tokens | 59305 in · 1321 out | the same, and `cost not reported` |
| exchanges | 1 | `1 2026-09-11#1 · … · 52.5s · 2 messages · ok` |

**Two words that are deliberately not the same.** The screen counts BLOCKS — 3,
what it draws — and the report counts ROWS — 4, what `READ`'s query returns. The
`completed` row is the difference, and it is drawn nowhere. Using one word for
both would make a reader think one of the two had miscounted.

The exchange's timestamp is printed exactly as the log wrote it
(`2026-09-11T18:13:54.304126+00:00`), where the `message` rows are REX's own
`Z`-suffixed ISO. Two sources, two formats, and neither is rewritten: this is a
record, and a normalised time is a time nobody can grep for.
