// Spec 13 §2 — the remote-debugging port, chosen before the app is ready.
//
// This is Chromium's own endpoint, not a REX server: invariant I3 forbids REX
// from serving its own function over a port, and a debugger serves none of it.
// It is on by default because the failure this exists for — a window that shows
// nothing and says nothing — is the one where nobody thought to pass a flag.
//
// Nothing here imports `electron`. The rules are a pure function so
// `test/debug.spec.ts` can state them under plain `node --test`, exactly as
// `debug.ts` takes `appVersion` rather than calling `app.getVersion()`.

/** `.mcp.json` already points `playwright-rex` here. */
export const DEFAULT_CDP_PORT = 9334;

export interface CdpChoice {
  /** `null` when the reviewer turned it off. */
  port: number | null;
  source: "argv" | "env" | "default" | "off";
  /** A typo in `REX_CDP_PORT`, said out loud instead of silently ignored. */
  warning: string | null;
}

/** `off`, and the four other ways someone writes it. */
const OFF = new Set(["off", "none", "no", "false", "0", ""]);

/**
 * `--remote-debugging-port=9334` or `--remote-debugging-port 9334` — Chromium
 * accepts both spellings, so both have to be recognised or REX appends a second
 * switch and the two disagree.
 */
function portFromArgv(argv: readonly string[]): number | null {
  for (const [index, argument] of argv.entries()) {
    if (argument.startsWith("--remote-debugging-port=")) {
      const value = Number(argument.slice("--remote-debugging-port=".length));
      return Number.isInteger(value) ? value : null;
    }
    if (argument === "--remote-debugging-port") {
      const value = Number(argv[index + 1]);
      return Number.isInteger(value) ? value : null;
    }
  }
  return null;
}

/**
 * Which port REX should open, and who decided.
 *
 * The command line wins because it is the agent's path: `rules/06-testing.md`
 * launches REX with the switch already on it, and REX appending a second one
 * would change a workflow this spec is meant to leave alone.
 */
export function chooseCdpPort(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): CdpChoice {
  const fromArgv = portFromArgv(argv);
  if (fromArgv !== null) return { port: fromArgv, source: "argv", warning: null };

  const raw = env.REX_CDP_PORT;
  if (raw !== undefined) {
    const value = raw.trim().toLowerCase();
    if (OFF.has(value)) return { port: null, source: "off", warning: null };
    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      return { port, source: "env", warning: null };
    }
    return {
      port: DEFAULT_CDP_PORT,
      source: "default",
      warning: `REX_CDP_PORT=${raw} is not a port number or "off"; using ${DEFAULT_CDP_PORT}.`,
    };
  }

  return { port: DEFAULT_CDP_PORT, source: "default", warning: null };
}

export interface CdpStatus {
  port: number | null;
  source: CdpChoice["source"];
  listening: boolean;
  /** `Chrome/140.0.0.0`, straight from the endpoint — proof it is really up. */
  browser: string | null;
  /** Why it is not listening, when it is not. */
  detail: string | null;
}

/**
 * Whether the port REX asked for actually opened.
 *
 * Appending the switch is a request. A second REX started while the first holds
 * 9334 gets `Cannot start http server for devtools` on Chromium's own stderr
 * and then runs perfectly normally with no debugger — which is this spec's own
 * failure mode, one level down. So the report prints what was found here, never
 * what was asked for.
 */
export async function probeCdp(choice: CdpChoice): Promise<CdpStatus> {
  const base = { port: choice.port, source: choice.source };
  if (choice.port === null) {
    return { ...base, listening: false, browser: null, detail: "REX_CDP_PORT turned it off" };
  }
  try {
    const response = await fetch(`http://127.0.0.1:${choice.port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return { ...base, listening: false, browser: null, detail: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { Browser?: string };
    return { ...base, listening: true, browser: body.Browser ?? null, detail: null };
  } catch (error) {
    return {
      ...base,
      listening: false,
      browser: null,
      detail: `no answer (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/** The `ATTACH` block's own lines, so `debug.ts` does not restate the rules. */
export function cdpLines(status: CdpStatus): string[] {
  if (status.port === null) {
    return [
      "  cdp        OFF — no debugger on this run (REX_CDP_PORT)",
      "  to open it restart without REX_CDP_PORT, or with REX_CDP_PORT=9334",
    ];
  }
  const endpoint = `http://localhost:${status.port}`;
  if (!status.listening) {
    return [
      `  cdp        ${endpoint} · NOT LISTENING — ${status.detail ?? "unknown"}`,
      "  why        another REX almost certainly has this port. Nothing can attach",
      "             to THIS window, and the log file is shared with that one — read",
      "             its header line before trusting a line in it.",
      `  fix        quit the other REX, or start this one with REX_CDP_PORT=9444`,
    ];
  }
  return [
    `  cdp        ${endpoint} · listening · ${status.browser ?? "no version reported"} · chosen by ${status.source}`,
    `  check      curl -s ${endpoint}/json/version`,
    "  mcp        .mcp.json → playwright-rex is already pointed at this endpoint",
  ];
}
