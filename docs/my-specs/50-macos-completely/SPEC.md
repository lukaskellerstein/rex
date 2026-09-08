# Spec 50 — macOS, completely

**Status: in progress.** Two parts that serve one sentence: *every agent, in
both modes, works — and the repository says which machine that is true on.*

## 1. What this is

REX claimed three operating systems and delivered holes in two of them. Codex
and OpenCode both refuse ACT anywhere but macOS, and a Deep Agents ASK could
not read the document at all. A claim with holes in it is worse than a smaller
claim that is true, because the holes are found by the reviewer rather than by
us.

So: **REX supports macOS.** Windows and Linux support is removed — the builds,
the installers, the platform branches and the claim. What those three days of
VM work measured is written down in §5 rather than deleted, because the facts
cost more than the code did.

And the one thing that was actually broken is fixed: §3.

## 2. What was decided, and why

| Decision | Choice | Why |
|:--|:--|:--|
| Platforms | **macOS only** | The reviewer's words: "I would rather have one defined operation system and have the repo say, hey we are working fully on macOS, and that will be true" |
| Windows and Linux code | **deleted**, not merely unbuilt | Dead branches are read as supported. Git history keeps them, and §5 keeps the findings |
| The ASK bug | fixed with a **new field on the pipe**, `readable` | The host already knows the folders; it just never sent them. §3 |
| `sandbox_available()` | **kept** | It also checks that `/usr/bin/sandbox-exec` really is there. That is a runtime fact on macOS, not a platform claim |
| Signing and notarisation | still not configured | Unchanged by this spec. Its own job |

### 2.1 What a reader is now entitled to assume

| Agent | ASK | ACT |
|:--|:--|:--|
| Claude Agent SDK | yes | yes |
| Codex | yes | yes |
| OpenCode | yes | yes |
| Deep Agents | yes | yes |

Sixteen cells, no footnotes. That is the whole point of the spec.

## 3. Part A — `readable`, and the Deep Agents ASK

### 3.1 The bug

Measured 2026-09-08, through the app, on `one/sample-document.md`. A Deep
Agents ASK answered:

> my attempt to read the file `/Users/…/.rex/work/aac60eaa-…/sample-document.md`
> failed with a "not found" error

The file was there, 8302 bytes. Three facts meet:

1. **REX's ASK prompt names the working copy by absolute path.**
   `prompts.ts:720` writes `Read it at: ${primaryCopy}`, and spec 34 §7 is why:
   the copy IS the current version, so an ASK is pointed at it on every turn.
2. **The copy lives outside `cwd`** — `~/.rex/work/<documentId>/`, while `cwd`
   is the reviewer's repository.
3. **`for_ask()` built a virtual backend** — `FilesystemBackend(root_dir=cwd,
   virtual_mode=True)`. LangChain's reference is explicit: under `virtual_mode`
   every path is anchored to `root_dir` and an absolute path outside it is
   blocked.

So the read was refused for a file that exists, and the refusal reached the
reviewer as "not found".

**This is spec 48 §8.2's finding, in the half of the adapter it was not applied
to.** §8.2 recorded that a virtual backend re-roots an absolute path inside
itself, and fixed ACT. ASK was left virtual and has the same defect.

**Why 42 green end-to-end checks missed it.** Spec 48 §12.6 drives the service
with its own prompt, which names paths inside `cwd`. REX's real `prompts.ts`
does not. The gap was never between the adapter and the spec; it was between
the harness's prompt and the app's. §7 criterion 6 closes it.

### 3.2 Why the fix needs a new field

`RunRequest` says what a run may **change** (`writable`) and has never said
what it may **read**. An ASK sends `writable` empty, and that is correct and
must stay correct — an ASK changes nothing.

The host already knows the answer. `ipc.ts:1029` builds `readAt`, a map of
document id to working copy, for the prompt writer. The folders the ASK needs
are computed one function away from the run request and then thrown away.

So: **`readable: list[str]`** — absolute directories this run may read, beyond
`cwd`. Named for what it means, like `writable` beside it. Adapters that do not
scope reads ignore it.

### 3.3 The shape of the fix

`for_ask()` stops being virtual and becomes `for_act()` without the write
allowance:

- real paths — `FilesystemBackend(root_dir=cwd, virtual_mode=False)`
- allow **read** on `cwd`, `cwd/**`, and each `readable` root and its subtree
- deny **read** on `/**`
- deny **write** on `/**`, and keep the tool-name refusal, which is the
  stronger of the two — an ASK refuses `write_file`, `edit_file` and `delete`
  by name, before any path is considered

### 3.4 Two measurements this rests on

Both taken 2026-09-08, on `deepagents` 0.7.13.

**A. Read rules hold, and scope exactly as needed.** Through a real agent, with
`cwd` and one folder allowed:

| Read | Result |
|:--|:--|
| the named folder, by absolute path | allowed |
| a file inside `cwd` | allowed |
| a file outside both | **denied** |
| `/etc/hosts` | **denied** |

So the agent reads the document REX names, by full path, and nothing else. It
does **not** need the whole disk, and an earlier claim in this repository that
it did was wrong.

**B. `FilesystemBackend.read()` ignores the permission rules.** Called
directly, it read `/etc/hosts` happily under the deny-all rule above. The rules
are enforced where the **tool** runs, not in the backend's own methods.

B is why A had to be measured through `create_deep_agent` and not through the
backend, and it is a trap for the next person: a test that calls the backend
directly will report a boundary that does not exist, and a test that calls it
directly to prove an escape will report one that is not real.

## 4. Part B — removing Windows and Linux

### 4.1 What goes

| Where | What |
|:--|:--|
| `.github/workflows/release.yml` | three of four build rows, and the `rpmbuild` step |
| `electron-builder.yml` | the `win:`, `nsis:` and `linux:` blocks |
| `build/installer.nsh` | the NSIS "already installed" page |
| `scripts/package.mjs` | `ELECTRON_BUILDER_7Z_FILTER=BCJ2`, and the host-architecture default that existed because Windows listed two |
| `src/main/python.ts` | `venvLeafFor` / `bundledLeafFor` collapse to one line each |
| `src/main/gateway/local.ts` | two `win32` branches |
| `src/main/gateway/secrets.ts` | the Linux `safeStorage` backend branch |
| `src/main/agent/opencode.ts` | the `.exe` leaf and the `LOCALAPPDATA` candidate |
| `agent-runner/…/codex/adapter.py` | `ACT_PROVED` and its refusal |
| `agent-runner/…/opencode/adapter.py` | `_act_refusal`'s platform arm and the `capabilities()` arm |
| tests | the per-platform assertions in five suites |

### 4.2 What stays, and why

- **`sandbox_available()`** — it checks `/usr/bin/sandbox-exec` exists. On a
  macOS where it does not, ACT must still refuse rather than pretend.
- **`PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8`** on both Python children. They
  were added for Windows cp1252, but they are correct everywhere and cost
  nothing: they make the children's encoding a decision rather than a locale.
- **`author` and `homepage` in `package.json`.** The `.deb` needed them; spec
  49's publisher inference reads `homepage`, and removing it would change how
  `--publish never` behaves. Not worth touching in this spec.

## 5. What Windows and Linux measured — the record

Deleted code, kept knowledge. Every line below was paid for on a VM.

### 5.1 Windows arm64 — built, installed and validated 2026-09-07

In the `Windows 11 64-bit Arm` VMware Fusion VM, driven headless with `vmrun`.
`npm run package` produced `REX Setup 0.1.0.exe` (401 MB) from a 902 MB
`python-dist`; the install landed 16,087 files in about 100 s and the installed
app served on 24334.

Three bugs, none of them catchable from macOS:

1. **`python.ts` looked for `Scripts\python.exe`.** That is a *venv's* layout.
   python-build-standalone puts `python.exe` at the root, so the venv leaf and
   the bundled leaf are different questions and needed different functions.
2. **Both Python children wrote cp1252 stdout**, so LiteLLM's startup banner
   raised `UnicodeEncodeError` and the gateway never bound.
3. **electron-builder's NSIS installer silently omitted every PE binary and
   exited 0.** 7-Zip ≥23.01 applies its `ARM64` filter to arm64 executables and
   the bundled `nsis7z` (7-Zip 19.00 SDK) cannot decode it. The fix was
   `ELECTRON_BUILDER_7Z_FILTER=BCJ2`. `compression: store` is silently
   overridden by the differential-update path; `nsis.useZip` fails outright.

Also measured: the toolchain needs
`Microsoft.VisualStudio.Component.VC.Tools.ARM64` named explicitly, because the
`VCTools` workload omits it; `bundle-python.mjs` reports 0 MB there because `du`
is absent; and there is no universal x64+arm64 installer — electron-builder
issue #6571 is backlog and #5461's combined installer is broken, so each
architecture needs its own build machine.

### 5.2 Linux — built, packaged and validated 2026-09-07

Ubuntu 26.04 LTS arm64, in `rex-ubuntu.vmx`. `apt install ./rex_0.1.0_arm64.deb`
put REX in `/opt/REX` with an AppArmor profile, and with Node, npm and `uv`
removed the installed app still started both Python children from
`/opt/REX/resources/python/bin/python`; LiteLLM answered on 24334 in 5 s.

**The AppImage was dropped the same day.** Its arm64 launcher wants an
unversioned `libz.so` (electron-builder #7835), and Ubuntu 24.04+ blocks
Electron's sandbox inside one. `.deb` and `.rpm` replaced it; the `.rpm` was
built and never installed, for want of a Fedora machine.

### 5.3 The one that will matter if this ever comes back

**There is no cross-build.** `bundle-python.mjs` installs the host's CPython and
then *executes* it. Every platform needs its own machine — which is why spec 49
had four runners and why this spec now has one.

And if OpenCode ACT is ever wanted on Linux, the answer is already known:
**bubblewrap** or **Landlock**, applied by REX around `opencode serve` exactly
as `sandbox-exec` is today, so the boundary stays outside the agent. Ubuntu
24.04+ blocks the unprivileged user namespaces bubblewrap needs, through the
same AppArmor policy that killed the AppImage.

## 6. What this spec does not change

- The three invariants, and spec 46 §2's amendment to I3.
- The gate, the profiles, and the ACT boundary on macOS.
- `bundle:python`, `package`, and the DMG.
- Signing and notarisation, still deliberately unconfigured.

## 7. Acceptance criteria

1. A Deep Agents ASK on a real document, through the app, **reads the working
   copy and answers from it**.
2. `readable` exists in `protocol.py` and in the generated
   `src/shared/agent-protocol.ts`, and `test/protocol.spec.ts` passes.
3. A Deep Agents ASK **cannot** read a file outside `cwd` and `readable`.
4. `capabilities()` reports `supports_act: true` for all four SDKs, with no
   platform arm left in any adapter.
5. `grep -rn "win32\|linux" src/` finds nothing, and `release.yml` has one
   build row.
6. **All four agents, both modes, through the app, on a real document** —
   eight runs, with REX's own prompts. This is the criterion that would have
   caught §3.1, and no synthetic prompt satisfies it.
7. The full suite is green and `nvim-tools --json --all` adds no finding.
8. README, `CLAUDE.md` and `rules/01` say macOS, and no document claims
   Windows or Linux support in the present tense.

## 8. Out of scope

- Bringing Windows or Linux back. §5 is what that would start from.
- Signing, notarisation, and a Developer ID.
- OpenCode ACT without a sandbox (the "no shell" design). Not needed once the
  platform is one that has a sandbox.
