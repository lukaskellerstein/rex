# REX 12 — ASK and ACT

**Version:** 2.0 · 2026-08-25
**Status:** implemented. Every section is built and every automated acceptance
point passes. The visual points (§9.2, and §9.3's 13, 14, 18, 20, 21) are for the
reviewer to run against the app.

| § | What | Status |
|:--|:--|:--|
| §3 | the switch | **done** — built, typechecks, not seen against the app |
| §4 | what sending does | **done** — `npm run test:prompts`, 3 new tests |
| §5 | Apply, as a button, goes away | **done** |
| §6 | the gate refuses writes, and only writes | **done** — `npm run test:gate`, 26 tests |
| §7 | the mode on the screen | **done** — built, typechecks, not seen against the app |

**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §8.2, §8.4 and §8.7,
[`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md) §5.6,
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §5.3 and §6.5, and
[`11-powerpoint/SPEC.md`](../11-powerpoint/SPEC.md) §6.4 and §7.

> [!note]
> **Version 2 folded a second spec back into this one.** Version 1 was called
> *read and apply modes* and named the modes after what REX does. §3 to §5 were
> drafted separately and are now here, where they belong: they are what makes the
> mode a **choice**, and a spec about modes that cannot say how one is picked was
> only ever half of this. The names moved with them — **ASK** and **ACT**, after
> what the reviewer is doing.

> [!warning]
> **Nothing reaches a file until the reviewer accepts a diff.** ACT removes the
> Apply *click*, not spec 01 §8.7 step 5. The agent edits, REX diffs what it
> touched, the review bar opens, and a rejection reverts every file. That
> sequence is untouched by this spec — only what starts it changes.

---

## 1. Why

Three complaints, one shape: **REX knew things about the mode that it neither
said out loud nor let the reviewer decide.**

### 1.1 The gate refused commands that change nothing

Measured on 2026-08-25, thread `a1d3793c`, profile `read` — two of eighteen
steps were denied, both the same:

```
cd /…/docs/architecture && grep -n -i "mcp|adapter api" components.md | head -60
  → Bash is limited to read-only inspection in a read session:
    'cd' is not on the allowlist.
```

Every stage of that command reads. `grep` is allowed, `head` is allowed, the
pipe is allowed, and `&&` is allowed. `cd` is refused because nobody listed it —
and `cd` cannot write a file even in principle.

The refusal was **correct by the letter of §8.4 and wrong by its intent.** §8.4's
own comment says what the intent is: *"the danger was never the operator, it was
reaching a binary that writes or a redirect that does."* `cd` reaches neither.

And it was not one missing entry. The same session would have been refused
`sed -n '40,80p' file`, `sort`, `uniq`, `diff`, `jq`, `tree`, `2>/dev/null` and
`unzip -l deck.pptx` — nine ordinary ways of reading something. **A missing
entry fails invisibly:** an agent that cannot search the way it wanted does not
stop, it answers from the prose it already has, and §8.4 names that as the worse
failure.

### 1.2 The mode was not on the screen while it mattered

`CommentCard.tsx` drew a `READ` pill, but only on a finished answer block — so
during the run, which is when a refusal appears, nothing on screen said which
mode was running or what that mode is allowed to do. The reviewer saw `DENIED`
in red with no frame around it.

### 1.3 The mode was decided by which button you press

The only way to change a document was:

1. type what you want,
2. send it to an agent that cannot do it,
3. read a description of what it would have done,
4. press **Apply**,
5. accept the diff.

Steps 2 and 3 exist because REX had no way to be told *"this one is an
instruction, not a question."* The reviewer already knew that at step 1. They
typed it.

The switch back is worse than the switch out. A conversation that starts as a
question often ends in a change — "yes, do that". That sentence could not be
sent: the reply box always reached the read profile, so the reviewer had to stop
typing, find Apply, and let the agent infer the instruction from the transcript.

**ASK is still the right default.** Most comments on a document are questions,
and a mode that defaulted to changing files would be wrong. What was missing is
not a different default — it is a way to say otherwise, in the same gesture as
sending.

---

## 2. The two modes

| Mode | You are | The agent may | Ends with |
|:--|:--|:--|:--|
| **ASK** | asking about the document | read anything, change nothing (§6) | an answer |
| **ACT** | telling REX to change the document | read anything, and edit the documents this comment is about | a diff you accept or reject |

`Profile` in `shared/types.ts` stays `"read" | "write"`. ASK runs `read` and ACT
runs `write`, exactly as Ask and Apply do today. This spec changes **what
chooses the profile**, not what the profiles are: renaming the column would
touch the database for no gain, and `read`/`write` is the right name for the
thing the gate switches on.

`Mode` in `renderer/overlay/mode.ts` is `"ask" | "act"`.

> [!note]
> The two promises differ in KIND, and §7 must not blur them. ASK's promise is
> kept **before** the tool runs — §6, the gate. ACT's is kept **after** it runs,
> by §8.7 step 5 — the diff. Saying "ACT is safe too" without saying how would be
> a smaller claim wearing the same words.

---

## 3. The switch

### 3.1 A segmented control, not a dropdown

Two options, both always relevant, and the current one has to be readable
without opening anything — that is a segmented control. A dropdown hides the
option you did not pick behind a click, and hides the *current* one behind a
glance at a closed menu. A mode is a state, and a state should be visible.

```
┌─────────────────────────────────────────┐
│  What about these?                      │   the prompt box, unchanged
│                                         │
├─────────────────────────────────────────┤
│  (·ASK·│ ACT )  ⇧⇥        [ Change 3 ⌘↵ ]│
└─────────────────────────────────────────┘
```

- **A track with a filled thumb**, not two bordered buttons. Bordering both said
  "here are two things you may press"; what a mode control has to say first is
  "you are in this one". So the chrome belongs to the track, the unselected
  segment carries none at all, and the selected one is a SOLID pill in its
  mode's accent — the same two colours the band above the card uses (§7.1), so
  the switch and the band agree without either explaining itself. Solid rather
  than tinted, because a tint reads as "hovered" and this is the one control
  whose state changes what the next send does.
- **`⇧⇥` toggles it**, shown as plain dim text rather than a `.rex-key` cap. A
  shortcut nobody can see is a shortcut nobody uses — but beside a two-segment
  control a bordered cap reads as a third segment, which is exactly how the
  first attempt looked on screen.
- The key is `⇧⇥` rather than a modifier chord because the mode is chosen while
  typing the thing it applies to, so the gesture has to be reachable without
  leaving the home row. `⌘⇧M` was the first attempt and never fired for the
  reviewer: a letter chord has to survive the keyboard layout, the window
  manager and macOS's own reservations, and `⇧⇥` is a key the box already
  receives. The cost is that `⇧⇥` no longer walks focus backwards out of these
  two boxes; plain `⇥` still moves forward, so neither box is a trap. Every
  other modifier is excluded, so `⌥⇧⇥` and `⌘⇧⇥` still reach the window manager.
- The send button's **label** follows the mode: `Ask about 3` becomes
  `Change 3`. The button is the last thing a reviewer reads before committing,
  so it says which of the two things is about to happen.

### 3.2 Two places, one control

| Where | Default | Why |
|:--|:--|:--|
| the selection panel's foot | **ASK** | a new comment is a question until its author says otherwise |
| the comment card's reply row | the thread's last choice, **ASK** at first | this is where "yes, do that" gets typed |

The same component in both. There is one way to choose a mode in REX.

### 3.3 Remembered per thread, forgotten on restart

Held in the renderer, keyed by thread id. Sending in ACT leaves the switch on
ACT, so a run of three changes takes three sentences and no extra clicks. A new
comment always starts on ASK.

It is deliberately **not** persisted, and the argument is one-way: the state
that survives a restart should be the safe one. A thread reopened tomorrow opens
on ASK, which can only cost a click; the opposite mistake costs a diff the
reviewer was not expecting.

`threads.profile` is not the place for it either. That column records what the
*conversation* ran under, and a thread whose row said `write` would run every
later question through the write profile.

### 3.4 When ACT cannot run

`applyEnabled` and `applyDisabledReason` (spec 05 §5.6) already compute whether
this comment's documents can be edited at all — a comment on a rendered PDF page
has nothing to write to. Today they grey out the Apply button. They now grey out
the **ACT segment**, carrying the same sentence into its tooltip.

Nothing is thrown away and nothing new is computed. The reason moves to where
the choice is now made.

---

## 4. What sending does

### 4.1 ASK

Unchanged. `thread:ask` for the first send, `thread:reply` after that.

### 4.2 ACT

`thread:apply`, with one new field: **the reviewer's own text**.

```ts
interface ThreadApplyRequest {
  threadId: string;
  /** What the reviewer typed in ACT mode. Empty is not valid (§4.3). */
  note: string;
}
```

`startApply` is otherwise untouched, and that is the point of routing ACT
through it. Every protection it already performs is one ACT gets for free:

| What `startApply` does | Why ACT needs it |
|:--|:--|
| refuses dirty targets | REX must be able to tell its own change from yours |
| groups targets by repository root | a comment can span two repositories |
| runs the `write` profile per root | §6 does not apply here; §8.7 step 5 does |
| diffs only what this run introduced | a file you had already edited is not reported as REX's |
| reverts everything on failure | a half-applied comment is the one state with no button to fix it |
| routes a `.pptx` to the plan pipeline | spec 11 §7.2 — the agent never writes into a zip |

The reviewer's text is recorded as a user message first, exactly as ASK records
it, so the conversation reads as one thread and the trace shows what was asked
for. `writePrompt` then receives it as the instruction, with the transcript
before it as context.

### 4.3 The one thing ACT will not do

**ACT with an empty box does nothing.** The send button is disabled, as in ASK.

That is the deliberate loss in this spec, and it is worth naming. Today's Apply
button IS the empty-instruction case: it means "do what we just agreed" and
infers the instruction from the transcript. Removing it means the reviewer must
type something — "ok, do it" is enough, and the transcript is still sent with
it, but they must type it.

The gain is that there is exactly one gesture that changes a document, it is the
same gesture as asking a question, and what it is going to do is written on the
button.

---

## 5. Apply, as a button, goes away

| Gone | Replaced by |
|:--|:--|
| the `Apply…` button in the card's reply row | the ACT segment beside Send |
| `!answered` disabling it | nothing — see below |
| the "Apply edits A, B" line under the row | the same line, shown while ACT is selected |

**`answered` was a workaround, and dropping it is half the point of §1.3.**
Apply is disabled until the agent has answered at least once, because Apply
infers its instruction from the transcript and an empty transcript says nothing.
ACT is told what to do, so it needs no prior turn — a reviewer who already knows
what they want selects the passage, switches to ACT, types it, and sends.

Everything below the button stays: `ApplyResult`, the review bar, the changed
regions, the deck previews, `confirmApply`, and the revert.

---

## 6. The gate refuses writes, and only writes

*Implemented. `npm run test:gate` covers every rule below, including both
transcripts from §1.1 verbatim.*

### 6.1 The rule that replaces "is it on the list?"

> **A command is refused when it can change something. It is allowed when it
> cannot.**

The **mechanism** stays an allowlist, and that is a deliberate split between the
rule and the way it is kept. A denylist states the same rule and cannot enforce
it: to allow everything except known writers, REX would have to know every
program that writes, and it does not. `xsltproc -o out.xml`, `sqlite3 db "delete
…"`, `make`, and `install` all write, none is famous for it, and a denylist ships
each of them as a hole. The allowlist is the only construction under which
"cannot write" is a fact rather than a hope.

So the allowlist grows, and it grows under a stated admission test:

> **A binary joins only when there is a decidable test for "this invocation
> writes".** For `ls`, the test is trivial: it never does. For `find`, it is the
> action flags. For `git`, it is the subcommand. A binary whose write ability
> cannot be recognised from its arguments does not join, however useful it is —
> that is why `python`, `sh`, `node`, `xargs`, `env` and `make` are still absent,
> and why they always will be.

### 6.2 `cd`, which is the reported bug

`cd` joins with no guard at all.

It is a shell builtin, it changes only the working directory of the shell
running it, and each `Bash` call is a fresh shell that exits when the call
returns. There is no argument to `cd` that puts a byte on disk.

`cd X && grep …` is the form an agent writes when its own working directory is
REX's rather than the document's. §8.4 already recognised that problem once — it
is why `git -C <repo>` is matched on the binary rather than on a prefix — and
`cd` is the same problem for every other binary on the list.

### 6.3 What joins, and the guard each one needs

| Binary | Guard | Why the guard |
|:--|:--|:--|
| `cd`, `pwd` | none | changes a shell that is about to exit |
| `jq` | none | jq has no way to open a file for writing |
| `diff`, `comm`, `cut`, `tr`, `rev`, `nl`, `paste`, `fold`, `column`, `expand`, `seq`, `base64`, `od`, `xxd`, `strings`, `shasum`, `md5`, `cksum` | none | each writes to stdout only |
| `du`, `df`, `date`, `uname`, `whoami`, `hostname`, `id` | none | report, never write |
| `sort` | refuse `-o`, `--output` | `-o FILE` writes |
| `uniq` | refuse a second operand | the second positional is an output file |
| `tree` | refuse `-o`, `--output` | `-o FILE` writes |
| `yq` | refuse `-i`, `--inplace` | rewrites the file it read |
| `sed` | §6.4 | `-i` writes, and so does a `w` command |
| `awk` | §6.4 | `print > "f"` writes, `system()` runs anything |
| `unzip` | require one of `-l`, `-p`, `-v`, `-t`; refuse `-d` | anything else extracts |
| `tail` | refuse `-f`, `--follow` | not a write — it never returns, and the session waits for it. `head` needs no guard: it has no such flag |
| `rg` | refuse `--pre`, `--pre-glob`, `--hostname-bin` | `--pre=sh` hands every file to an arbitrary program |

`rg --pre` was a hole in the **previous** allowlist, not one this spec opens. It
is listed here because §6.1's admission test is what found it.

**Absent on purpose, and each for a reason worth stating:**

| Not joining | Why |
|:--|:--|
| `curl`, `wget` | `-o` and `-O` write, `-d` and `-T` send. REX already gives this agent `WebFetch` and `WebSearch` (spec 11 §6.3), which fetch without either. |
| `env` | `env FOO=1 rm -rf x` runs `rm`. It is a command *prefix*, not a command. |
| `xargs`, `parallel` | same: they exist to run something else. |
| `python`, `python3`, `node`, `ruby`, `perl`, `sh`, `bash`, `zsh` | §8.4's original write vectors. Unchanged. |
| `make`, `npm`, `sqlite3`, `install`, `plutil`, `defaults` | all write, none announces it in a flag REX can test for. |

### 6.4 The two stream tools, and how far they are trusted

`sed` and `awk` are the two binaries worth having whose write ability lives
inside a *program string* rather than in a flag. Both join, and both join
conservatively — a legitimate script may be refused, and that is the accepted
cost.

**`sed`** is refused when any word starts with `-i` or `--in-place`, when `-f`
reads a script REX has not seen, and when the script carries a `w` command:

```
/(^|[;{}\s])[wW]/                                  →  `w out.txt`, `W out.txt`
/s(.)(?:[^\\]|\\.)*?\1(?:[^\\]|\\.)*?\1[a-zA-Z]*w/ →  `s/a/b/w out.txt`
```

Both patterns over-refuse: `sed -n '/ warning/p'` matches the first, because the
`w` follows a space. The fallback is `grep`, which is already allowed, and the
refusal says so (§6.5).

**`awk`** is refused when the program text contains `>`, `|`, `system`, `close`,
`getline` or `ENVIRON`, and when `-f` reads a program REX has not seen.
`awk '{print $2}'` and `awk -F: '{n+=$1} END {print n}'` survive; anything that
reaches outside the stream does not.

Only the **program** is examined, never the file operands, and that separation is
load-bearing rather than tidy: the `w` pattern matches a `w` at the start of a
word, so checking every operand would refuse `sed 's/a/b/' words.txt` — the
FILE would be read as a script that writes. `programsOf()` finds the first
operand that is not a flag, plus whatever follows each `-e`.

> [!warning]
> The `>` inside `awk '{print > "f"}'` **survives `splitStages`**, because that
> function tracks quotes rather than ignoring them (§8.4) — the whole program is
> one word, redirect and all. `awk` joining the allowlist without this guard
> would be a plain write hole, not a theoretical one.

### 6.5 `/dev/null` and `2>&1` are not writes

`splitStages` returned null for any `>`, which refused `grep -r x . 2>/dev/null`
and `cmd 2>&1` — two forms that put nothing on disk and that an agent writes
without thinking, because everywhere else they are free.

Measured on 2026-08-25, thread `e2c37e06` — the second reported refusal, and a
different cause from §1.1's:

```
wc -l docs/architecture/*.md 2>/dev/null; wc -l LUKAS-questions.md REFERENCES.md 2>/dev/null
  → Bash in a read session may not redirect, background or substitute — '…'
```

`wc` is on the allowlist. `;` is a separator the gate already splits on. The
glob is a word like any other. **Nothing in that command was ever going to
write**, and the one construct that stopped it is the construct that exists to
throw output away.

Two redirects are recognised and allowed:

| Form | Meaning |
|:--|:--|
| `2>&1`, `1>&2`, `>&2` | joins two streams that both go to the caller |
| `>/dev/null`, `2>/dev/null`, `&>/dev/null` | discards output |

They are **consumed by `splitStages`, not passed on**: the redirect is removed
from the stage's words, so `stageDenial` sees `wc -l file` and never has to know
a redirect was there. A redirect is not an argument and must not be counted as
one — `uniq`'s guard counts operands, and a stray `2>/dev/null` left in the list
would read as an output file and deny the command for the opposite reason.

Every other redirect is refused exactly as before. `/dev/null` is matched as a
literal, complete word: `>/dev/null.txt` is a file.

### 6.6 git, where reading and writing share a name

`git branch` lists; `git branch spike` creates one. `git config --get x` reads;
`git config x y` rewrites `.git/config`. So seven subcommands carry a predicate
over their operands rather than sitting in the always-read set.

The shared shape of the first four: **a positional operand means git is being
asked to make something**, so positionals are refused unless `-l`/`--list` says
they are patterns. That over-refuses `git branch --contains HEAD`, and that is
the accepted cost of a test that fits in one line and is obviously right.

| Subcommand | Allowed when |
|:--|:--|
| `branch`, `tag` | no write flag, and no positional unless `-l`/`--list` is present |
| `stash` | the first operand is `list` or `show` |
| `worktree` | the first operand is `list` |
| `submodule` | the first operand is `status` |
| `remote` | no operand, or `-v`, `--verbose`, `show` |
| `config` | one of `--get`, `--get-all`, `--get-regexp`, `--list`, `-l` |

The write flags are **per subcommand**, and one letter is why: `git branch -a`
lists ALL branches, while `git tag -a` writes an ANNOTATED tag. A single shared
set would either refuse the first or allow the second, and the second creates an
object in the repository.

`reflog`, `merge-base`, `name-rev`, `check-ignore`, `count-objects`, `help` and
`version` join the always-read set.

### 6.7 The refusal says what to do instead

A refusal named REX's list. It should name the reviewer's document, or failing
that, the way to get the same answer:

| Command | Before | Now |
|:--|:--|:--|
| `cd …` | `'cd' is not on the allowlist` | *allowed* |
| `tee hits.txt` | `'tee' is not on the allowlist` | `tee writes a file. Read the output instead — it is returned to you` |
| `rm -rf build` | `'rm' is not on the allowlist` | `rm deletes files. Only Apply changes anything, and it shows a diff first` |
| `python -c …` | `'python' is not on the allowlist` | `python can write any file, so a read session does not run an interpreter. Use grep, rg or jq` |
| `sed -i …` | *n/a* | `sed -i rewrites the file. Drop -i and the same script prints instead` |
| an unlisted binary | `'foo' is not on the allowlist` | `REX cannot tell whether 'foo' writes, so a read session does not run it. If it only reads, say so in your answer and it can be added to the allowlist` |

The last row is the honest one, and it is the sentence the gate should have
produced all along: the refusal is REX admitting it cannot tell, not REX calling
the command dangerous.

### 6.8 `gh`, which is git's problem one level down

Measured on 2026-08-25, thread `e2c37e06` — the same thread as §6.5, and the
other half of its cost. The reviewer asked which agents the system in the
document supports, the agent went for the pull request that introduced them, and
the gate answered with §6.7's last row:

```text
gh pr view 1 --repo owner/name --json number,title,state,author,url
  → REX cannot tell whether 'gh' writes, so a read session does not run it
```

That sentence is true of `gh` and irrelevant to `gh pr view`. It is the same
shape as §6.6: `gh pr view` reads, `gh pr merge` merges, and the difference is
visible in the arguments — so §6.1's admission test is met by the **command
pair**, and by nothing shorter.

**The pair is the whole test, so the default is a refusal.** Everything that
creates, edits, closes, merges, deletes, clones, checks out, downloads or
uploads is absent by never being listed, rather than by being recognised — which
is the same reason §6.1 chose an allowlist in the first place.

| Command | Admitted pairs |
|:--|:--|
| `pr` | `view`, `list`, `diff`, `checks`, `status` |
| `issue` | `view`, `list`, `status` |
| `repo` | `view`, `list` |
| `release` | `view`, `list` |
| `run` | `view`, `list` |
| `workflow` | `view`, `list` |
| `label` | `list` |
| `search` | `code`, `commits`, `issues`, `prs`, `repos` |
| *(no subcommand)* | `gh status`, and `gh api` under the guard below |

`gh api` is the escape hatch for every question the pairs do not answer, and it
writes as readily as it reads — `-X DELETE` deletes, and a single `-f` silently
turns the request into a POST. Both are refused, which leaves the plain GET:
`gh api repos/owner/name/pulls/1`. A GraphQL query needs `-f query=…`, so
GraphQL goes with them; the REST path answers the same questions here.

Two flags are refused across every `gh` command, and neither is a write. They
are refused for the reason `tail -f` is — **the run would wait**: `--web` waits
on a browser a headless session cannot show, and `--watch` waits on a CI run
that has not finished.

`gh auth` is absent on purpose and is not an oversight. `gh auth token` prints
the user's GitHub credential straight into the transcript, and a trace is
written to `~/.rex/rex.db` and shown in the trace sheet.

> [!note]
> **A user's own aliases cannot reach through this**, which is worth stating
> because `gh alias set --shell` defines an alias whose expansion runs through
> `sh`. `gh` expands an alias only when the arguments do **not** resolve to a
> real command, and every pair above is a real command — so `gh pr view` is
> always gh's own, whatever `~/.config/gh/config.yml` holds. An alias that is
> not a real command is a pair REX has not admitted, and is refused.

---

## 7. The mode on the screen

*Implemented, with the ASK/ACT names of §2. Built and typechecking; the two
visual acceptance points have not been run against the app.*

### 7.1 A band under the head, while it runs

The mode is a **band between the card's head and the card**, drawn from the
moment a run starts rather than when it finishes.

```
├─────────────────────────────────────────┤
│ ‹ all comments                       🗑  │   ← head
├─────────────────────────────────────────┤
┃ 🛡 ASK ● cannot change any file…        │   ← the band; ┃ is the accent rule
├─────────────────────────────────────────┤
│ ④ anchored in 3 places · resolved…      │   ← the card, which scrolls
```

**A peer of the head, not a row inside the card.** The card scrolls, so a mode
drawn inside it is absent for most of a long run — and a long run is exactly
when a refusal appears. It also has to carry the weight of a *state*: the first
attempt used the panel's own `--sunk` ground and `--muted` text, and at that
weight it read as a caption on the anchor block below it, which made it look
like a note about the comment rather than something the agent is in.

- The accent is carried three times — the left rule, the shield, and the word —
  because one of them alone is a colour a reviewer stops seeing.
- **ASK** is cool (`#4d84e8` on a blue-tinted ground). **ACT** is warm
  (`#d9b23a` on `--write-bg`, the ground Apply's review bar already uses), so
  the flip is visible before the word is read.
- The promise sits beside the label in `--fg-dim`, not `--muted`: it is the half
  worth reading, and at `--muted` on a tinted ground it was the faintest thing in
  the panel.
- A **pulsing dot** appears while the agent is running. The band without it says
  what this agent MAY do; the dot says it is doing it now. The card's own
  `working…` spinner scrolls away, and this does not.

The answer block keeps no pill of its own. One card, one mode, one place.

### 7.2 In the trace sheet head

`TraceSheet.tsx` carries one line beside the totals it already shows:

```
MODE  ASK · cannot change any file, by any route
MODE  ACT · changes are shown as a diff and kept only when you accept
```

The sheet is often opened on its own and covers the card while it is up, so it
says the mode itself rather than relying on §7.1.

### 7.3 A denied block says which mode refused it

`TraceEntry.reason` already carries the gate's sentence and already opens the
block (spec 08 §6.5). It gains the frame:

```
DENIED · ASK MODE
  tee writes a file. Read the output instead — it is returned to you.
  $ rg foo src | tee hits.txt
```

`ASK MODE` beside `DENIED` is what turns a red block from "something broke" into
"the promise on the card head is being kept". That is the whole reason §7
exists, and it is why §7.1 and §7.3 ship together.

`TraceEntry.mode` is set on a `denied` block and nowhere else, from the thread's
stored profile — the only honest source, because REX records one profile per
thread and does not record a mode per message.

---

## 8. What this adds

### 8.1 Done

| File | Change |
|:--|:--|
| `src/main/agent/gate.ts` | §6 entire: the rule, the grown allowlist, the per-binary guards, the git predicates, the two safe redirects, the refusal text |
| `test/gate.spec.ts` | 8 new tests, including both §1.1 and §6.5 transcripts verbatim |
| `src/renderer/overlay/mode.ts` | **new** — `Mode`, `modeOf`, and the label and promise for each (§2) |
| `src/renderer/overlay/ModeBadge.tsx` | **new** — the band (§7.1) |
| `src/renderer/overlay/CommentCard.tsx` | the band above the card; the answer block's profile pill is gone |
| `src/renderer/overlay/TraceSheet.tsx` | the mode line (§7.2), and `DENIED · ASK MODE` (§7.3) |
| `src/renderer/overlay/trace.ts` | `TraceEntry.mode`, set on a `denied` block and nowhere else |
| `src/renderer/overlay/App.tsx` | `applyingId`, because the thread row cannot answer "is this an ACT run?" |
| `src/renderer/overlay/overlay.css` | `.rex-mode-*`, replacing `.rex-pill-profile` |
| `README.md` | the gate paragraph describes the rule, not the list |

> [!note]
> **`applyingId` is not a state that could have been derived.** ACT runs a
> `write` agent without rewriting `threads.profile`, so the stored row says
> `read` for the whole of its life — including through the one run that can
> change a file. A card that read the row would print ASK during ACT, which is
> the exact opposite of what §7 exists to do. Writing the row instead was the
> alternative and is worse: the thread's profile is what its *conversation* ran
> under, and every later reply would then inherit `write`.

### 8.2 Done in the second pass

| File | Change |
|:--|:--|
| `src/renderer/overlay/mode.ts` | `Mode` becomes `"ask" \| "act"`; labels and promises reworded |
| `src/renderer/overlay/ModeSwitch.tsx` | **new** — the segmented control (§3.1) |
| `src/renderer/overlay/SelectionPanel.tsx` | the switch in the foot; the send label follows the mode; the `read-only` badge goes, since the switch now says it |
| `src/renderer/overlay/CommentCard.tsx` | the switch in the reply row; `Apply…` removed; the multi-document line moves |
| `src/renderer/overlay/App.tsx` | `modeByThread`, `selectionMode`, and `replyToActive` routing to `thread:reply` or `thread:apply`; `applyingId` is gone, because the thread's own mode already answers what the band was asking it |
| `src/shared/channels.ts` | `ThreadApplyRequest` replaces the bare `threadId` |
| `src/preload/index.ts` | `threadApply` forwards the request |
| `src/main/ipc.ts` | `thread:apply` takes the request and records the note as a user message before the run, so the card shows it while the agent works |
| `src/main/apply.ts` | `startApply` takes the instruction; `transcriptBefore` takes that same message back out of the transcript so it is not printed twice; an empty instruction is refused as a backstop to §4.3 |
| `src/main/pptx/run.ts` | `DeckApplyInput.instruction`, so a deck is told what to do the same way |
| `src/main/agent/prompts.ts` | **`writeInstructions`** — the tail both write paths share |
| `test/prompts.spec.ts` | three tests on that tail, including the ordering rule |
| `README.md` | a "Choosing the mode" section, and the profile table in ASK/ACT terms |

No database change. No migration. `Profile` is unchanged.

### 8.3 Done in the third pass

| File | Change |
|:--|:--|
| `src/main/agent/gate.ts` | §6.8: `gh` joins the allowlist, with the pair set, the `api` guard, and the `--web` / `--watch` guard |
| `test/gate.spec.ts` | 5 new tests, including the §6.8 transcript verbatim |

Also no database change, and none to the prompts: an agent that reaches for `gh`
does so because the document names a repository, not because REX told it to.

> [!note]
> **`writeInstructions` lives in `prompts.ts` rather than in `apply.ts`, and the
> ordering is why.** The instruction goes LAST, after the discussion. A
> discussion can run to thousands of words of somebody thinking aloud, some of it
> abandoned; the instruction is one sentence that supersedes all of it, and put
> first it reads as the opening of a conversation that then changes its mind.
> That is a rule worth one home and one test, not two inlined copies that can
> drift — and the deck path in `pptx/run.ts` is the second copy it would have
> drifted from.

---

## 9. Acceptance

### 9.1 The gate (§6) — passing

1. `cd /path && grep -n x file | head -60` runs and is not denied. Thread
   `a1d3793c`, verbatim.
2. `wc -l docs/*.md 2>/dev/null; wc -l A.md B.md 2>/dev/null` runs. Thread
   `e2c37e06`, verbatim, and it also covers a glob, a `;`, and two operands
   surviving `uniq`'s operand guard.
3. `rg foo src 2>/dev/null` runs. `rg foo src > hits.txt` is denied.
4. Every write vector in `test/gate.spec.ts` is still denied: `python -c`,
   `tee`, `sh -c`, a plain redirect, `git config user.name x`, `find … -delete`.
5. `awk '{print > "f"}'` is denied and `awk '{print $2}'` is not.
6. `sed -i s/a/b/ f` is denied and `sed -n 40,80p f` is not.
7. `git branch -a` runs and `git branch spike` is denied.
8. A refusal names what the command would do, not what is on a list.
9. `gh pr view 1 --repo lukaskellerstein/my-ecommerce --json …` runs — the shape
   thread `e2c37e06` was refused. Every gh fixture names that repository, which
   exists to be tested against; no fixture names a repository REX's own test
   documents come from.
10. `gh pr merge`, `gh pr checkout`, `gh repo clone`, `gh auth token` and
    `gh api -X DELETE …` are each denied, and the refusal names `gh pr view`.
11. `npm run test:gate` passes.

### 9.2 The band (§7) — built, not yet seen

12. The band shows `ASK` from the first step of a run, before any answer exists.
13. It shows `ACT` for an ACT run, in the warm tone.
14. A denied step in the trace reads `DENIED · ASK MODE`.

### 9.3 The switch (§3 to §5) — to build

15. A fresh selection defaults to ASK. The send button reads `Ask about 3`.
16. Switching to ACT changes the button to `Change 3` and the band to `ACT`.
17. Sending in ACT with no prior answer runs the write profile and opens the
    review bar. This is the flow that is impossible today.
18. Rejecting that diff leaves every file exactly as it was.
19. In a thread whose first turn was ASK, switching to ACT and sending "ok, do
    it" produces a diff, and the write prompt contains both that sentence and
    the ASK transcript above it.
20. After an ACT send, the switch is still on ACT. Opening a different comment
    shows ASK. Restarting REX shows ASK.
21. A comment whose documents cannot be edited shows ACT greyed out, with the
    sentence `applyDisabledReason` already produces.
22. `⇧⇥` toggles the mode from inside the prompt box, without sending, and
    plain `⇥` still moves focus out of it.
23. There is no `Apply…` button anywhere.
24. `npm run test:prompts` passes.
