# Spec 51 — the trace, at four depths

**Status**: built, 2026-09-09. Every criterion in §7 is met and was driven in a
running REX, not merely tested.

> [!important]
> **The feature is called TRAFFIC, and depth 3 is its own screen.**
>
> The first build got both wrong and the reviewer rejected it the same day. It
> folded depth 3 into the comment's trace sheet — so `Open turn` left the
> feature and landed on a different screen answering a different question — and
> it took the artboards' own title, `Trace`, which REX already uses for that
> sheet. Two screens with one name is how a reviewer opens the wrong one.
>
> So: this feature is **Traffic** at four depths, `TrafficPage` → `TrafficChat`
> → `TrafficTurn` → `TrafficMessage`, and **all four are pages** — depths 1–3
> because `design/traffic/` draws them as pages, depth 4 since the amendment in
> §5.4 on 2026-09-11. **The comment's own sheet is unchanged in behaviour** and
> is labelled `CHAT`; the card's link reads `show detail`. `test:depths` pins
> both halves of that separation.

Three things the build found and the spec did not say:

1. The search box on depth 2's artboard is §8's out-of-scope full-text search
   and is not there.
2. **Depth 2 could not open from depth 1** — the renderer holds a
   `ThreadWithMessages` only for the document that is open, so the chat and its
   document travel with the exchanges (§5.2).
3. Depth 3's two-line clamp bled a third line: `overflow: hidden` clips at the
   PADDING box, so the row's bottom padding belongs on the button and not on
   the clamped text.
**Design**: `design/traffic/` — four artboards and their notes.

## 1. What this is

A reviewer must be able to see **what REX actually sent to a model and what came
back**, from the app level down to one message's JSON, without leaving REX and
without reading a file by hand.

Today two half-answers exist and neither reaches the wire:

| Today | What it shows | Where from |
|:--|:--|:--|
| **Trace sheet** (spec 08 §6, spec 38) | one comment's machinery — thinking, tool calls, refusals, diffs | `message` rows in SQLite |
| **Traffic sheet** (spec 46 §4.6) | one comment's gateway rows — timing, tokens, cost, and a body | `~/.rex/gateway/traffic/*.jsonl` |

Neither groups by turn. Neither shows which agent, gateway, output style or mode
produced an answer, though every one of those is already on the row. Neither
lets you see one message's JSON. And there is no way to ask "what has REX run
at all", across comments.

This spec makes those one thing, at four depths, and fixes the record underneath
so the depths have something true to draw.

## 2. What is decided, and why

**The trace is one thing with four depths, not four screens.** Depth 3 already
exists — it is the trace sheet — so this spec extends it rather than building a
second one beside it. A parallel screen reading the same rows is how two views
of one fact start disagreeing.

**Two words are already taken, and this spec does not take them again.**

| The word | What it already means in REX | What this spec calls the new thing |
|:--|:--|:--|
| `session` | the **SDK's** session cache — `thread_session`, one row per (thread, sdk, gateway), so a resumed run does not replay | **chat**, and the id shown is the `thread.id` |
| `trace` | one comment's machinery sheet | still that. It becomes **depth 3** of the same feature rather than a sibling |

A chat is a `thread`. A **turn** is a `run` — one Ask or one Apply, the
`x-rex-run` header. Below a turn are **exchanges**: one request and one response
over the wire. One turn makes several exchanges, and each sends the whole
conversation so far, which is why the message count grows down a turn.

**The Readable / JSON switch lives at depth 4 only.** At depth 3 a 78-message
tree is a wall on any screen REX can draw, and the reviewer asked for it not to
be there. *(Amended 2026-09-11: at depth 4 the two stopped being a switch and
became one split view. §5.4.)*

## 3. The record must be whole first

**The traffic log does not hold enough to draw depth 4**, and three of the four
losses are silent. Measured against `~/.rex/gateway/traffic/` on 2026-09-08,
157 rows over two days.

| # | What is lost | Where |
|:--|:--|:--|
| 1 | `request_body` is the **messages array**, not the request. No `tools`, `temperature`, `max_tokens`, `stream`, `tool_choice` | `rex_trace.py` `_row()` |
| 2 | `response` is a Python **repr string** — it begins `ModelResponse(id='chatcmpl-…`. `redact()` falls through to `str(value)` because `ModelResponse` is a Pydantic object, not a dict | `rex_trace.py` `redact()` |
| 3 | Over `MAX_BODY_CHARS` (200 000) the body is **deleted**, not truncated — replaced by `{"omitted": …}` | `rex_trace.py` `_shrink()` |
| 4 | Deeper than 12 levels becomes `"…"` | `rex_trace.py` `redact()` |

### 3.1 What changes

1. **Record the whole request.** `request_body` becomes the request as sent —
   `kwargs` minus the secret keys — and not one field out of it.
2. **`model_dump()` the response before redacting.** A Pydantic model becomes a
   dict; everything else keeps today's `str()` fallback. This is what gives
   depth 4 a finish reason, a usage object and structured `tool_calls`.
3. **An oversized body is stored, not dropped.** The row keeps its own overflow
   file beside the day's log and points at it. A body that cannot be written
   falls back to today's `{"omitted": …}` marker, which is the only case where a
   body may still be absent.
4. **Inline images move out of the line.** A base64 image is replaced by a
   reference and written once under `~/.rex/gateway/traffic/blobs/`. One 84 KB
   image is ~114 000 characters of base64: left inline it trips rule 3 on its
   own, and it drowns both the log and the 30-day retention.
5. **The depth cap rises to 32** and records that it clipped, so a `"…"` is
   never mistaken for the model's own text.

**What does NOT change: the secret stripping.** `SECRET_KEYS` keeps dropping
`api_key` and `Authorization` by name, and `test_no_credential_survives_redaction`
keeps guarding it. §14 rule 7 stands.

> [!warning]
> **Retention now has two jobs.** `_prune` deletes a day's `.jsonl`; it must
> delete that day's blobs with it, or the blob directory grows without bound
> while the log looks bounded.

## 4. Where the nine facts come from

The reviewer asked that a turn name its agent, gateway, output style, model,
mode, seconds, cost, tokens in and tokens out. **All nine already exist**, and
none of them is in the traffic log:

| Fact | Column |
|:--|:--|
| agent | `message.sdk` |
| gateway | `message.gateway_name`, with `message.base_url` |
| output style | `message.style` |
| model | `message.model` |
| mode | `message.mode` — `ask` / `act` / `note` |
| seconds | `message.duration_ms` |
| cost | `message.cost_usd` |
| tokens in / out | `message.input_tokens` / `message.output_tokens` |

So **depth 3 is a join**: `message` rows for what the agent did, traffic rows for
what went over the wire, joined on the run id. Neither side can draw the screen
alone, and that is the one structural fact this spec turns on.

> [!important]
> **`message` has no `run` column.** The join key does not exist yet. Adding
> `message.run_id`, set on the send and on everything that run produces — the
> same rule `model` and `style` already follow — is a prerequisite of depth 3,
> and rows written before it are `NULL` and group under "before turns were
> recorded" rather than being hidden.

## 5. The four depths

### 5.1 Depth 1 — every chat

Reached from the app, not from a comment. One row per `thread`: its name, id,
document, agent, turns, exchanges, tokens, cost, when, failures. Filters on
document, agent and date.

### 5.2 Depth 2 — one chat, its turns

Where the comment card's existing `traffic` button lands. The chat id is on
screen and copyable. One row per turn, carrying the mode pill, the four "who
answered" facts, the counts, and the totals. Expanding a turn shows a **brief
step list** — one line per step — and never JSON.

### 5.3 Depth 3 — one turn

The existing trace sheet, gaining three things: the nine facts as a grid, the
exchange rail, and a per-message way into depth 4. Turn id and chat id both in
the head.

#### 5.3.1 The system prompt is a row, and it is not a message

> [!important]
> **Added 2026-09-11.** The list of a turn is built from the request's
> `messages`, and on two of spec 46 §4.5's three doors the system prompt is not
> in there. It travels in a field beside the conversation:

| Door | Where its system prompt is | What it is |
|:--|:--|:--|
| Anthropic `/v1/messages` | `system`, beside `messages` | a string, or a list of text blocks |
| OpenAI `/v1/responses` | `instructions`, beside `input` | a string |
| OpenAI `/v1/chat/completions` | `messages[0]` | already in the list |

So a Claude turn and a Codex turn both drew a conversation whose instructions
were nowhere on screen. Measured on the reviewer's own log: **8 138 characters
of Claude Code's prompt and 20 751 of Codex's**, recorded in every body and
reachable from no depth. The reviewer found it the other way round — by asking
why a turn's list began with a `user` row when a system prompt must come first.

It comes first for the model. The request's own array does not start with it,
because LiteLLM inserts the prompt at index 0 of the list it calls the model
with, and that translated list is not the one recorded under `messages`.

Three rules:

1. **The prompt is the first row, and carries no number.** The numbers count
   messages, and it is not one. Calling it 1 would make message 1 be 2.
2. **It wears a wash, and the wash is lemon.** The four roles are told apart by
   their left edge alone, which suits things that repeat; this appears once and
   came from somewhere else entirely, so a fifth edge colour would have filed
   it as a fifth role. Lemon rather than gold because the gold in this list is
   already a tool call — the same separation spec 28 §4.4 made, for the same
   reason. The head says `and 1 system prompt` in that colour, beside a message
   count it is deliberately not part of.
3. **A `system` ROLE inside `messages` is a different thing and keeps its grey.**
   Claude Code sends several per conversation — its SessionStart hook output,
   its `# Environment` block, and reminders further down; one real turn of 36
   messages carried four, at indexes 1, 8, 15 and 26. LiteLLM keeps each where
   it is. They are messages. The prompt is not.

**Both depths build their list from one function**, `wireEntries` in `wire.ts`.
The index depth 3 hands to depth 4 is a place in that list, so two lists built
apart would agree until one of them gained a row, and then every `Open` would
land one message off — silently, on a screen whose whole job is to say what was
actually sent.

### 5.4 Depth 4 — one message

Readable or JSON, for one message. The JSON is a fold tree with a gutter, one
colour per type, and a summary kept on every folded node.

> [!important]
> **Amended 2026-09-11: depth 4 is a PAGE, and `Message.dc.html` is superseded.**
>
> This section said it was a dialog over the turn, because its artboard is the
> one narrow artboard. The reviewer reported the cost on a large display: a
> request body is tens of kilobytes of JSON, and `min(760px, 94vw)` reads it
> four words at a time while the rest of the screen sits empty. A dialog is for
> one decision and then dismissal (spec 46 §8); reading a message is neither.
>
> So all four depths are pages, and the path is walked by the same breadcrumb
> the others carry. Three things follow, and each is a real difference rather
> than a restyle:
>
> 1. **The turn is unmounted, not covered.** That is what makes the width real —
>    a wider dialog would still be a box on a backdrop.
> 2. **`Escape` has one listener.** Both screens were mounted before and both
>    bound the key; the walk back to depth 3 worked only because the turn
>    registered its handler first. The race is gone, and the behaviour it
>    happened to produce is now the one that is written down.
> 3. **`onBack` and `onClose` split.** Back goes to the turn, the × leaves
>    Traffic, which is what every other page's × already does.
>
> **Prose keeps a measure and JSON does not.** The tree takes the whole page,
> which is the point; the Readable pane is capped in `ch`, because a line of
> English at 2 000px is unreadable. Only this artboard is superseded. Every
> other measurement in `design/traffic/` stands.

> [!important]
> **Amended again, 2026-09-11: Readable and JSON are ONE view, linked.**
>
> They were two tabs, and they answered two halves of one question. JSON has the
> keys and the shape, and draws a 1 200-character value as one escaped run with
> `\n` written out. Readable has the prose and throws the keys away, and drew it
> in a column with the whole right half of the page empty beside it. Switching
> between them made the reader hold a place in their head, which is the thing a
> screen is supposed to do for them.
>
> So the body splits. The tree is on the left and one picked value is on the
> right. **Clicking a row is what fills the pane**, and the pane names what it
> is showing — `content[0].text`. With nothing picked it draws the whole
> message, which is exactly what the Readable tab drew, so the screen a reader
> already knows is now the pane's resting state rather than a place to go.
>
> | The rule | Why it is that way |
> |:--|:--|
> | Three layouts: `Split`, `JSON`, `Readable`. Split opens | The other two are for a reader who wants one thing on the whole page |
> | A row click in `JSON` alone opens the split | A control that answers nothing is worse than one that answers somewhere else, and this is the gesture the reviewer reached for first |
> | The arrow folds, the row picks, the copy copies | Three parts of a row, three jobs. The row is a real `<button>`, so the keyboard reaches it |
> | A closing brace is not pickable | It is punctuation. Picking it would land on the node above it, which is a control quietly doing something else |
> | The divider is stored as a FRACTION | A stored pixel width becomes a different layout on a different screen |
> | **`Plain` is the default; `Markdown` is one click** | This screen answers *what did REX send*, and a renderer hides the exact characters — a stray asterisk, trailing whitespace. The record opens; the rendering is offered |
> | Markdown goes through `prose.tsx` | It is untrusted model output inside REX's own chrome (§10 rule 1 / invariant I2). That renderer is already `html: false` plus DOMPurify over a tag allow-list with no attributes. A second `markdown-it` here would be a second thing to get wrong |
>
> **The inline expansion is not repealed.** A long value still opens in place,
> still quoted, still JSON — reported 2026-09-09, and in `JSON` on its own it is
> the only way to read one.
>
> **THE COPY BELONGS ON THE THING BEING COPIED.** Two places carry one, and no
> others. The first build put five on the screen and the reviewer rejected it
> the same day, calling the one beside the message's size "extremely too much":
> a second control for something already reachable is one more thing to read
> past.
>
> | Where | What it copies |
> |:--|:--|
> | A **row** of the tree | `JSON`, its own subtree — the only way to lift one branch out. On a string, `Text` as well |
> | A **card** in the pane | one copy, unlabelled, for exactly what that card shows |
>
> A card is a block of a message, or a picked value — which is drawn in a card
> for this reason, so the pane has one rule rather than two. **Neither bar
> carries a copy**: the pane's head has none and the toolbar has none, and the
> whole message is still copyable, because it is the tree's ROOT row.
>
> The two forms are worth naming. `JSON` is the structure, escaped and indented:
> what goes into a file or a bug report, and what proves what was on the wire.
> `Text` is the string with its real line breaks: what goes into an editor to be
> read or searched. Both are the one `CopyText`, given a word beside the glyph —
> a second copy button would have to get the flash, the failure path and the
> reset-on-change right again. A card with nothing in it gets no button, because
> one that copies an empty string is a button that lies.
>
> > [!warning]
> > **A copy button on this screen has to be told to appear.** `.rex-copy` is
> > `opacity: 0` until a named ancestor is hovered, and the ancestors are named
> > one by one: `.rex-turn`, `.rex-trace-entry`. Depth 4 is neither, so its
> > copies were invisible and keyboard-only when the split shipped on
> > 2026-09-11. **A Playwright click never notices** — a click does not need to
> > see the thing it presses. Found by looking for the button. Both places that
> > carry one now name themselves: `.rex-json-line:hover` and
> > `.rex-readable-block:hover`.
>
> `test:json-tree` covers the three new functions in `jsonTree.ts` — `valueAt`,
> `pathLabel` and `valueText` — because a path is a decision about the tree and
> belongs where `node --test` can reach it.

### 5.5 The mode pill

Mode is drawn with REX's own `.rex-sent` pill wherever it appears, and never
reinvented: `padding: 1px 6px`, `border-radius: 999px`, text in `--bg`, 9px/700
at `.09em`, labels from `MODE_LABEL`. **ASK is `#4d84e8` and ACT is `--lost`
`#d05744`** — spec 33 §3.3, where ACT took the write agent's red and the amber
went to NOTE. A rail cannot also carry the mode, because ACT's colour is the
failure red.

## 6. Two defects this spec also fixes

Both were reported on 2026-09-08 against the Settings screen.

1. **"Starting…" never refreshes.** `Settings.tsx` draws `builtin.down ??
   "Starting…"`, and nothing re-reads the state after the child comes up:
   `refreshGateways` and `setBuiltin` run only on a click. A gateway that
   started 1.6 seconds later still reads "Starting…" until something else
   happens to ask. Main sends the renderer nothing when the child is ready.
2. **A start that fails late says nothing.** `startBuiltinIfEnabled` catches the
   error and only logs it, so `down` stays `null` and the screen shows
   "Starting…" instead of the reason. Only the two early checks set `down`.

Also: the retired-gateway notice (`Settings.tsx`) is removed. It has been seen.

## 7. Acceptance criteria

| # | Criterion |
|:--|:--|
| A1 | A request recorded through the built-in gateway round-trips: `json.loads` of the row's `request_body` carries `model`, `messages` and `tools` |
| A2 | `response` parses as an object and carries `choices[0].finish_reason` and `usage` |
| A3 | A request whose JSON exceeds `MAX_BODY_CHARS` is readable in full from its overflow file |
| A4 | An inline base64 image is not in the `.jsonl` line, and is readable from its blob |
| A5 | `test_no_credential_survives_redaction` still passes |
| A6 | Deleting a day's log deletes that day's blobs |
| A7 | Depth 2 lists turns for a chat, each naming agent, gateway, style, model and mode, with counts that match the rows under them |
| A8 | Depth 3 draws all nine facts for a turn, joined from both sources |
| A9 | Depth 4 opens one message as JSON, folds every node, and keeps a summary on a folded one |
| A10 | The mode pill's computed style equals `.rex-sent` for both ASK and ACT |
| A11 | With the gateway switched on at boot, Settings shows the live port without any click |
| A12 | A gateway that fails to start shows the reason, not "Starting…" |

## 8. Out of scope

- Search across chats. The filters are per level; a full-text index is its own
  spec.
- Exporting a trace. `rex export` is where that belongs.
- Changing what the gate records, or the `read`/`write` profile split.
- LiteLLM's own admin UI. Spec 46 §17 declined it and nothing here revisits that:
  it needs Postgres, and `schema.prisma` is `provider = "postgresql"` with 61
  scalar-list fields, so SQLite is a fork rather than a connection string.

---

## 9. Where the code is

Every file this spec touches, and what changes in it. Nothing below has to be
searched for.

### 9.1 The record (§3)

| File | Change |
|:--|:--|
| `local-gateway/src/local_gateway/rex_trace.py` | all five changes in §3.1. `_row()` builds the line, `redact()` walks it, `_shrink()` caps it, `_prune()` enforces retention |
| `local-gateway/tests/` | `uv run pytest` in `local-gateway/`. `test_no_credential_survives_redaction` must keep passing untouched |

Constants that already exist in that file and matter here: `MAX_BODY_CHARS`
(200 000), `RETENTION_DAYS` (30), `MAX_TOTAL_BYTES` (256 MB), `REX_HEADERS`
(the three spec 45 headers, an allow-list), `TRAFFIC_DIR_VAR`
(`REX_TRAFFIC_DIR`), `TRAFFIC_BODIES_VAR` (`REX_TRAFFIC_BODIES`).

### 9.2 The reader — **this spec's largest omission if it is missed**

| File | Change |
|:--|:--|
| `src/main/gateway/traffic.ts` | today `threadTraffic(threadId)` reads every day file and filters on one thread, capped at `MAX_ROWS` (500). Depth 1 needs totals across **all** threads; depth 2 needs rows **grouped by run**; depth 4 needs one message out of one row. All three are new functions here |

`traffic.ts` is also where the two naming worlds meet. **The `.jsonl` is
snake_case and the IPC payload is camelCase**, and `toRow()` is the only place
that converts. The first version of the traffic sheet read `tokensIn` straight
off the line and drew every count as `—`. Any field added to the log must be
added to `TrafficLine`, to `TrafficRow`, and to `toRow`.

### 9.3 The join key (§4)

| File | Change |
|:--|:--|
| `src/main/db/schema.sql` | `run_id TEXT` on `message`, beside `sdk` / `gateway_name` / `base_url` |
| `src/main/db/migrate.ts` | a `migrateMessageRunId(db)` in the shape of `migrateMessageStyle` — `PRAGMA table_info(message)`, return false if present, else `ALTER TABLE message ADD COLUMN run_id TEXT`. Both are needed: `schema.sql` runs on every open and makes a fresh database, the migration fixes an existing one |
| `src/main/agent/bridge.ts` | the run id is minted here — `` const runId = `${Date.now().toString(36)}-${runCounter}` `` — and is the **same string** `agent-runner/src/agent_runner/attribution.py` sends as `x-rex-run`. Write it onto every `message` row the run produces |
| `src/main/db/queries.ts` | the typed query functions the new screens read |

> [!warning]
> **The join only works if both sides carry the same string.** `attribution.py`
> sends `x-rex-run: <runId>`; `rex_trace.py` files it as the row's `run`. If the
> database stores anything else — a UUID minted separately, a per-message id —
> depth 3 joins nothing and shows an empty grid rather than an error.

### 9.4 The screens (§5)

| File | Change |
|:--|:--|
| `src/renderer/overlay/TraceSheet.tsx` (669 lines) | **depth 3.** Extend: the nine-fact grid, the exchange rail, a per-message way into depth 4 |
| `src/renderer/overlay/trace.ts` (442 lines) | builds trace entries from `message` rows as data, so `node --test` can check it with no DOM. Group by run here, not in the component |
| `src/renderer/overlay/TrafficSheet.tsx` (124 lines) | absorbed by depth 2. Its `traffic` button, glyph, row and IPC stay — only the destination changes |
| `src/renderer/overlay/Settings.tsx` | §6 defects 1 and 2, and the retired-gateway notice |
| `src/renderer/overlay/App.tsx` | wiring: `openTraffic` is at ~line 487, the Settings props at ~line 4900, `refreshGateways` at ~line 457 |
| `src/renderer/overlay/overlay.css` | new classes. `.rex-sent` is the mode pill and is copied, never re-derived |
| `src/main/gateway/lifecycle.ts` | §6 defect 2 — `startBuiltinIfEnabled` swallows a late failure into the log without setting `down` |
| `src/shared/channels.ts`, `src/preload/index.ts`, `src/main/ipc.ts` | one channel per new read. The existing four are `gateway:traffic`, `…:size`, `…:clear`, `…:bodies` |

### 9.5 The design is the visual authority

`design/traffic/` holds four `.dc.html` artboards and a `canvas.json`:
`Trace.dc.html` (depth 1), `Main.dc.html` (depth 2), `Turn.dc.html` (depth 3),
`Message.dc.html` (depth 4). Open `design/traffic/rex-traffic-view.html` in a
browser to see them laid out with their notes.

**One exception, added 2026-09-11**: `Message.dc.html` draws depth 4 as a narrow
sheet, and §5.4 supersedes it — the screen is a page. Its type, colour and
spacing still hold; only the container does not.

Colours, spacing and type come from `src/renderer/overlay/overlay.css`'s token
block, not from the artboards' literals — the artboards inline the resolved
values because a `.dc.html` cannot import the stylesheet.

## 10. The rules that will bite

1. **Invariant I2 — only the main process touches SQLite and the filesystem.**
   The renderer draws; every read of `rex.db` or of the traffic log happens in
   main and crosses by `ipcRenderer.invoke`. A renderer that reads the log
   directly is the one mistake this feature invites.
2. **Invariant I3 — commands are `invoke`, agent output is `webContents.send`.**
   Defect 1 in §6 is fixed by main *sending* when the gateway becomes ready, or
   by the screen polling. It is not fixed by an HTTP endpoint.
3. **`rex_trace.py` may never raise.** A callback that throws inside LiteLLM's
   logging path fails a request that was already answered — "the traffic log is
   broken" becomes "the gateway is broken". Every new path there is inside the
   existing try.
4. **A body may be absent; it may never be wrong.** `request_body` and
   `response` are absent when capture is off, and `"(not recorded)"` is drawn
   for an absent key. An empty object is not the same thing.
5. **`~/.rex/` is outside every repository.** The database, the log and the
   blobs all live there. Nothing this spec adds is written into the repo.
6. **Python is `uv`, never `pip`.** `uv sync`, `uv add`, `uv run pytest`, each
   inside its own package.

## 11. How to build it, and how to prove it

**A fresh worktree has no `node_modules` and no `.venv`.** Before the first line
of code: `npm install`, then `npm run rebuild` (`electron-rebuild` for
`better-sqlite3`), then `uv sync` in `local-gateway/` and in `agent-runner/`.
`local-gateway/.venv` is ~456 MB.

**Take a baseline before touching anything**: `nvim-tools --json --all`. The
change must add no findings against it. `tsc`, `biome`, `ruff` and
`basedpyright` all run.

**Tests are one script per file** — `npm run test:<name>` — and there is no
`npm test`. The ones this spec touches:

| Script | Covers |
|:--|:--|
| `npm run test:traffic` | `traffic.ts` — already drives the reader against a written file |
| `npm run test:gateway` | the two gateway suites **and** `uv run pytest` in `local-gateway/` |
| `npm run test:trace` | the trace selector |
| `npm run test:settings` | the Settings screen |
| `npm run test:migrate` | the migrations |

A change on either side of the Python boundary runs both halves.

**The UI must be driven, not assumed.** `SPEC.md` §13's bar applies: launch REX,
open a document from
`~/Projects/Github/lukaskellerstein/documentation-sample`, and see the screens
work. Check `curl -s http://localhost:9334/json/version` first — an answering
port with no `pw-agent` marker is the reviewer's own REX and must not be driven.
Start your own only through `.claude/hooks/playwright-launch.sh npm run dev`.

**Seeding data to look at.** The log at `~/.rex/gateway/traffic/` holds real
rows written before this spec, in the old shape: `request_body` is a bare
messages array and `response` is a `ModelResponse(...)` string. The new reader
must not crash on them — it draws them as a row whose body is unavailable.
Criterion A1 and A2 are about rows written *after* the change.
