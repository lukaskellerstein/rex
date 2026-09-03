#!/bin/bash
# Launch the project's desktop app as an AGENT instance, for --cdp-endpoint
# (Electron) repos. The ONLY sanctioned way for an agent to start the app:
#
#   .claude/hooks/playwright-launch.sh npm run dev
#   REX_CDP_PORT=9444 .claude/hooks/playwright-launch.sh npm run dev
#
# What it does, and why each half exists:
#
#   PW_AGENT=1 is exported, and the app is expected to honour it (contract:
#   mac-setup projects/claude-code.md § The agent window contract): title
#   suffixed ` [agent]`, shown without activation, `pw-agent` in the user
#   agent. The title suffix is what the permanent claude-pw-agent yabai rule
#   matches, so the window is BORN on the `playwright` desktop — no rule is
#   installed here, no runtime state is written, nothing has to be cleaned up.
#
#   The script then verifies the window actually landed there, parking it as a
#   fallback for an app that ignores PW_AGENT, and exits non-zero if even that
#   failed — a placement failure must be an error the agent reports, never a
#   window quietly on the user's desktop.
#
# Refuses to launch onto a busy CDP port: the new instance would silently not
# get the port, and every browser tool would keep driving whatever already
# holds it — usually the user's own instance. Pick a free port via the app's
# own env (e.g. REX_CDP_PORT=9444) or ask the user.
#
# Env overrides: PW_APP_REGEX (default matches Electron and Playwright's
# browser builds), PW_CDP_PORT (default: read from ./.mcp.json). Must run on
# bash 3.2 (stock macOS).

set -u

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
pw() { python3 "$HOOKS_DIR/pw.py" "$@"; }
APP_REGEX="${PW_APP_REGEX:-^(Electron|Chromium|Google Chrome for Testing)$}"
LOG="${TMPDIR:-/tmp}/playwright-hooks/launch-$$.log"

if [ "$#" -eq 0 ]; then
    echo "usage: playwright-launch.sh <command...>" >&2
    exit 2
fi

PORT="${PW_CDP_PORT:-$(pw cdp-port || true)}"
if [ -n "$PORT" ] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "REFUSED: CDP port $PORT already has a listener — a new instance would not" >&2
    echo "get the port, and browser tools would keep driving the instance that holds" >&2
    echo "it (usually the user's). Launch on a free port instead, or ask the user." >&2
    exit 2
fi

# The desktop and its placement rules, before the window exists. A failure here
# is loud but not fatal: the app may still be worth starting (e.g. yabai down),
# it will just be visible.
SCRATCH="$(pw ensure-scratch || true)"
[ -z "$SCRATCH" ] && echo "warning: no playwright desktop — the window will NOT be hidden" >&2

BEFORE_SPACE="$(pw current-space || true)"
# Windows that already exist (a user's own instance) must never be touched.
BEFORE_IDS="$(pw list-windows "$APP_REGEX" || true)"

export PW_AGENT=1
mkdir -p "$(dirname "$LOG")"
nohup "$@" >"$LOG" 2>&1 &
APP_PID=$!

WINDOW="$(pw wait-window "$APP_REGEX" 20 "$BEFORE_IDS" "$APP_PID" || true)"

if [ -z "$WINDOW" ]; then
    echo "warning: no ${APP_REGEX} window appeared within 20s (log: $LOG)" >&2
else
    WINDOW_ID="${WINDOW%% *}"
    WINDOW_SPACE="${WINDOW#* }"
    if [ -n "$SCRATCH" ] && [ "$WINDOW_SPACE" != "$SCRATCH" ]; then
        # The app ignored PW_AGENT (no title tag, so no rule matched). Park it,
        # and say so — the repo's app is missing its half of the contract.
        pw park "$WINDOW_ID" || true
        echo "note: window was born on space $WINDOW_SPACE, not the playwright desktop —" >&2
        echo "the app does not honour PW_AGENT (title tag missing); parked it instead" >&2
        FINAL="$(pw window-space "$WINDOW_ID" || true)"
        if [ "$FINAL" != "$SCRATCH" ]; then
            echo "ERROR: window is still on space ${FINAL:-?} — placement failed (log: $LOG)" >&2
            exit 1
        fi
    fi
fi

# Nothing above is supposed to move the visible space; walk back if it did.
AFTER_SPACE="$(pw current-space || true)"
if [ -n "$BEFORE_SPACE" ] && [ "$AFTER_SPACE" != "$BEFORE_SPACE" ]; then
    pw focus-space "$BEFORE_SPACE" || true
fi

echo "launched pid=$APP_PID log=$LOG"
