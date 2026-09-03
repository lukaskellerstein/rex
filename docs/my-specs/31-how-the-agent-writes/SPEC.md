# REX 31 — how the agent writes

**Version:** 1.2 · 2026-09-02 — §5 reversed on the reviewer's ask: the style
IS drawn on the answer, beside the model.
**Status:** **built, and driven in a live window.** Milestones 0–2 are done and
milestone 3 is half done — ASK and ACT were driven, the DOCX and PPTX plan runs
share the same single door and were not (§10.2). `npm run test:models` is 9
tests green. §12 records the four places the build departed from version 1.0,
one of them a bug this spec would have shipped silently.
**Depends on:** [`25-choosing-the-model/SPEC.md`](../25-choosing-the-model/SPEC.md)
— all of it. This spec is that one's sibling and reuses its every part: the
probe (§3), the picker (§7.1), the per-send argument (§4), the `setting` table
(§6.1) and the `message` column (§5). Also
[`01-initial/SPEC.md`](../01-initial/SPEC.md) §8.6 (the system prompts) and
§8.4 (the deny gate); [`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §2
(the three modes).

> [!note]
> **Spec 25 decided one thing this spec decides the other way.** There, the
> model is an argument and is deliberately not stored on the comment (§4.3), and
> the per-comment pick lives in the renderer and resets on restart (§5). Here,
> the style **is** stored on the comment and survives a restart. §2.1 is the
> whole reason, and it is not an inconsistency: the two facts differ in what
> they are about.

---

## 1. Why

The model decides how good an answer is and what it costs. Nothing decides how
it **reads**.

Claude Code has output styles — `Concise`, `Explanatory`, `Learning`, and any
`.md` file a person drops in `~/.claude/output-styles/`. Every REX run has
silently used the CLI's default since spec 01, and the reviewer has never been
asked.

The reviewer's words, 2026-09-02:

> As we can define the model, can we also define output style for the agent?

And, on where it belongs:

> add it next to the model drop-down, but remember the choice for the chat.

> I think every mode should have the output style. I mean act and ask. If I'm
> using Claude Code and setting output style, it applies to everything.

### 1.1 What is missing is almost nothing

Spec 25 built the machinery and this spec spends it:

| Part | State |
|:--|:--|
| Asking the CLI what exists | **the same call already answers it** — §3.1 |
| A picker component | `ModelPick` is already a list of named things |
| A per-send argument on three channels | the shape is `model`'s, exactly |
| A column recording what ran | `message.model`'s neighbour |

What is genuinely new is one column on `thread`, and the reason for it (§2.1).

---

## 2. The rule

1. **The style belongs to the chat, and it is stored.** Set it on a comment and
   every later message in that comment uses it — today, and after a restart.
2. **It sits beside the model**, in the comment card's reply row and in the
   selection panel's foot.
3. **It applies to every mode.** ASK, ACT, and the plan runs a deck and a
   `.docx` use. Claude Code applies a style to everything a session does, and
   REX is not the place to invent an exception.

### 2.1 Why this is stored and the model is not

Spec 25 §4.3 refused to keep the model on the comment, and §5 kept the
per-comment pick in the renderer where a restart clears it. Both were right, and
neither argument reaches the style.

| | The model | The style |
|:--|:--|:--|
| What it is about | what one **send** is worth | how this **chat** reads |
| Is there a safe value to fall back to? | yes — spec 12's rule, inherited: what survives a restart should be the value that costs least surprise, and §6 gives it an app-wide default to return to | **no.** A style cannot make anything unsafe or expensive. Falling back is not caution, it is forgetting |
| Can two sends on one comment differ? | yes, and that is the feature | they can, but the reviewer asked for the opposite: *"remembered for the whole chat until I change my mind"* |
| Where it lives | an argument, plus a renderer-side memory | `thread.style`, plus the same argument |

A chat outlives a restart. Renderer state does not. So "remembered for the whole
chat" and "kept in the renderer" are not the same promise, and the reviewer
asked for the first one.

**The send still carries it explicitly.** The column is memory for the next time
the composer is painted, not the source main reads at run time — that is spec 25
§4.3's rule and it still holds: a field read at run time is mutable state no send
owns, and two runs on one comment would take each other's.

### 2.2 There is no app-wide default style

The reviewer ruled it out — *"not per application"* — so there is no `setting`
row and nothing in the top bar.

A new comment starts at the CLI's own `default`, and the **selection panel keeps
its own last pick** for the session, so a reviewer who sets the panel to
`Concise` gets `Concise` on the next comment they make, and the one after. That
is the same session-scoped convenience the model already has (spec 25 §7.1); it
is not an application setting and nothing writes it to disk.

If that turns out to be too little memory, an app-wide default is one row in the
`setting` table and half an hour. It is deliberately not in 1.0.

### 2.3 ACT gets a style too

A first draft of this spec proposed ASK-only, on the grounds that a file edit's
shape is not a matter of taste. The reviewer overruled it, and the reason given
is the right one: in Claude Code a style applies to everything, so an exception
here would be REX inventing a rule the reviewer would then have to remember.

What that costs is in §9 — `Learning` writes `TODO(human)` markers, and on an
ACT run those land in the working copy. The reviewer sees them in the diff
before anything is kept (spec 01 §8.7 step 5), so the cost is a wasted run, not
a damaged document.

---

## 3. The list comes from the SDK

As with models (spec 25 §3), REX holds no list of style names. It asks.

### 3.1 One probe, not two

`Query.initializationResult(): Promise<SDKControlInitializeResponse>` —
`sdk.d.ts:3723`. It carries **both** lists:

```text
initializationResult() in 566ms
output_style           : default
available_output_styles: [ 'default', 'Proactive', 'Concise', 'Explanatory', 'Learning' ]
keys                   : commands, agents, output_style, available_output_styles,
                         models, account, pid, current_permission_mode, …
```

Run on this machine on 2026-09-02, through the same promptless stream spec 25
§3.2 uses: **no user message is sent, so no tokens are spent.**

`models` is the same `ModelInfo[]` that `supportedModels()` returns, so this
call **replaces** it. REX ends up with one probe where spec 25 had one and this
spec would have added a second — the app spawns one CLI process at startup, not
two, and the model list and the style list can never disagree about which
session they came from.

### 3.2 The list depends on the working directory — and it does not matter

This is the one place the two lists differ. Models are the account's. Styles come
from three places:

| Where | Scope |
|:--|:--|
| built in | everywhere |
| `~/.claude/output-styles/*.md` | everywhere, for this person |
| `<project>/.claude/output-styles/*.md` | that project only |

REX probes once, in the scratch directory, so it offers the first two and never
the third. That is a limit (§9) and it is also what makes the simple design
**safe**: every value the probe returns is valid in every working directory, so
a style picked on one comment cannot fail on another comment in a different
repository.

The alternative — a probe per working directory, cached by cwd — is a real
option and costs a CLI process per repository. It is not worth it until somebody
has a repo-local style they want.

### 3.3 When the probe fails

Spec 25 §3.4, unchanged: one row, `default`, and the sentence saying why. No
invented names.

---

## 4. What a send carries

`style: string | null`, beside `model`, on the same channels:

| Channel | Change |
|:--|:--|
| `thread:ask` | a third argument |
| `thread:reply` | a field on `ThreadReplyRequest` |
| `thread:apply` | a field on `ThreadApplyRequest` |
| `thread:note` | shares `ThreadReplyRequest` and always sends `null` — a note runs nothing |

`null` means "REX says nothing, so the CLI decides", which is what every run has
done since spec 01.

### 4.1 What main does with it

1. Write it to `thread.style` — the chat remembers (§2.1).
2. Record it on the reviewer's message and on everything the run produces (§5).
3. Pass it to `runAgent`, which is the single door every run goes through.

---

## 5. What is recorded

`message.style TEXT`, exactly like `message.model` (spec 25 §5): the style this
row ran under, as the reviewer picked it. `NULL` for a note, and for every row
written before this column existed.

**It is drawn on the answer, beside the model**, in the same register:

```text
Default (recommended) · Concise · 6 turns · 26.1s · $0.651
```

Version 1.0 recorded it and drew it nowhere, reasoning that a fifth item in the
foot earns less than it costs. The reviewer asked for it on 2026-09-02 — *"in
the same way as we are showing in the answer what model answered, we should also
show what style output was used"* — and he is right about which items are which.
The model and the style are **one fact in two words**: what produced this
answer. The numbers after them are what it cost. Reading the style as a fifth
number was the mistake.

So it takes the model's exact treatment — `--muted`, weight 600 — and not a
quieter one. A quieter one would say it is the lesser fact, and it is not: the
same answer from the same model in a different style is a different answer.

`default` is drawn like any other name. It is a real answer to "which style was
used", and hiding it would make a line that appears and disappears depending on
a value the reviewer cannot otherwise see.

The debug report prints it too (§8), which is what a `NULL` row and a
pre-spec-31 transcript still need.

`migrateMessageStyle` and `migrateThreadStyle` — two guarded `ALTER TABLE`s
beside the ones already in `db/migrate.ts`.

---

## 6. Where it reaches the SDK

`Options.settings` takes a whole `Settings` object, and `Settings.outputStyle`
is one of its fields (`sdk.d.ts:7020`). One line in `runner.ts`:

```ts
...(input.style && input.style !== DEFAULT_STYLE ? { settings: { outputStyle: input.style } } : {}),
```

`DEFAULT_STYLE` is omitted rather than sent, for spec 25 §5.1's reason:
`default` is a value REX **records** because the reviewer picked it, and it
MEANS "REX says nothing". Saying nothing is how that is said to the SDK.

Every run — ASK, ACT, deck, `.docx` — goes through `runAgent`, so this is the
only place it is needed.

### 6.1 What it does to REX's own system prompt

An output style replaces part of Claude Code's default system prompt. REX passes
`systemPrompt: { type: "preset", preset: "claude_code", append: … }`, and the
append is REX's whole contract with the agent (spec 01 §8.6).

The two should compose, because they are about different things: REX's prompts
say **what the job is** — answer this comment, you cannot write, make the
smallest change — and a style says **how to write**. They share no sentence.

It is still the one thing in this spec that is not proven, and it is milestone 1
(§10). If the append does not survive, this spec is wrong and the fix is to stop
using the preset and build the prompt REX wants by hand.

### 6.2 The gate does not move

Spec 01 §8.4's read guarantee is a `PreToolUse` hook, not a sentence in a
prompt. **No output style can make an ASK agent write a file**, whatever it
says. That is worth stating because a style is arbitrary text from a `.md` file,
and the honest answer to "what if it tells the agent to write" is that the gate
does not read it.

---

## 7. What the reviewer sees

### 7.1 Two buttons, side by side

The reviewer asked for it *"next to the model drop-down"*, and that is where it
goes — a second `ModelPick`, in the comment card's reply row and in the
selection panel's foot:

```text
[ ASK | ACT | NOTE ]  ⇧⇥            ⌄ Sonnet  ⌄ Concise   [ Send ]
```

**It fits.** The row already wraps at two controls, and `.rex-row-end` keeps the
group together when it does: measured on 2026-09-01, the mode switch is 179px
and the right-hand group 179px in a 356px row. A third button of about 70px puts
the group at ~255px — still one line, just a wider second one. Nothing wraps
that was not already wrapping.

### 7.2 Nothing in the top bar

There is no app-wide default (§2.2), so there is nothing up there to set. The
model's picker stays where spec 25 §13.5 put it.

### 7.3 The tick, and what `default` reads as

The menu is spec 25 §7.1's, minus the `Default — …` row: that row exists because
a model pick can *follow* an app-wide default, and a style has none to follow.
`default` is an ordinary row like the others, and it is what a new comment shows.

---

## 8. Where the code goes

| File | Change |
|:--|:--|
| `src/main/agent/models.ts` | §3.1 — `initializationResult()` replaces `supportedModels()`, and the probe returns styles as well. The file is renamed `agent/capabilities.ts`: it is not about models any more |
| `src/main/db/schema.sql` | `thread.style`, `message.style` |
| `src/main/db/migrate.ts` | `migrateThreadStyle`, `migrateMessageStyle` |
| `src/main/db/queries.ts` | `style` on `Thread`, `ThreadRow`, `MessageDraft`, `MessageRow` and both inserts; `setThreadStyle` |
| `src/main/agent/runner.ts` | §6 — one spread, and the `agent init` line moves to `log.ts` so a live run can be checked (§10) |
| `src/main/ipc.ts` | `style` threaded through the four sends, exactly as `model` is |
| `src/main/apply.ts` | `style` on `ApplyOptions`, and to the three run sites |
| `src/main/debug.ts` | the style beside the model in the RUN block |
| `src/shared/types.ts` | `StyleChoice` (or `ModelChoice` reused), `styles` on `ModelList`, `style` on `Thread` and `Message`, `DEFAULT_STYLE` |
| `src/shared/channels.ts` | `style` on the three requests and on `threadAsk` |
| `src/preload/index.ts` | one argument |
| `src/renderer/overlay/ModelPick.tsx` | `allowDefault={false}` is already a prop; nothing else changes |
| `src/renderer/overlay/App.tsx` | `styleByThread` seeded from `thread.style`, `selectionStyle`, the sends |
| `src/renderer/overlay/CommentCard.tsx`, `SelectionPanel.tsx` | the second picker |
| `test/models.spec.ts` | extended — the probe now answers both, so one suite covers both |

---

## 9. What this does not do

| Not doing | Why |
|:--|:--|
| **Repo-local styles** | §3.2. One probe, in one directory, and every value it returns is valid everywhere. A per-cwd cache is the fix and nobody has asked for it |
| **An app-wide default style** | §2.2. The reviewer ruled it out. One `setting` row if he changes his mind |
| **A style per message** | §2.1. He asked for the opposite in the same sentence |
| **Protecting ACT from `Learning`** | §2.3. The reviewer chose parity with Claude Code, and the diff gate is what stops a bad run reaching the document |
| **Writing output styles** | REX picks from what the CLI offers. A style is a `.md` file and its home is `~/.claude/output-styles/` |

---

## 10. Milestones

| # | Ends in | Acceptance | Status |
|:--|:--|:--|:--|
| **0** | One probe, two lists, two columns | `test/models.spec.ts` green: the probe returns models **and** styles and spends nothing; a failed probe returns exactly one row of each and an error sentence; both migrations add their column to a database made before them and are no-ops after | **done** — 9 tests |
| **1** | A style reaches the SDK, provably | §10.1 — the `system: init` event's own `output_style`, in `~/.rex/rex.log` | **done** — `init · model=claude-opus-5[1m] · style=Concise` |
| **2** | The two pickers, and the memory | The style beside the model in both surfaces; picked on a comment it holds for the next reply; **and it is still there after a restart**, which is the whole of §2.1 | **done** |
| **3** | Every mode | An ACT run and a `.docx` plan run under the picked style, not the CLI's default | **half** — ACT driven; DOCX not (§10.2) |

### 10.1 How milestone 1 is checked

Spec 25 §10.2 found that `[rex] agent init · model=…` is a `console.log`, so it
reaches the terminal and never `~/.rex/rex.log` — which is why that spec had to
read the CLI's own transcript instead. The transcript records the model per
turn; it does **not** record the output style.

So this milestone starts by moving that line to `log.ts`, and adding
`event.output_style` to it. Then the check is one line of the isolated run's own
log:

```text
agent init · model=claude-sonnet-5 · style=Concise · tools=… · plugins=…
```

`output_style` on the init event (`sdk.d.ts:4778`) is what the CLI **resolved**,
not what REX asked for, so a style REX sent and the CLI ignored shows up as a
disagreement rather than as a silent pass.

**It earned its keep on the first run.** The line read `style=default` while
the picker said `Concise`, which is exactly the silent pass this milestone
exists to catch — §12.1.

### 10.2 What was driven, and what was not

On 2026-09-02, against an isolated instance: port 9334 was answering **without**
the `pw-agent` marker, so it was the reviewer's own window and was neither
driven nor touched. `REX_DB_PATH`, `REX_WORK_PATH` and `REX_CDP_PORT=9444` on a
two-paragraph scratch workspace, driven by `playwright-core` over CDP.

| Checked | How |
|:--|:--|
| ASK under a style | `init · model=claude-opus-5[1m] · style=Concise`, and `Concise` on all seven rows of the turn |
| The chat remembers it | a reply with the picker untouched ran under `Concise` too, and `thread.style` reads `Concise` |
| **It survives a restart** | the app was killed and started again on the same database; the reopened comment's picker still read `Concise`. This is §2.1's whole claim and the one spec 25's design would have lost |
| ACT under a style | `style=Concise` on the write run, with a `diff` row to show it really edited |
| §6.1 — the append survives | every one of those runs answered the comment and obeyed REX's own instructions while writing in the picked style. The two compose |

**Not driven: the DOCX and PPTX plan runs.** They pass `style` into the same
`runAgent` call as everything else — one line, type-checked — but no live run
was made. The honest reason is that this machine's only Word files are the
reviewer's own (`test/docx.spec.ts` names them), and CLAUDE.md requires
confirmation before a write agent is pointed at a real document. A fixture would
have been the wrong answer to that: the value of milestone 3 is the live path,
and a document REX's author chose is the one kind that cannot surprise it.

---

## 11. Rejected

| Rejected | Why |
|:--|:--|
| **A hardcoded list of style names** | Spec 25 §3.1's argument, unchanged. It rots, and a custom style in `~/.claude/output-styles/` would never appear |
| **A second probe for styles** | §3.1. One call already carries both, and two would let the lists disagree about which session they came from |
| **Keeping `supportedModels()` and adding `initializationResult()`** | The same. Two CLI processes at startup, for one answer |
| **A style per send, like the model** | §2.1. The reviewer asked for the chat to remember it, and a chat outlives a restart |
| **Renderer state, like the model's per-comment pick** | §2.1. It would forget on restart, and forgetting is exactly what he asked it not to do |
| **An app-wide default, in the top bar** | §2.2. *"not per application"* |
| **ASK only** | §2.3. In Claude Code a style applies to everything, and an exception here is a rule the reviewer would have to remember |
| **Folding this into spec 25** | It decides §2.1 the other way, and a spec that says both "never store this on the comment" and "always store this on the comment" about two neighbouring fields is a spec nobody can read. The reviewer asked for a new one |
| **A third row in the composer** | §7.1. Two buttons fit beside `Send` on the line that already wraps — measured, and then seen |

---

## 12. Where the build departed from version 1.0

### 12.1 The style reached the preload bridge and stopped

The first live run said `style=default` while the picker said `Concise`. Every
layer was right except one line:

```ts
threadAsk: (threadId, model) => ipcRenderer.invoke(COMMAND.threadAsk, threadId, model),
```

`RexApi` declares `threadAsk(threadId, model, style)`, and **TypeScript accepts
a shorter function for a longer signature** — a function that ignores trailing
arguments is assignable. So the third argument was dropped in the one file whose
whole job is to forward it, `tsc` said nothing, and main received `undefined`.

Two things follow, and the second is the general one:

- The bridge now spells out every argument, with a comment saying why.
- **A typed IPC surface does not prove the bridge forwards anything.** Spec 25
  added an argument to this same channel and got away with it because it was
  the *last* one; this spec added one after it and did not. Any future argument
  on a positional channel has to be checked at the far end, not at the type.

The check that caught it is §10.1's log line, which this spec added an hour
earlier for exactly this reason: it prints what the CLI **resolved**, so a
setting that never arrived is visible instead of silent.

### 12.2 `model` and `style` travel as one

1.0 described a `style` argument beside the existing `model` one. Spec 25 had
threaded `model` through five signatures in `ipc.ts` — `systemNote`, `backstop`,
`runTurn`, `recordUserText` and the stamping in `record` — and a second
parameter beside it in all five would have been the moment to notice they are
one thing.

`SendChoices { model, style }` in `shared/types.ts` is that one thing. The
signatures took a field instead of a parameter, the stamping became
`{ ...draft, ...choices }`, and a third such setting — effort, say — now costs
nothing to add.

### 12.3 The style is drawn after all

§5 and §11 both said it would not be. Reversed on the reviewer's ask the same
day, and the reasoning in §5 is what changed: "a fifth item in a line of
numbers" was the wrong way to count it. The model and the style are one fact,
the numbers are another, and the foot now reads as those two groups.

The rejected row is gone from §11 rather than left with a note. A "rejected"
table is a list of decisions that still hold; a reversed one belongs in its own
section, which is this one.

### 12.4 The picker needed a row-builder, not a new component

§8 said `ModelPick` would need nothing. Almost true: a style is a bare string
and the picker draws `ModelChoice` rows, so `styleRows()` in `ModelPick.tsx`
turns one into the other. Its description is deliberately about the control
rather than the style — REX has never read the reviewer's `.md` files and has
no business summarising them.
