## Install

REX is a **macOS app** and needs an Apple-silicon Mac. It carries its own Python runtime; nothing else needs to be installed.

| Machine | File | How |
|:--|:--|:--|
| Mac with Apple silicon | `REX-<version>-arm64.dmg` | Open the DMG and drag REX to Applications. The build is not signed yet, so the first launch needs **right-click → Open**, once. |

REX keeps its data in `~/.rex`, which uninstalling leaves in place.

## What REX needs from you

REX talks to AI models through its built-in gateway. Open **Settings**, switch the gateway on, and add a provider: an API key for a hosted model, or the address of a local server such as LM Studio or Ollama.

## Changes in this build
