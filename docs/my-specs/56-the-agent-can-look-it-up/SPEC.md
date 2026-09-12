# REX 56 — the agent can look it up

**Version:** 1.0 · 2026-09-11
**Status:** **built, and driven live.** A real ASK on the Codex adapter, with
REX's own read system prompt and a prompt in `askPrompt`'s shape, fetched
`https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents`
through a local `qwen/qwen3.8-27b`, read its `<h1>`, confirmed the document's
"(2026-01)" against the page's "Published Jan 09, 2026", and noticed that
`milestone` appears nowhere on it — which is a real review finding about the
document. The same run was told to write `PROBE.md` into the reviewer's
repository and could not. §8 is the transcript.
**Depends on:** [`44-the-codex-agent/SPEC.md`](../44-the-codex-agent/SPEC.md)
§9 (the sandbox is the primary boundary, and why),
[`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §6 (the gate, and a
refusal that says what the command would do),
[`01-initial/SPEC.md`](../01-initial/SPEC.md) §8.4 (a read session cannot
change any file),
[`50-macos-completely/SPEC.md`](../50-macos-completely/SPEC.md) §3.2
(`RunRequest.readable`, the twin of `writable`).

## 1. What this is

A reviewer highlighted a glossary table in `concepts.md` and wrote *"What is
it?"*. Two lines above the table the document cites **Anthropic's *Demystifying
evals for AI agents* (2026-01)**. The agent read the file, read the neighbouring
`README.md`, searched the repository, and then tried to open that citation. It
could not, and REX ended the run with a refusal. Seven steps and one minute ten
seconds produced no answer at all.

> The reviewer, 2026-09-11: *"we really need the Codex to explain how it can
> search stuff. Even in ask mode he has to be able to search on the internet.
> That's for sure."*

Checking a citation is the ordinary work of reviewing a document. REX's own read
prompt has told the agent to do it since spec 01 §8.6 — *"You may also search
and fetch the web to check a claim the document makes"* — and for the Codex
adapter that sentence has never been true.

**This spec makes it true**, for every route, and without giving up §8.4's
guarantee that a read session cannot change a file the reviewer owns.

## 2. What was measured, before anything was designed

Every number here was taken on this machine on 2026-09-11, against
`codex-cli 0.147.0` and `openai-codex` 0.147.0. §8 is the full record. Four
findings shaped the design, and three of them closed a door.

### 2.1 Codex's own `web_search` is a hosted tool, so a local model cannot run it

REX sets `web_search: "disabled"` on every run. Turning it to `live` adds
exactly one thing to the request:

```json
{ "type": "web_search", "external_web_access": true }
```

No parameters and no schema. **The model's own endpoint executes it.** OpenAI's
does. A local one does not, and the failure is silent: LM Studio accepted the
tool, dropped it, and `qwen/qwen3.8-27b` then wrote a counterfeit tool call into
its answer as plain prose —

```text
{"tool": "web_search", "query": "Anthropic \"Demystifying evals for AI agents\""}
<tool_call>
None
```

— with HTTP 200 and no error anywhere. So `live` is right for the `Original`
route and is actively harmful on a routed one. **The switch is per route, never
global.**

### 2.2 A read-only sandbox has no network, and no option to add one

`network_access` exists only under `sandbox_workspace_write`. Setting it beside
`sandbox_mode = "read-only"` is ignored. Measured under `codex sandbox`:

| Sandbox | cwd write | repo write | repo read | network |
|:--|:--|:--|:--|:--|
| `read-only` | blocked | blocked | allowed | **blocked (000)** |
| `read-only` + `network_access=true` | blocked | blocked | allowed | **blocked (000)** |

This is the `000 network-unavailable` the failing run recorded at step 6.

### 2.3 `cwd` is writable under `workspace-write` whatever else is said

Spec 44 measured this on 2026-09-04 and it still holds. Naming a writable root
elsewhere does **not** suppress it:

| Sandbox | cwd | cwd write | repo write | network |
|:--|:--|:--|:--|:--|
| `workspace-write`, `writable_roots: []` | the repository | ALLOWED | **ALLOWED** | allowed |
| `workspace-write`, `writable_roots: [scratch]` | the repository | ALLOWED | **ALLOWED** | allowed |
| `workspace-write`, `writable_roots: []` | an empty throwaway | ALLOWED | blocked | allowed |

So network for an ASK is only reachable by **moving the child's working
directory off anything the reviewer owns**. That is not a new idea in this
repository: `RunRequest.writable` already carries the rule in its own words —
*"An adapter whose SDK makes `cwd` writable must therefore move the child's
working directory, not widen the list"* — and spec 44 §9.3 already moves it for
ACT. This spec applies the same rule to ASK.

### 2.4 Moving `cwd` costs the agent nothing it had

The worry was that an agent whose working directory is a scratch folder can no
longer explore the repository. Measured, with `cwd` on the throwaway:

```text
cd into repo:    ok
write after cd:  blocked
read after cd:   allowed
grep after cd:   3 files found
```

`cd` at runtime does not widen the sandbox: the writable set is fixed when the
child is spawned. Reads were never restricted by either mode. And `cd` has been
on the gate's read-only list since spec 12 §6.2, added for exactly this reason —
*"`cd X && grep …` is the form an agent writes when its own working directory is
REX's rather than the document's"*.

## 3. What is decided

Five changes. Three give the agent the web, two stop REX throwing away the
answer once it has it.

| # | Change | Where |
|:--|:--|:--|
| 1 | An ASK runs `workspace-write` with `network_access: true`, `writable_roots: []`, and `cwd` on a per-run throwaway | `adapters/codex/adapter.py` |
| 2 | `web_search` is `live` on the `Original` route and `disabled` on a routed one | `adapters/codex/adapter.py` |
| 3 | The gate allows `curl` in its reading forms and refuses the writing and sending ones | `src/main/agent/gate.ts` |
| 4 | A refusal no longer ends a Codex run | `adapters/codex/adapter.py` |
| 5 | The read prompt names the repository root, and says how to reach the web | `src/main/agent/prompts.ts` |

### 3.1 The ASK sandbox

```python
Sandbox.workspace_write, {
    "sandbox_workspace_write": {
        "writable_roots": [],
        "network_access": True,
        "exclude_slash_tmp": True,
        "exclude_tmpdir_env_var": True,
    }
}, <throwaway>
```

The throwaway is `~/.rex/work/ask/<run_id>/`, created empty before the child
starts and removed when the run ends. It is the **only** writable path in the
run, and it holds nothing: a file written there is a scratch file the agent made
and nobody reads.

`exclude_slash_tmp` and `exclude_tmpdir_env_var` are carried over from ACT for
the same reason spec 44 gives them — a reviewer whose workspace sits under
`/tmp` would otherwise have it inside the sandbox.

**§8.4 still holds and is now enforced in two places.** The sandbox blocks every
write outside the throwaway, and the gate refuses a writing command before it
runs. §8.3 is the proof.

### 3.2 `web_search` per route

`route.base_url` is the whole test, and it is the same test `_provider` already
makes. No URL means Codex's own endpoint on the reviewer's own `codex login`,
where the hosted tool works. A URL means a gateway in front of some other model,
where §2.1 says it produces counterfeit prose.

REX already maps a `webSearch` item to the `fetch` common tool (spec 44 §8), so
the trace draws it with no further work.

### 3.3 `curl`, in its reading forms only

`curl` joins the read-only list with a guard, in the shape spec 12 §6.5 already
uses for `sort -o` and `tree -o`. Refused:

| Refused | Because |
|:--|:--|
| `-o`, `-O`, `--output`, `--output-dir`, `--remote-name`, `--create-dirs` | writes the response to a file |
| `-d`, `--data*`, `-F`, `--form*`, `-T`, `--upload-file` | sends a body |
| `-X`/`--request` with anything but `GET` or `HEAD` | any other method changes the far side |
| `-D`, `--dump-header`, `-c`, `--cookie-jar`, `--trace*` | writes a file that is not the response |
| `-K`, `--config` | reads the flags from a file REX cannot see |

Everything else reads a page and returns it on stdout, which is what the read
prompt has always asked for. `wget` stays refused: it writes what it downloads
by default, so its reading form is the unusual one.

**This is not a new class of access.** The Claude adapter has had `WebFetch` in a
read session since spec 01, and the gate has always allowed it (`test/gate.spec.ts`).
A GET can carry data out in its query string whatever tool issues it, so Codex
gaining `curl` matches a door that has been open on another adapter all along.
§7 states the risk plainly rather than hiding it.

### 3.4 A refusal stops the command, not the run

Today `_judge` returns a refusal, the adapter interrupts the turn, and the
refusal becomes the run's error. That is what cost the reviewer the answer: six
successful steps were discarded because the seventh was denied.

Spec 44 §9.2 already says why that is the wrong trade for this adapter — **the
sandbox is the primary boundary, and it has already refused the action by the
time REX sees it.** Ending the turn therefore buys no safety at all. It only
loses the work.

So: the denial is recorded and emitted, the trace draws it, and the turn
continues. `RunResult.denials` is unchanged, so every caller that counts
refusals still counts them.

**Unchanged:** `validate()` still refuses a run before it starts, and a stop
still stops. This is only about a tool call denied mid-turn.

### 3.5 The prompt

Two sentences, because §3.1 moved the working directory and §3.3 changed what is
reachable:

- The repository root by absolute path, so an agent whose `cwd` is a scratch
  folder knows where the document's repository is.
- How to fetch a page, said in the common vocabulary rather than one SDK's tool
  name. The existing text promises `WebFetch`, which only the Claude adapter
  has.

## 4. What is NOT decided

- **ACT keeps `network_access: False`.** Spec 44's sentence stands: a document
  edit needs no network. Nothing here changes it.
- **No search engine.** `curl` fetches a URL the agent already has, which is what
  checking a citation needs. A query-to-results search on a routed model would
  need a search API and a key, and §12 of `SPEC.md` has no room for one.
- **The other three adapters are untouched.** Claude has `WebFetch` and always
  worked. OpenCode and Deep Agents are out of scope and keep today's behaviour.

## 5. Acceptance

- [x] `codex sandbox` proves the rows of §2.3 and the four lines of §2.4. §7.
- [x] An ASK on the Codex adapter, on a routed local model, fetches a URL and
      quotes it in the answer. §8.
- [x] The same run cannot write into the reviewer's repository, the working
      copies, `~/.rex`, or the home directory. §7 and §8.
- [x] The document's repository is untouched afterwards (`SPEC.md` §8.4): zero
      files in it changed during the run, `PROBE.md` was never created, and the
      throwaway was removed.
- [x] `npm run test:gate` (35), `npm run test:prompts` (24) and
      `npm run test:library` (396 pytest) pass.
- [x] `nvim-tools --json --all` adds no finding against the baseline: the same
      six files, the same counts, every tool `ok`.
- [ ] **Not yet proved live: §3.4.** A denied command inside a real run drawing
      in the trace while the run answers is unit-tested (`_judge` records,
      emits, and returns nothing) and has not been watched in a window. The
      live run above was driven with a permissive policy, because what it was
      measuring was the sandbox.

## 6. Risks

- **Data can leave the machine in a URL.** Any web access has this property,
  including the `WebFetch` the Claude adapter has always had. It is the price of
  the feature the reviewer asked for, and it is stated here rather than hidden.
- **A prompt injection in a document can now reach the network on Codex.** The
  document is untrusted content by invariant I2. The mitigations are the ones
  REX already has: the frame tags (spec 54) tell the model that document text is
  data, the gate refuses a sending command, and the trace shows every fetch.
- **The throwaway is writable.** It holds nothing and is removed at the end of
  the run. Nothing reads what an agent leaves there.

## 7. The measurements, in full

Recorded under `codex sandbox`, which runs one command inside the real sandbox.
`repo` is `~/Projects/Github/lukaskellerstein/ai-evaluation`.

```text
### read-only  (what REX does today)
cwd-write: blocked   repo-write: blocked   repo-read: allowed   network: blocked (000)

### read-only + network_access=true
cwd-write: blocked   repo-write: blocked   repo-read: allowed   network: blocked (000)

### workspace-write, writable_roots=[], cwd = the repository
cwd-write: ALLOWED   repo-write: ALLOWED   repo-read: allowed   network: ALLOWED (200)

### workspace-write, writable_roots=[scratch], cwd = the repository
cwd-write: ALLOWED   repo-write: ALLOWED   repo-read: allowed   network: ALLOWED (200)

### workspace-write, writable_roots=[], cwd = an empty throwaway   <- chosen
cwd-write: ALLOWED   repo-write: blocked   repo-read: allowed   network: ALLOWED (200)
```

With `cwd` on a throwaway under `~/.rex/work/`, what sits around it:

```text
cwd:               ALLOWED
work parent:       blocked
another doc copy:  blocked
~/.rex:            blocked
home:              blocked
read a doc copy:   allowed
network:           200
```

And after changing directory at runtime:

```text
cd into repo:    ok
write after cd:  blocked
read after cd:   allowed
grep after cd:   3 files found
```

## 8. The live run

REX's own read system prompt, dumped from `prompts.ts`, and a user prompt in
`askPrompt`'s shape naming the same document and the same passage as thread
`ef3df7aa`. Spec 50 §1 is why: *a proof that does not use REX's own prompt is
not a proof of REX.* The model is `qwen/qwen3.8-27b` through LM Studio's
Responses surface, which is the routed case — the one §3.2 keeps `web_search`
off for.

The comment asked two things: fetch the citation, and then try to write into
the repository.

What the agent did, in order:

1. `sed -n '100,160p'` on the document, then `grep -i demystif` on it.
2. `cd` into the repository and `grep -rn` for the URL. Found none, and said so.
3. `curl -sL --max-time 20 https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents`
   — **HTTP 200**.
4. `curl … -o /tmp/anthropic_page.html` — failed, exit 56. The agent read the
   failure correctly: *"likely because the sandbox refused the write to `/tmp`"*.
   `exclude_slash_tmp` doing exactly what §3.1 keeps it for.
5. Re-fetched through a pipe instead, and took the `<h1>`.
6. `echo "probe" > …/ai-evaluation/PROBE.md` — the file was never created.

Its answer:

```text
- URL: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
  (HTTP 200, no redirect; the canonical link matches this URL). Note the
  document itself at …/concepts.md:124 cites only the title and date — no URL
  appears anywhere in the repo (I grepped).
- First heading: the page has exactly one <h1> and it reads "Demystifying evals
  for AI agents".
- It is the right article: the live page contains `grader` (94x), `pass@k`
  (10x), `eval suite` (8x), `trajectory` (2x), and is stamped "Published Jan 09,
  2026" — matching the document's "(2026-01)". One nuance: `milestone` appears
  0x on the page, consistent with the document's own caveat "extended where it
  does not" — that row is the author's addition, not Anthropic's.
```

The last sentence is the point of the whole spec. It is a fact about the
reviewer's document that no amount of reading the repository could produce.

And the boundary, measured after the run:

```text
error:                          None
denials:                        []
duration:                       240453 ms
throwaway removed:              True
PROBE.md in the repository:     False
files changed in the repository: 0
```
