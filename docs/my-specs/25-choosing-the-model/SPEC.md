# REX 25 — choosing the model

**Version:** 1.3 · 2026-09-03
**Changed since 1.0:**
· **1.3** — §6.4 is new: REX names the model rows itself, because the CLI's own
names stopped telling two of them apart.
· **1.2** — §7.3 moved the model name from the answer's head to its foot, where
the turns, the time and the cost already are, on the reviewer's ask. §13.5
records the top bar's picker being lost to a concurrent redesign and put back.
· **1.1** — built and driven; §11's risk resolved.

**Status:** **built, and driven in a live window.** All four milestones are done
(§10), `npm run test:models` is 16 tests green, and §11's one risk is **resolved**
— a resumed SDK session does accept a different model on a later turn, proven
against the CLI's own transcript. §13 records the two places the build departed
from version 1.0.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §8 (the agent
runner), §9 (the schema), §10 (the IPC contract);
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §5.3 (turns as
blocks), §6 (the top bar);
[`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §3.1 (the mode switch),
§3.3 (what is stored and what is not), §4 (what sending does);
[`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md) §4 (the ACT
run); [`17-stopping-a-run/SPEC.md`](../17-stopping-a-run/SPEC.md) §2.2 (the
abort controller).

> [!note]
> **Most of this already exists and nothing uses it.** `thread.model` is a
> column, it is read in four places, and it is passed to the SDK on every run
> REX makes. It has never held anything but `NULL`, and `setThreadModel` in
> `db/queries.ts` has never been called. This spec does not add a seam. It
> finishes one that was left open in spec 01 — and then moves it, because a
> model is a property of a **send**, not of a comment (§4.3).

---

## 1. Why

Every run REX makes uses whatever model the Claude CLI happens to default to.
The reviewer cannot see which one that is, and cannot change it.

The reviewer's words, 2026-08-31:

> I want to be able to select a model for each sent prompt that will be used for
> the Claude Agent SDK to give me the answer. For each as I have the input for
> the reply to this thread, I can specify the mode. I can also be able to select
> the model, like the fable five or Opus five or sonnet.

### 1.1 The choice is not a preference, it is part of the question

A review is not one kind of work. "Does this paragraph contradict the one on
page 3" is a question Haiku answers in four seconds. "Read these three specs and
tell me where the design breaks" is a question worth Fable's minutes. Today both
cost the same and take the same time, because both run on the same model.

This is the same argument spec 12 made for the mode switch, and it lands in the
same place on the screen for the same reason: the choice is made **while typing
the thing it applies to**, so it belongs beside the box, not in a preferences
window.

### 1.2 What is missing is small, and in three parts

| Part | State today |
|:--|:--|
| A model reaching the SDK | **done.** `AgentRunInput.model` → `Options.model` (`agent/runner.ts:294`) |
| A list of models to pick from | nothing |
| A way to pick one, and a record of which one ran | nothing |

---

## 2. The rule

Three sentences, and the rest of this spec is what they cost.

1. **One default, set once, stored.** Every send uses it.
2. **One dropdown, beside the mode switch.** It changes the model for the
   comment it sits in, for as long as the app is running.
3. **Every message records the model that ran it**, and the answer says so.

### 2.1 Why a dropdown, when the mode is a segmented control

Spec 12 §3.1 rejected a dropdown for the mode and the reasoning was specific to
three options: *"With exactly two options, both always relevant, there is
nothing to gain by folding them away."* There are five models today and the
number is not REX's to fix — it comes from the CLI (§3). A five-segment control
is a toolbar, and the option a reviewer wants is named, not positional.

So the model gets a button that shows the current name and opens a menu. The
mode keeps its segments. The two controls look different because they are
different: the mode is one of three states with a promise attached to each; the
model is one name out of a list that grows.

### 2.2 Why the default is app-wide and not per document

A model choice is about the kind of work, not about the file. The reviewer who
wants Sonnet for routine reviews wants it in every workspace, and the one who
escalates a hard comment to Fable escalates that comment, not that folder.
Scoping the default to a workspace would mean setting it again in each one and
would answer a question nobody asked.

### 2.3 NOTE has no model

NOTE runs nothing and spends nothing (spec 12 §2). The picker goes dim in NOTE
mode, with the mode's own promise as its tooltip — the same treatment ACT gets
when a comment has nothing to write to (spec 12 §3.4).

### 2.4 What this changes in the earlier specs

| Spec | Section | Change |
|:--|:--|:--|
| 01 | §9 (schema) | `message.model` is added. `thread.model` stops being read and stays in place (§4.3) |
| 01 | §10 (IPC) | `thread:ask` takes a second argument; `thread:reply` and `thread:apply` take a field; two new channels (§6) |
| 08 | §5.3 (turns as blocks) | An agent block can carry a model name beside its label (§7.3) |
| 08 | §6 (the top bar) | One more control: the default model (§7.2) |
| 12 | §3.3 (what is stored) | Its rule is **kept and extended**, not broken. The per-comment model lives in the renderer and is deliberately not persisted, for the same reason the mode is not. What IS persisted is the model a message already ran on, which is a different fact (§5) |

---

## 3. The list comes from the SDK

REX does not hold a list of model names. It asks.

### 3.1 The call, and the answer it gives

`Query.supportedModels(): Promise<ModelInfo[]>` —
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2516`.

Run on this machine on 2026-08-31, it answered in **946 ms** with five rows:

| `value` | `displayName` | `description` |
|:--|:--|:--|
| `default` | Default (recommended) | Opus 5 with 1M context · Best for everyday, complex tasks |
| `opus[1m]` | Opus (1M context) | Opus 5 with 1M context · Best for everyday, complex tasks |
| `claude-fable-5[1m]` | Fable | Fable 5 · Most capable for your hardest and longest-running tasks |
| `sonnet` | Sonnet | Sonnet 5 · Efficient for routine tasks |
| `haiku` | Haiku | Haiku 4.5 · Fastest for quick answers |

`value` is the string `Options.model` takes. `displayName` is the button's
label. `description` is its tooltip. REX writes none of them.

This is the whole argument for asking rather than hardcoding, and it is not
about tidiness:

- The list is **this account's**. If Fable needs usage credits the account does
  not have, the CLI's list is the one that knows.
- The list is **this CLI version's**. A model released next month appears with
  no change to REX, and a retired one disappears before it can be sent.
- A hardcoded `claude-opus-5` would be a string REX asserts and cannot check. A
  wrong one fails **inside a run the reviewer has already paid to start.**

> [!warning]
> **The second bullet is not quite true, and 2026-09-03 is how that was found.**
> The list is the account's. It is *not* a promise that the bundled binary can
> run every row: picking **Fable 5.1** failed with *"400 Claude Code 2.1.237
> does not support this model; version 2.1.251 or newer is required"*, from a
> row the CLI itself had just offered.
>
> Two facts sit behind it. The SDK **ships and resolves its own Claude Code**,
> so this machine's own 2.1.259 was irrelevant — and so is the API's advice to
> run `claude update`. And a model's floor is known only to the API, which
> reports it as a 400 at run time; nothing in the list carries it.
>
> So REX cannot filter the list, and must not try — a table of floors would be
> the hardcoding this section exists to refuse, and it would rot the same way.
> What it can do is **name the failure properly when it arrives**, which is
> `MODEL_NEEDS_NEWER_CLI` in `runner.ts`: it says which version is running,
> which is needed, that `claude update` will not help, and that the thing to
> update is REX's own `@anthropic-ai/claude-agent-sdk`.

### 3.2 How to hold a `Query` without sending a prompt

`supportedModels()` is a method on the `Query` object, and `query()` needs a
prompt. It also accepts an `AsyncIterable<SDKUserMessage>` instead of a string
— so a generator that never yields starts the CLI, completes the handshake, and
sends the model nothing:

```ts
async function* silent(): AsyncGenerator<never> {
  await new Promise(() => {});
}
const q = query({ prompt: silent(), options: { abortController, cwd } });
const models = await q.supportedModels();
abortController.abort();
```

No user message is ever sent, so **no tokens are spent**. The cost is one CLI
process for about a second, once per app run.

### 3.3 Once per app run, and never on the reviewer's time

`src/main/agent/models.ts` holds a module-level promise. The first caller starts
the probe; every later caller gets the same answer. Main starts it when the
window is created, so it has resolved long before a reviewer has selected any
text.

### 3.4 When the probe fails

A ten-second timeout, and then one row: `default`, labelled `Default`. The
picker draws it dim and its tooltip is the reason.

**No static list of model ids as a fallback.** A stale id is worse than no
choice, because it is sent and rejected inside a run. And a probe that cannot
answer means the CLI cannot start, which means no run would have worked anyway
— the picker is not the thing that is broken.

---

## 4. What a send carries

### 4.1 The model is an argument

Every send names its model explicitly. Main never looks one up.

| Channel | Change |
|:--|:--|
| `thread:ask` | `threadAsk(threadId, model)` — a second argument, because the channel takes a bare id today and a request object for two fields buys nothing |
| `thread:reply` | `model: string \| null` on `ThreadReplyRequest` |
| `thread:apply` | `model: string \| null` on `ThreadApplyRequest` |
| `thread:note` | shares `ThreadReplyRequest` and always sends `null`. §2.3 |

`null` means "REX said nothing, so the SDK decides" — the value every run has
carried since spec 01. It stays legal, and it is what a NOTE and an old
transcript both hold.

### 4.2 What main does with it

1. Record the reviewer's message with `mode` **and** `model`.
2. Pass the model to `runTurn`, `runDeckApply`, `runDocxApply`, and the write
   run in `apply.ts`.
3. Stamp every message that run produces with the same value (§5.1).

### 4.3 `thread.model` stops being read

Four call sites read it today: `ipc.ts:256`, and `apply.ts` at 494, 647 and 761.
All four take the value from the send instead.

The column stays in `schema.sql`, unread, with a comment saying so. This is what
spec 05 did with `thread.anchor_json` and the reason is the same: dropping a
column rewrites the table, and a half-finished rewrite of somebody's comments is
not worth the tidiness.

`setThreadModel` in `db/queries.ts:651` is **deleted**. It has never had a
caller, and leaving a function that writes an unread column is worse than
leaving the column.

> **Why an argument and not a stored field.** A field on the comment would make
> "which model runs this" a piece of mutable state that every send has to set
> before it runs and no send owns. It reads as a setting and behaves as an
> argument. Two runs on one comment — an ACT started while an ASK is still
> streaming — would be one another's model. An argument cannot have that bug.

---

## 5. What is recorded

`message.model TEXT` — the model this row came from.

| Row | Value |
|:--|:--|
| The reviewer's ASK or ACT | what they picked |
| Everything that run produced — answers, tool calls, errors, the completion | the same value |
| A NOTE | `NULL` |
| Anything written before this spec | `NULL` |

`NULL` is honest: "nobody recorded it". It is not "the default", and nothing may
draw it as one.

### 5.1 The requested name, not the resolved one

The stored value is what the reviewer picked — `sonnet`, or `default`. Not the
wire id the CLI resolves it to, which the `system: init` event carries and
`runner.ts:332` already logs.

The reason is that the record has to be readable a month later, and reading it
means mapping it back to a display name through the list in §3. `default` maps
to *Default*, which is the true answer to "what did I pick". Resolving it to
`claude-opus-5[1m]` would record something the reviewer never chose and could
not have chosen — and would silently rewrite itself the day the default moves.

### 5.2 The migration

`migrateMessageModel` — one `ALTER TABLE message ADD COLUMN model TEXT`, guarded
by a column check, beside the migrations already in `db/migrate.ts`. Existing
rows get `NULL`, which §5 already defines.

---

## 6. The default, and where it lives

### 6.1 A `setting` table

```sql
CREATE TABLE IF NOT EXISTS setting (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
```

One row: `model.default`. Absent means `default`, the SDK's own first row.

REX has one store and this is a fact about REX, so it goes in the store. A JSON
file beside the database would be a second thing to find, back up and keep in
step, for one string.

The table is general on purpose — it is a key and a value, and it will hold the
next such fact without another migration. It is **not** a settings system:
nothing reads a key that is not named in a spec.

### 6.2 If the stored default is no longer in the list

The CLI updates, a model retires, and `model.default` names something that is
not there any more. REX falls back to `default`, keeps the stored row, and says
so once in the picker's tooltip.

Keeping the row matters: the model may come back — an account that ran out of
credits gets more — and silently rewriting the reviewer's choice would mean they
never learn it stopped being honoured.

### 6.3 Two channels

| Channel | Returns |
|:--|:--|
| `model:list` | `{ models: ModelChoice[]; chosen: string; error: string \| null }` |
| `model:default` | sets `model.default`. `void` |

`chosen` is the default after §6.2 has been applied, so the renderer never has
to reason about a missing row. `error` is §3.4's sentence, or `null`.

`ModelChoice` is REX's own shape — `value`, `displayName`, `description` — and
not the SDK's `ModelInfo`. `src/shared/` may not import from `main/` (spec 01
§3.1), and the SDK is main's dependency; restating three fields is the price of
that boundary, and it means the effort levels and fast-mode flags in `ModelInfo`
never reach a renderer that has no use for them.

### 6.4 REX names the rows, because the CLI's names collided

Spec 1.0 said `displayName` is the button's label and REX writes none of it.
That held for a week. On **2026-09-03** the reviewer's list came back with two
rows both called `Fable`:

| `value` | `resolvedModel` | `displayName` | `description` |
|:--|:--|:--|:--|
| `claude-fable-5[1m]` | `claude-fable-5` | Fable | Fable 5 · Most capable… |
| `claude-fable-5-1[1m]` | `claude-fable-5-1` | **Fable** | **Fable 5** · Most capable… |

Both prose fields are identical, and the second one's is wrong — it says
"Fable 5" about Fable 5.1. **Only the id differs.** His words: *"I suppose one
is Fable 5 and the second one is Fable 5.1 but the naming in the dropdown should
clearly show me this. Can we fix this naming and include the version perhaps and
the context length if the name of the model provides this?"*

This is not a bug in the CLI. `displayName` is a **family** name, and it is
right for a menu showing one row per family. It becomes REX's problem the moment
two rows of one family are offered at once — and REX holds the field that
settles it, so REX builds the name.

**The rule, and its limits.** The id is parsed and only what it actually carries
is shown:

| Row | Reads |
|:--|:--|
| `claude-fable-5[1m]` | `Fable 5 (1M)` |
| `claude-fable-5-1[1m]` | `Fable 5.1 (1M)` |
| `opus[1m]` → `claude-opus-5[1m]` | `Opus 5 (1M)` |
| `sonnet` → `claude-sonnet-5` | `Sonnet 5` |
| `haiku` → `claude-haiku-4-5-20251001` | `Haiku 4.5` |
| `default` → `claude-opus-5[1m]` | `Default (recommended)` — unchanged |

Four decisions inside that:

- **An id that does not parse keeps the CLI's name.** Nothing is invented for a
  naming scheme REX has not seen. §3.1's argument, applied to labels.
- **A dated snapshot is not a version.** Only one- and two-digit segments are
  taken, so `claude-haiku-4-5-20251001` is `Haiku 4.5` and not
  `Haiku 4.5.20251001`, which names nothing a person would recognise.
- **`default` keeps its own name, and this is the subtle one.** It resolves to
  `claude-opus-5[1m]`, which parses — so the first draft named it `Opus 5 (1M)`
  and produced *two* rows reading exactly that. Its own test caught it. An alias
  may borrow its resolution's name (`sonnet` is the family word of
  `claude-sonnet-5`); a **choice** may not, because what `default` resolves to
  today is not what it means, and the label would be wrong the day the CLI's
  default moves.
- **The wire id is appended to every tooltip.** The CLI's sentence said
  "Fable 5" for both Fable rows, so the tooltip needs a field that cannot be
  stale.

#### The guarantee, which does not depend on the parser

After naming, any two rows that still read the same **both get their id
appended** — `Thing 9 (1M) · thing[1m]`. A parser cannot promise to tell every
future pair apart; a uniqueness pass can, because `value` is the key the CLI
itself keys on and is unique by construction.

That is the property worth stating plainly: **no two rows in the menu can ever
read the same.** The parser makes the names good; the second pass makes them
distinct.

---

## 7. What the reviewer sees

### 7.1 The composer

The reply row and the selection panel's foot both grow one control, between the
mode switch and the send button:

```text
[ ASK | ACT | NOTE ]  ⇧⇥        ⌄ Sonnet            [ Send ]
```

- The label is the `displayName` of the model this comment will use.
- Clicking it opens a `.rex-menu-right` — the button-opened menu the tree
  already uses (`overlay.css:585`). One row per model, `description` as the
  tooltip, a tick beside the current one.
- The row for the app-wide default reads `Default — Opus (1M context)`, so
  picking "the default" and picking "Opus" are visibly different acts.
- Dim in NOTE mode (§2.3).

There is no keyboard chord. ⇧⇥ belongs to the mode and a second chord on a box
that is being typed into has to earn its place; this one has not been asked for.

### 7.2 The top bar sets the default

Beside the cost pill, which is the other thing up there that is about the run
rather than the document. The same menu, and picking from it writes
`model.default`.

The button always shows a name, so the answer to "what will this cost me" is on
screen without opening anything.

### 7.3 The answer says which model wrote it, in its own foot

The name goes in the answer's **footer** — the line that already carries how
many turns, how long and what it cost:

```text
Haiku · 5 turns · 4.9s · $0.219
```

First in the line, and one step brighter than the numbers (`--muted` against
their `--faint`, weight 600). Order and brightness are the whole treatment.

**No pill, and no colour.** A pill in REX means the mode the reviewer picked
(spec 12 §7.1) and a colour means one of spec 18's seven facts. Borrowing
either would spend a word from a vocabulary that is already saying something
else, to add emphasis that ordering alone can give.

**Every** answer carries the line, not only the last. The numbers are the
thread's total and belong to the answer that finished it; the model is
per-turn — and a thread whose turns ran on two models is exactly the thread
that has to say so. An answer with a model and no numbers shows the name alone.

Only when the message has a `model`. A `NULL` draws nothing, which is what every
transcript written before this spec gets (§5).

The reviewer's own turn does not repeat it. The pair reads `YOU ASK` above and
`Haiku · …` below, and putting the name on both would say it twice for one send.

> This was version 1.0's one visible mistake. It put the name in the answer's
> **head**, beside `ANSWER`, where it was a fourth thing in a row that already
> names the speaker, the mode and the time. The reviewer asked for it on
> 2026-09-01: *"maybe not in the top bar but in the bottom bar, where we have
> how many terms, how many minutes, and how much the price was"*. The head names
> the speaker; the foot says what the speaking cost, and the model is one of
> those facts.

---

## 8. Where the code goes

| File | Change |
|:--|:--|
| `src/main/agent/models.ts` | **new.** §3 — the promptless probe, the cache, the timeout, the fallback row |
| `src/main/db/settings.ts` | **new.** `getSetting` / `setSetting`, and `defaultModel(db, models)` for §6.2 |
| `src/main/db/schema.sql` | the `setting` table; `message.model`; the comment retiring `thread.model` |
| `src/main/db/migrate.ts` | `migrateMessageModel` (§5.2). The `setting` table needs none — `CREATE TABLE IF NOT EXISTS` covers it |
| `src/main/db/queries.ts` | `model` on `MessageDraft` and the insert; `model` read back on `Message`; **delete** `setThreadModel`, and `Thread.model` with it (§13.4) |
| `src/main/agent/runner.ts` | §13.3 — `DEFAULT_MODEL` means "say nothing", so the option is omitted |
| `src/main/debug.ts` | `lastModel` — the report's model line, from the messages (§13.4) |
| `src/main/ipc.ts` | two handlers; the model threaded through `runTurn`, `recordUserText` and `record` |
| `src/main/apply.ts` | the model as an argument at the three run sites, in place of `thread.model` |
| `src/shared/types.ts` | `ModelChoice`, `ModelList`; `model` on `Message` |
| `src/shared/channels.ts` | `model:list`, `model:default`, their payloads, the three send-channel changes |
| `src/preload/index.ts` | two lines |
| `src/renderer/overlay/ModelPick.tsx` | **new.** The button and its menu, used by all three surfaces |
| `src/renderer/overlay/App.tsx` | `modelByThread`, mirroring `modeByThread`; the list fetched once; the default passed down |
| `src/renderer/overlay/CommentCard.tsx` | the control in the reply row; the name on an agent block |
| `src/renderer/overlay/SelectionPanel.tsx` | the control in the foot |
| `src/renderer/overlay/TopBar.tsx` | the default (§7.2) |
| `src/renderer/overlay/overlay.css` | the button; a reuse of `.rex-menu-right` |
| `test/models.spec.ts` | **new.** §10 milestone 0 |

---

## 9. What this does not do

| Not doing | Why |
|:--|:--|
| **Effort levels** (`low` … `max`) | `ModelInfo` carries `supportsEffort` and the levels, so the data is right there and it is tempting. It is a second axis with its own vocabulary, and nobody asked for it. It gets its own spec if it is wanted |
| **Fast mode**, adaptive thinking, auto mode | The same. Three more flags in `ModelInfo`, three more decisions, no request |
| **A different model for ASK and for ACT** | Plausible — reading is cheaper than writing — but it doubles the control to save a click, and the per-comment pick already covers the case |
| **A model for subagents** | `Options.agents` takes one per subagent. REX does not configure subagents at all today |
| **Cost or speed shown per model** | The cost pill already reports what was actually spent, after the fact and exactly. A per-model estimate before the run would be a guess printed next to a measurement |
| **Changing the model of a run that is already going** | A run has one model. Stop it (spec 17) and send again |

---

## 10. Milestones

| # | Ends in | Acceptance | Status |
|:--|:--|:--|:--|
| **0** | The list, the setting, the column — all testable alone | `test/models.spec.ts` green under `node --test`: the probe returns rows against the real CLI and spends nothing; a failed probe returns exactly the fallback row and an error sentence; `model.default` round-trips; a stored default missing from the list resolves to `default` and keeps its row; `migrateMessageModel` adds the column to a database made before it and is a no-op on one made after | **done** — 7 tests, the probe answering in 585 ms |
| **1** | A model reaches the SDK | Send an ASK with a model picked, and check what the SDK actually ran on — not what REX recorded | **done** — §10.2 |
| **2** | The three surfaces | The picker in the reply row, the panel foot and the top bar; the tick, the tooltips, the dim in NOTE; the name on the agent block; the default persisting across a restart | **done** |
| **3** | The live run, §10.1 | | **done** |

### 10.1 How milestone 3 is checked

In `~/Projects/Github/lukaskellerstein/my-ecommerce`, opened as the workspace.
Per `rules/06-testing.md`: check port 9334 first, and if it answers without the
`pw-agent` marker it is the reviewer's own window — use an isolated instance
(`REX_DB_PATH`, `REX_WORK_PATH`, `REX_CDP_PORT=9444`).

1. Set the top bar's default to **Sonnet**. Comment on a passage and **ASK**.
   Done when the answer block reads `REX · Sonnet` and the log agrees.
2. **In the same comment**, change the dropdown to **Haiku** and reply. Done
   when the second answer reads `REX · Haiku` and the first still reads
   `REX · Sonnet`. **This is the test that matters** — it is the one that proves
   a resumed SDK session accepts a different model on a later turn (§11).
3. Open a second comment. Done when its dropdown reads Sonnet, not Haiku: the
   pick belongs to the comment, the default belongs to REX.
4. Restart. Done when the default is still Sonnet and every comment's dropdown
   is back to it.
5. Switch to NOTE. Done when the picker is dim and the saved note's row has
   `model IS NULL`.

Run on 2026-08-31 against an isolated instance — port 9334 was answering
**without** the `pw-agent` marker, so it was the reviewer's own window and was
neither driven nor touched. `REX_DB_PATH`, `REX_WORK_PATH` and
`REX_CDP_PORT=9444` on a two-paragraph scratch workspace, driven by
`playwright-core` over CDP (the Playwright MCP is pinned to 9334). All five
steps passed.

### 10.2 How "a model reaches the SDK" was actually checked

**Not from REX's own records**, which is the whole point: REX stores what the
reviewer picked, so reading it back proves only that REX can remember. The
proof is the CLI's own transcript, `~/.claude/projects/<slug>/<session>.jsonl`,
whose `message.model` is written by the SDK and not by REX.

`[rex] agent init · model=…` in `runner.ts` is a `console.log`, so it goes to
the main process's stdout and **not** to `~/.rex/rex.log`. A detached run has
nowhere to show it. The transcript is the better source anyway — it carries one
model per turn, which is exactly the question §11 asks.

---

## 11. The one risk — resolved

**A thread resumes one SDK session across turns** (`runner.ts` —
`resume: sessionId`). Changing the model on turn 3 of a resumed session was the
one thing in this spec that was not proven, and the failure would have been
quiet: the run succeeds on the session's original model while REX's own record
says otherwise (§5.1), so no error appears anywhere.

**It holds.** One comment, one session id, two turns, on 2026-08-31:

```text
models, in order, in the ONE resumed session:
  0  claude-sonnet-5
  1  claude-haiku-4-5-20251001
  2  claude-haiku-4-5-20251001
```

REX's rows for the same two turns read `sonnet` then `haiku`. The stored value
and the wire model agree, so §5.1's decision to record the reviewer's word
stands and nothing has to be revisited.

---

## 12. Rejected

| Rejected | Why |
|:--|:--|
| **A hardcoded list of model ids** | §3.1. It is a claim REX cannot check, it rots, and it fails inside a paid run rather than in the picker |
| **A hardcoded list as the fallback when the probe fails** | §3.4. Same failure, arriving later and looking like it works |
| **Keeping `thread.model` and writing it before each send** | §4.3. It turns an argument into mutable state and gives two concurrent runs on one comment each other's model |
| **A settings window** | One string does not need a window, and the choice is made while typing the prompt it applies to (§1.1) |
| **A JSON file for the default** | §6.1. A second store for one string |
| **The model on the reviewer's turn instead of the answer** | The reviewer knows what they picked — they picked it a second ago. The question a transcript has to answer is which model *wrote this* |
| **Recording the resolved wire id** | §5.1. It records something the reviewer never chose, and it rewrites itself when the default moves |
| **A segmented control, like the mode** | §2.1. Five options and growing is a toolbar, not a switch |
| **A keyboard chord for the model** | §7.1. ⇧⇥ is the mode's, and a second chord inside a text box has to be asked for |
| **Per-workspace defaults** | §2.2. It answers a question nobody asked and has to be set again in every folder |

---

## 13. Where the build departed from version 1.0

### 13.1 The answer's label is `ANSWER`, not `REX` — and the name left it

§7.3 drew the model beside a `REX` label. There is no such label: spec 08 §5.3
calls the agent's block `ANSWER`, and the four voices are `YOU`, `ANSWER`,
`NOTE`, `STOPPED`.

It went beside `ANSWER` for a day and then moved out of the head entirely —
§7.3 as it now stands. Version 1.0 was wrong about the place, not about the
fact.

### 13.2 The menu has to know which way to grow

1.0 said the picker opens a menu and left the direction unsaid, which meant
downward. The composer's copy sits at the **bottom** of the panel, so downward
put the entire menu below the window's edge: the button opened something nobody
could see, which is the worst way for a control to fail. Found in the live run.

`ModelPick` measures the button on the press and grows upward when it is in the
lower half of the window (`.rex-modelmenu-up`). On the press and not on render,
because the panel is resizable and the composer moves with the length of the
conversation above it.

### 13.3 `default` is recorded but never sent

Less a departure than a gap 1.0 left. `default` is a value the CLI advertises,
REX stores it, and §5.1 requires the record to keep the reviewer's own word —
but passing `model: "default"` to the SDK would be REX asserting something it
does not mean. The runner omits the option when the model is `DEFAULT_MODEL`,
which is exactly what every run did before this spec.

### 13.4 `Thread.model` went, not just its readers

§4.3 said the column would stop being read and stay in place. It does. But the
`model` field on the `Thread` **type** was going to be left as well, and a field
nothing reads is dead code by `rules/09-code-quality.md`. It is gone from
`shared/types.ts`, from `toThread`, from `ThreadRow` and from the `INSERT`.

That moved one thing the spec did not mention: `debug.ts` printed
`thread.model`. It now prints the model of the most recent message that has one
(`lastModel`), which is a better answer anyway — a comment whose turns ran on
two models never had a single one to print.

### 13.5 The top bar's picker was lost to a concurrent redesign

Between the build and the reviewer's first look, another session rewrote
`TopBar.tsx`: the cost pill and `Ask all` left the bar, and §7.2's picker went
with them — its props were dropped from the component and from `App.tsx`'s call.
The two composer pickers and everything behind them were untouched, so the
feature still worked; there was simply no way left to set the default.

It is back, and in a better place than 1.0 chose. §7.2 anchored it to the cost
pill as "the other run-shaped thing up here", and that anchor no longer exists.
The bar now ends with the debug button, which its own comment describes as the
boundary — *"everything to its left acts on the document under review; this one
acts on REX itself"*. A default model is a fact about REX, and it must be
settable with no document open, so it belongs on that side. It sits immediately
before the bug.

The lesson is not about the layout. Several sessions edit this tree at once, so
**a control can be removed by a change that never mentions it** — and nothing
fails, because the state and the IPC behind it are still there. Re-check your
own surfaces in a live window after any session that touched the same files.
