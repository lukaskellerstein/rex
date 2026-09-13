<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/full/rex-full-on-dark-1024.png">
    <img src="docs/logo/full/rex-full-color-1024.png" alt="REX" width="420">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/lukaskellerstein/rex/releases/latest"><img src="https://img.shields.io/github/v/release/lukaskellerstein/rex?label=release&color=D7263D" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20silicon-000000?logo=apple&logoColor=white" alt="Supported: macOS on Apple silicon">
  <img src="https://img.shields.io/badge/Windows%20%C2%B7%20Linux-not%20supported-lightgrey" alt="Windows and Linux: not supported">
  <a href="https://github.com/lukaskellerstein/rex/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/lukaskellerstein/rex/release.yml?branch=main&label=release%20build" alt="Release build"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white" alt="Electron 43">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9">
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white" alt="Python 3.12">
  <img src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white" alt="SQLite via better-sqlite3">
</p>

<p align="center">
  <b>Comment on a document. Talk each comment through with an AI agent.<br>
  Let it make the change — and keep only what you approve.</b>
</p>

# REX

*Review EX* — third in the family after **VEX** and **DEX**.

## Why REX

**Reviewing a document with AI still means copy and paste.** You copy a
paragraph into a chat, explain where it came from, and carry the answer back by
hand. The chat does not know where that paragraph lives. And when you finally
let an agent edit the file, it changes more than you asked.

**REX puts the conversation on the document.** Select a sentence, a table cell,
a region of a chart or a whole section, and write a comment. An agent answers
*that* comment, with the document open in front of it. When you agree on what
should change, switch the same box from **ASK** to **ACT**. The agent edits a
copy, REX shows you the change, and your file stays untouched until you press
**Approve**.

- **The place is never lost.** Comments stay attached while the document is
  edited, and a comment whose passage is gone says so instead of jumping to the
  wrong paragraph.
- **One comment, one conversation.** Every comment is its own thread with its
  own agent session.
- **A question cannot change your file.** ASK runs every agent read-only, and
  REX checks each tool call before it runs.
- **Your agent, your model.** Claude Agent SDK, Codex, OpenCode or Deep Agents —
  on a subscription, an API key, or a local model in LM Studio or Ollama.
- **Nothing hidden.** Traffic shows every request sent to a model and every
  answer, down to the JSON.

## Install

| System | Status |
|:--|:--|
| **macOS on Apple silicon** | **Supported** — macOS 12 or newer |
| macOS on Intel, Windows, Linux | Not supported |

1. Download **`REX-<version>-arm64.dmg`** from the
   [latest release](https://github.com/lukaskellerstein/rex/releases/latest).
2. Open it and drag **REX** into **Applications**.
3. The build is not signed yet, so macOS says REX "is damaged" or "cannot be
   verified". Clear the download flag once, then open REX:

   ```bash
   xattr -dr com.apple.quarantine /Applications/REX.app
   ```

### Connect a model

| You have | Do this |
|:--|:--|
| **A Claude subscription** | Sign in to Claude Code (`claude login`). The default agent uses that login |
| **A Codex subscription** | Sign in to the Codex CLI (`codex login`), then choose **Codex** in the comment box |
| **An API key, or a local model** | **Settings** (the cog) → switch on **Run the built-in gateway** → add Anthropic, OpenAI or OpenRouter with a key, or LM Studio, Ollama or Unsloth with its address |

### Your first review

1. **Open ▾** → **Document…** or **Folder as a workspace…**
2. Select text. Press `P` to pick a table, figure or section instead, or `N` to
   circle things with the pen.
3. Write a question and press **Ask about 1** (`⌘↵`). Reply to keep talking.
4. Press `⇧⇥` to switch to **ACT**, write what should change, and press
   **Change 1**.
5. Look at the change, then **Approve** or **Discard**.

## What REX can do

- **Point at anything** — text, a table, a row, a cell, a region of a figure, a
  node in a Mermaid diagram, a section, or the whole document. One comment can
  hold many places, across many documents.
- **ASK, ACT and NOTE** — ask an agent, have it make a change you approve, or
  just leave a note for yourself.
- **Four agents** — Claude Agent SDK, Codex, OpenCode and Deep Agents, all in
  both modes. Pick the agent and model per message.
- **A built-in gateway** — REX's own LiteLLM, on `127.0.0.1` only. Provider
  keys are stored encrypted with the macOS Keychain.
- **Traffic** — every chat REX ran, and every request and answer that went
  through the built-in gateway.
- **A folder is a workspace** — an explorer with comment counts, a graph of how
  the documents link, find (`⌘F`), search (`⌘⇧F`), and links you can follow and
  go back from (`⌘[` / `⌘]`).

| Format | ACT can change it |
|:--|:--|
| Markdown, HTML | yes |
| Word (`.docx`) | through 10 checked operations |
| PowerPoint (`.pptx`) | through 13 checked operations |
| PDF | no — read-only |

[`docs/FORMATS.md`](docs/FORMATS.md) explains what REX will and will not do to
each format.

## Run from source

You need an Apple-silicon Mac, Node.js 22.18 or newer,
[`uv`](https://docs.astral.sh/uv/), and the Xcode Command Line Tools.

```bash
git clone https://github.com/lukaskellerstein/rex.git && cd rex
npm ci
npm run rebuild                    # better-sqlite3 against Electron
(cd agent-runner && uv sync)
(cd local-gateway && uv sync)
npm run dev
```

**Run `npm run rebuild` after every `npm install`** — otherwise the app dies on
its first database query. Tests are one suite per file: `npm run test:<name>`.
`npm run package` builds the DMG.

## How it works

Four processes. The **renderer** shows the document and resolves comment anchors
on the live page. **Main** is the only privileged process: it holds the SQLite
database at `~/.rex/rex.db`, the documents on disk, and the gate that checks
every tool call. The **agent library** (`agent-runner/`) is a Python child that
runs every agent SDK and talks to main over stdin and stdout. The **built-in
gateway** (`local-gateway/`) is a second Python child, running only while it is
switched on.

## Contributing

A personal project, with no contribution process yet. The specs in
[`docs/my-specs/`](docs/my-specs/) are the authority on what REX is, and
[`.claude/CLAUDE.md`](.claude/CLAUDE.md) is the workflow every change follows.

## License

Not licensed for redistribution. No `LICENSE` file has been chosen yet.
