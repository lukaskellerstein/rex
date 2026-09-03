// Spec 20 §2 — the agent window: how REX says who opened it.
//
// An agent's REX and the reviewer's REX are the same binary, started the same
// way, and nothing on the outside can tell them apart — not the process tree
// (`npm run dev` under a shell, either way), not the port (both default to
// 9334). Every scheme that guessed from the outside broke on the next launch
// shape. So the window says it itself: `PW_AGENT=1` in the environment, and
// REX carries the fact in the two places the desktop can read it.
//
//   - the window title ends in `[agent]`, which is what the yabai rule on this
//     machine matches to place the window on the `playwright` space at birth;
//   - the user agent carries `pw-agent`, which is what a hook reads from
//     `http://localhost:<port>/json/version` to know the instance is an
//     agent's and not the reviewer's.
//
// Nothing here imports `electron`. Pure functions, so `test/agentMode.spec.ts`
// can state the rule under plain `node --test`.

/** The suffix the window title carries. `mac-setup` matches `\[agent\]$`. */
export const AGENT_TAG = "[agent]";

/** The user-agent marker. `pw.py` looks for it, lowercased. */
export const AGENT_USER_AGENT_MARKER = "pw-agent";

/** `off`, and the other ways someone writes it — the same set `REX_CDP_PORT` takes. */
const OFF = new Set(["off", "none", "no", "false", "0", ""]);

/** True when `PW_AGENT` is set to anything but a spelling of off. */
export function isAgentMode(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env.PW_AGENT;
  if (raw === undefined) return false;
  return !OFF.has(raw.trim().toLowerCase());
}

/**
 * The title the window shows. In agent mode the tag is appended once, however
 * many times the renderer updates the title — a document title that already
 * ends in the tag is left alone.
 */
export function windowTitle(base: string, agent: boolean): string {
  if (!agent) return base;
  if (base.endsWith(AGENT_TAG)) return base;
  return `${base} ${AGENT_TAG}`;
}

/** The user agent string, with the marker appended once in agent mode. */
export function userAgent(base: string, agent: boolean): string {
  if (!agent) return base;
  if (base.includes(AGENT_USER_AGENT_MARKER)) return base;
  return `${base} ${AGENT_USER_AGENT_MARKER}`;
}
