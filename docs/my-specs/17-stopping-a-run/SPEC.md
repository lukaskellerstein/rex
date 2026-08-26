# REX 17 — stopping a run

**Version:** 1.2 · 2026-08-26
**Status:** proposed. §3.2 and §3.4 both changed after the first build — see the
notes below.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §8.1 (one thread,
one session), §8.7 (the Apply flow) and §8.8 (the fan-out cap of five),
[`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §4.2 (an ACT send is the
only thing that changes a file), and
[`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md) §3 (the agent
edits a copy) and §7 (approve, discard, undo).

> [!note]
> **This spec adds no way to undo a change.** Spec 15 already has three, and a
> stop reaches for them rather than inventing a fourth. What it adds is a way to
> make the agent **stop working**, and a line in the conversation saying that a
> person did it.

> [!note]
> **1.2 — the stop is red.** Asked for on 2026-08-26, having lived with 1.0's
> grey: *"the signalization that I've stopped the agent could be like a red
> colour so it's more prominently visible."* 1.0 argued for grey on the grounds
> that nothing went wrong. That is true and it is not what the colour is for —
> §3.2 has the revised argument, and it is the better one.

> [!note]
> **1.1 — what the first build got wrong.** Stopping an ACT run left the
> reviewer looking at spec 15 §7.4's notice bar: *"This document was not
> changed. Nothing is final until you choose. The agent changed no files."*
> Every word of it is true and every word of it is noise. §3.4 is the fix, and
> the principle behind it is the one §2.3 already stated in the main process:
> **a stop is not a result, so nothing may report it as one.** §2.3 kept a stop
> out of the error path; §3.4 keeps it out of the verdict path.

---

## 1. Why

**A run REX has started cannot be stopped.** Measured on 2026-08-26: a comment
was sent with ASK, the card showed `working…`, and there was no control anywhere
in the app to end it. The only ways out were to wait, or to quit REX.

Three costs follow from that, and each is worse than the last:

| # | Cost |
|:--|:--|
| 1 | **Money.** A run keeps spending after the reviewer knows they do not want the answer — a wrong comment, a wrong document, a question they have just answered themselves. |
| 2 | **Time.** The card is the reviewer's only place to work, and `Send` is disabled while a thread is busy. A four-minute answer nobody wants blocks the comment for four minutes. |
| 3 | **Trust.** ACT edits files. Watching an agent work on the wrong thing with no way to interrupt it is the one moment REX asks a reviewer to accept something they cannot control. |

### 1.1 And a fourth, which is why this is not just a button

**Quitting REX is the current stop, and it is a bad one.** It kills the run
mid-tool-call, so an ACT run's working copy is left holding whatever the agent
had written when the window went away, with **no revision recorded** — spec 15
§4.2 records a revision after the run, not during it. The change is on disk, it
is not in the history, and `Undo` cannot see it.

So the stop has to be REX's own, taken at a point where REX can still finish its
book-keeping. That is §2.5, and it is most of this spec.

---

## 2. The stop

### 2.1 One controller per run, held in main

`src/main/agent/runs.ts` — a `Map<threadId, Set<AbortController>>`, and three
functions:

| Function | Does |
|:--|:--|
| `beginRun(threadId)` | makes an `AbortController`, adds it, returns it |
| `endRun(threadId, controller)` | removes it; drops the thread's entry when the set empties |
| `stopRun(threadId)` | aborts every controller the thread has, and returns how many |

A **set** rather than one controller, because a thread can have more than one
run alive at once: `startApply` runs an agent per repository (§8.7), and "Ask
all" can be firing while the reviewer opens one comment and sends a reply. Stop
means stop *this comment's* work, all of it.

It is a module-level map and not a field on anything, for the same reason
`pendingRenders` in `ipc.ts` is: it belongs to the process, nothing survives a
restart, and a run that outlives its window is not a thing REX has.

### 2.2 What the SDK is told

`runAgent` gains one input, `signal?: AbortSignal`, and passes an
`AbortController` built from it as `Options.abortController`. Verified against
the installed SDK on 2026-08-26 —
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1374`:

> Controller for cancelling the query. When aborted, the query will stop and
> clean up resources.

This is the mechanism that works with the prompt REX actually sends. The SDK's
other stop, `Query.interrupt()`, needs the streaming input mode; REX passes a
**string** prompt for every run it makes, so `interrupt()` is not reachable
without rewriting the prompt path, and rewriting it buys nothing this needs.

The abort is not instant, and the spec does not pretend otherwise: the SDK
closes the child's stdin and gives it about two seconds to shut down before the
signal reaches the process. A tool call already in flight finishes. `working…`
is therefore replaced by a **`stopping…`** state in the card, which is the
truth, and the STOPPED block lands when the run actually ends.

### 2.3 A stop is not an error

`runAgent` catches the abort by asking its own signal — `signal.aborted` —
rather than by matching the SDK's `AbortError` class. Both are true, and the
signal is the one REX owns: it cannot change under a dependency bump, and it is
already correct in the case §2.4 is about, where no error is thrown at all.

On a stop, `runAgent`:

1. writes one message — `role: system`, `kind: stopped`,
   content `You stopped this run.`, `isError: false`;
2. returns `{ ...result, stopped: true, error: null }`.

The `error: null` is the point. Every caller in REX branches on `result.error`,
and a stop that arrived as an error would be shown to the reviewer as a failure,
recorded in the debug report's error count, and — in `startApply` — thrown out of
the IPC handler as a red notice. **A stop is something the reviewer did.**
Nothing about it is a fault, and no part of REX should say it was.

`AgentRunResult` gains `stopped: boolean`. Every existing caller reads
`result.error` and is unaffected by the new field.

### 2.4 Stopping a run that has not started

Spec 01 §8.8 caps concurrent agents at five, so an "Ask all" over fourteen
comments leaves nine of them queued in `ipc.ts`'s semaphore. Those are the runs
a reviewer is most likely to want back: nothing has been spent on them yet.

The controller is registered **before** the semaphore is entered, so a queued
run is stoppable. `runAgent` then checks `signal.aborted` before it calls
`query()` at all, and takes §2.3's path having spawned nothing. A queued run
that is stopped costs zero.

### 2.5 Stopping an ACT run, and the partial working copy

This is the case §1.1 is about. Spec 15 §3 forks a working copy before the agent
starts, and the agent edits **the copy**. So when a stop lands mid-run, the copy
already holds whatever was written.

REX therefore finishes the book-keeping rather than skipping it:

1. §4.3's `putBack` runs, exactly as it does after any other run, so a file the
   agent wrote outside its working copies is restored.
2. `saveRevision` runs for every editable file, so the partial change **becomes a
   revision** — visible in the two panes, named in the diff, and reachable by
   `Undo`.
3. The loop over repositories then **breaks**: a stop means stop, and repository
   two is not started.
4. `apply:ready` fires as usual, with the partial diff.

Skipping step 2 was the tempting shortcut and it is the bug in §1.1 written a
second time: the bytes would be on disk either way, and the only difference
would be whether REX admitted it.

> [!warning]
> **A stopped ACT run leaves a real, half-finished change in the working copy.**
> That is the honest outcome and the reviewer is shown it. `Discard` throws the
> whole working copy away; `Undo` steps back one run. The reviewer's own file has
> not been touched — spec 15 §7.2 is still the only thing that writes it.

### 2.6 A deck is the exception, because nothing is written yet

Spec 11 §7.1 orders the deck flow so that the agent writes a **plan** and REX
performs it afterwards. A run stopped before the plan is complete has therefore
written nothing into the deck.

`runDeckApply` returns `null` for a stopped run instead of throwing, and
`startDeckApply` completes the apply run and fires no `apply:ready`. There is no
preview because there is no edit.

The apply run's status is set to `failed`. That word is wrong and it is used
anyway: `apply_run.status` carries a `CHECK (status IN
('pending','applied','rejected','failed'))`, and SQLite cannot widen a `CHECK`
without rebuilding the table. A migration to add the word `stopped` to a status
column nothing shows the reviewer is not worth its risk. The conversation says
what happened, in §3.2's own block, and that is where a reviewer reads it.

### 2.7 Afterwards, the thread still works

The session id is stored after a stop exactly as after any other run. A reply
then resumes it, and if the SDK cannot — an aborted turn is a turn the CLI may
not have written — §8.5's existing fallback already covers it: `sessionExists`
answers false, and REX seeds a fresh session with the thread's own transcript.
Nothing new is needed. The stop is a pause in a conversation, not the end of one.

---

## 3. What the reviewer sees

### 3.1 The button

In the open comment's card, **beside `working…`**, where the spinner already is.
That is the only place in REX that says a run is happening, so it is the only
place a reviewer looks to end one.

```text
◐ working…                                   [ Stop ]
◐ stopping…
```

It is a small secondary button, not a red one. A red button in REX means
irreversible (`Delete`), and a stop destroys nothing.

Not on the comment **row** in the list, which shows `working…` too. The row is a
single `<button>` element, a button inside a button is not valid HTML, and
splitting the row to fit one control is a change to the list spec 14 designed.
The row's `working…` stays a status word; the card is where the control is.

The row does gain one **word**, though, and it is a correction rather than a
feature. A row reports `answered` or `not asked`, and a comment whose last run
was stopped is neither: it says **`stopped`**. Leaving it at `not asked` would
be the card's own failure mode written one column to the left — REX telling the
reviewer that a thing they did never happened.

`thread:stop` returns how many runs it aborted. Zero means the run had already
finished between the paint and the click, and the reviewer is told that in the
notice line rather than being left to wonder why nothing changed.

### 3.2 The block in the conversation

A `stopped` message is a turn block of its own, with its own label:

```text
⊘ STOPPED                                        11:41
  You stopped this run.
```

**Red** — `--lost-text` on the label and the sentence, `--lost` on the rule down
its left, and the same red in the trace sheet and on the word `stopped` in the
comment list.

Version 1.0 made it grey and argued that nothing had gone wrong. Nothing had.
That is not what the colour is deciding. This block is the one thing in a
stopped thread that explains why the transcript ends in the middle of a tool
call, and a reviewer scrolling a long conversation has to be able to **find**
it. Grey is what REX uses for the things that may be skipped — `not checked
here`, a tool step, a cost line — so grey was quietly filing the answer under
"skippable".

What separates it from a failure is not its colour. It is the word `STOPPED`,
the sentence under it, and the fact that both name a person as the cause. That
distinction survives being red; being findable does not survive being grey.

It is still the answer to the question a reviewer asks a week later: *did this
break, or did I stop it?* Now they can see where to look for the answer.

Two things stay **not** red, and neither is a compromise:

| Not red | Why |
|:--|:--|
| the `Stop` **button** | It is pressed *before* anything has happened. Red on a control means irreversible — that is `Delete` — and a stop destroys nothing. |
| the run's **record** anywhere but the screen | §2.3. `kind` is `stopped` and not `error`, `isError` stays false, and the debug report's error count does not move. The colour is a signal to a reader; it is not a claim about what happened. |

`MessageKind` gains `"stopped"`. **No migration** — `message.kind` is
`TEXT NOT NULL` with no `CHECK`, which is what let every earlier kind be added
too.

Three selectors have to learn the word, and each already has a place for it:

| Where | What it does with `stopped` |
|:--|:--|
| `CommentCard.tsx` `conversation()` | keeps it, so the block appears in the card |
| `trace.ts` `traceOf` | one `STOPPED` entry, beside `ERROR` and `NOTE` |
| `transcript.ts` `renderTranscript` | `The user stopped the run here.` — a replayed conversation that silently omits the stop is a conversation with an unexplained gap in it |

### 3.3 What the card does while it waits

`busy` is unchanged: it is set by `withBusy` in `App.tsx` and cleared when the
invoke resolves, which is still what happens after a stop. The card holds one
extra piece of state — `stopping`, per thread — so the second press of the
button does nothing and the word changes. It is cleared with `busy`.

### 3.4 Nothing else reports the stop

**A stop is not a result, so nothing may report it as one.** §2.3 is that rule
in the main process, where it keeps a stop out of the error path. This is the
same rule in the renderer, where it keeps a stop out of the **verdict** path.

Measured on 2026-08-26, on this spec's own first build: an ACT run was stopped
and spec 15 §7.4's notice bar opened across the foot of the document —

```text
✎  This document was not changed.
   Nothing is final until you choose.            + WRITE PROFILE   show the diff   OK   Undo
   The agent changed no files.
   ⓘ OK keeps the change and re-runs anchoring. Comments written against the
     removed text will move or lose their anchor…
```

Every sentence is true. Every sentence is noise. The reviewer knows the document
was not changed, because they are the reason it was not: they pressed Stop one
second earlier and the card already says **STOPPED · You stopped this run.**
Worse, the bar offers `OK` and `Undo` over nothing at all, and explains at
length what `OK` would keep.

So `ApplyReadyEvent` gains **`stopped: boolean`**, and the notice is suppressed
when it is set:

```ts
const notice = event.working.length === 0 && !event.stopped ? event : null
```

Three things this deliberately does **not** do:

| Not done | Why |
|:--|:--|
| Skip `apply:ready` altogether on a stop | §4.3's `restored` notice rides that event, and a file the agent wrote outside its working copies must be reported whatever ended the run. The event still fires; only the bar is dropped. |
| Suppress a stopped run's **working copy** | §2.5. A half-written change is shown in the two panes exactly as a finished run's is. `working.length === 0` already skips the bar for it, and the panes are where it belongs. |
| Add a "the run was stopped" bar of its own | That is the same mistake with better wording. The conversation is where a comment's own history is read, and it already holds the answer. |

---

## 4. What this adds

| | |
|:--|:--|
| Dependencies | **none** |
| IPC channels | one — `thread:stop` |
| Tables | none. No migration. |
| Shapes | `MessageKind` += `"stopped"`; `AgentRunInput.signal`; `AgentRunResult.stopped`; `ApplyReadyEvent.stopped` (§3.4) |
| New files | `src/main/agent/runs.ts`, `test/runs.spec.ts` |
| Changed | `main/agent/runner.ts`, `main/agent/transcript.ts`, `main/ipc.ts`, `main/apply.ts`, `main/pptx/run.ts`, `shared/types.ts`, `shared/channels.ts`, `preload/index.ts`, `overlay/App.tsx`, `overlay/CommentCard.tsx`, `overlay/ThreadRow.tsx`, `overlay/Icons.tsx`, `overlay/trace.ts`, `overlay/TraceSheet.tsx`, `overlay/overlay.css` |
| Docs | `README.md`'s spec list, `package.json` (`test:runs`) |

Invariant I1 is untouched — no anchor is resolved anywhere new. I2 is untouched:
the controllers live in main, and the renderer sends a thread id and gets a
count. I3 is untouched: `thread:stop` is an `invoke` like every other command.

---

## 5. Acceptance

- [ ] A comment is sent with ASK. The card shows `working…` and a `Stop` button
      beside it.
- [ ] Pressing `Stop` ends the run. The card stops spinning, and the
      conversation gains a **STOPPED** block reading `You stopped this run.`
- [ ] That block is **red and easy to find** while scrolling a long thread —
      §3.2. So is the `stopped` word on the comment's row.
- [ ] The stopped run is **not** recorded as an error, whatever colour it is
      drawn in: no `ERROR` block appears, `isError` is false on the row, and the
      debug report's error count does not move.
- [ ] The comment is usable immediately afterwards — a reply is accepted, runs,
      and answers.
- [ ] `Stop` on a run that has already finished changes nothing and says so.
- [ ] **"Ask all" over more than five comments**: stopping a queued comment ends
      it before it starts, and the other comments keep running.
- [ ] An ACT run stopped mid-edit leaves the reviewer's own file **byte-identical**
      (`git status --porcelain` unchanged), and the partial change is visible in
      the working copy, in the diff, and reachable by `Undo`.
- [ ] **A stopped ACT run that wrote nothing opens no bar at all** — §3.4. The
      STOPPED block in the card is the whole report.
- [ ] A run that finished on its own and changed nothing **still** opens the
      bar, exactly as it did before this spec. Only a stop suppresses it.
- [ ] The trace sheet shows the stop as a `STOPPED` block in `seq` order.
- [ ] The comment's **row** in the list reads `stopped`, not `not asked`.
- [ ] Reopening the comment later shows the STOPPED block from the database —
      it is a row, not a UI state.
- [ ] `npm run test:runs` covers: begin/stop/end; stopping an unknown thread
      returns 0; two runs on one thread are both aborted; `endRun` after a stop
      does not leave the thread stoppable.
- [ ] `npx tsc --noEmit` is clean and `nvim-tools --json --all` adds no finding.

---

## 6. What this spec does NOT do

| Rejected | Why |
|:--|:--|
| **A global `Stop all`** in the top bar | Asked for and declined on 2026-08-26. `Ask all` is one press and a stop for it is one more; the per-comment stop is the one that was missing, and a control that ends fourteen paid runs at once deserves its own design rather than a corner of this one. `runs.ts` is written so it is a loop over the map when it is wanted. |
| **Rolling back what the agent already wrote** | Spec 15 §7 already has `Undo` and `Discard`, and they are better than anything this spec could add: they are the same two controls a reviewer uses for a run that finished and was wrong. A stop with its own private rollback would mean two answers to one question. |
| **Pause and resume** | The SDK has no pause. Simulating one means holding a half-finished turn open and hoping the session is still resumable — §2.7 shows REX cannot even promise that for a stop. |
| **A keyboard shortcut** | Every letter binding in `App.tsx` is a document or panel action. A key that ends a paid run is worth a deliberate choice about which key and what it does when several comments are running, and that choice belongs with `Stop all`. |
| **Stopping the agent mid-tool-call** | Not offered by the SDK, and not wanted: a `Write` interrupted halfway writes half a file. §2.2's grace window is the SDK letting the current call finish, and that is the safe behaviour, not a limitation to work around. |
| **A `stopped` apply status** | §2.6. It needs a table rebuild to widen a `CHECK`, and nothing shows the status to the reviewer. |
