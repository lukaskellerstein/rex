## Install

Pick the file for your machine. Every file carries its own Python runtime; nothing else needs to be installed.

| Machine | File | How |
|:--|:--|:--|
| Mac with Apple silicon | `REX-<version>-arm64.dmg` | Open the DMG and drag REX to Applications. The build is not signed yet, so the first launch needs **right-click → Open**, once. |
| Windows on x64 (most PCs) | `REX-Setup-<version>-x64.exe` | Run the installer. SmartScreen will say "unknown publisher": choose **More info → Run anyway**. |
| Windows on ARM | `REX-Setup-<version>-arm64.exe` | Same as x64. |
| Ubuntu, Debian, Mint, Pop | `rex_<version>_amd64.deb` | `sudo apt install ./rex_<version>_amd64.deb`, then start REX from the menu or run `rex`. |
| Fedora, RHEL, openSUSE | `rex-<version>.x86_64.rpm` | `sudo dnf install ./rex-<version>.x86_64.rpm`, then start REX from the menu or run `rex`. |

Running the installer again on Windows offers **Reinstall** or **Uninstall**. On every platform REX keeps its data in `~/.rex`, which an uninstall leaves in place.

## What REX needs from you

REX talks to AI models through its built-in gateway. Open **Settings**, switch the gateway on, and add a provider: an API key for a hosted model, or the address of a local server such as LM Studio or Ollama. On Linux, install `gnome-keyring` or `kwallet` first if you want the key stored with real protection; REX says so before it stores one.

## Changes in this build
