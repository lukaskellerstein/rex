## Install

REX is a **macOS app for Apple silicon**. It needs macOS 12 or newer, and Windows and Linux are not supported. It carries its own Python runtime; nothing else needs to be installed.

1. Download `REX-<version>-arm64.dmg` below, open it, and drag REX to Applications.
2. The build is not signed yet, so macOS blocks the first launch and says REX "is damaged" or "cannot be verified". Right-click → Open does not get past that. Clear the download flag once, in Terminal, then open REX:

   ```bash
   xattr -dr com.apple.quarantine /Applications/REX.app
   ```

REX keeps its data in `~/.rex`, which uninstalling leaves in place.

## What REX needs from you

One way to reach a model:

- **A Claude subscription** — if Claude Code is signed in on this Mac, REX's default agent uses that login.
- **A Codex subscription** — if the Codex CLI is signed in, choose Codex in the comment box.
- **An API key or a local model** — open **Settings**, switch on **Run the built-in gateway**, and add a provider: a key for Anthropic, OpenAI or OpenRouter, or the address of LM Studio, Ollama or Unsloth.

## Changes in this build
