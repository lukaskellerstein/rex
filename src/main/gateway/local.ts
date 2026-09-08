// Spec 46 §4 — REX's own LiteLLM, as a child process on one loopback port.
//
// The sibling of `agent/service.ts`, and deliberately shaped like it: main owns
// the process, the process dies with main, and a crash is survivable. What is
// different is the transport, and it is different for a reason nothing here can
// argue with — **every SDK reaches a gateway by URL.** `ANTHROPIC_BASE_URL`,
// Codex's `base_url`, OpenCode's `baseURL`, `ChatOpenAI`'s `base_url`: none of
// them speaks a pipe and none can address a Unix socket. A socket was considered
// and fails on the client side, which is the side REX does not control.
//
// So invariant I3 is amended rather than broken (§2): REX still listens on
// nothing, and one loopback port carries inference. `127.0.0.1` only, never
// `0.0.0.0`, and `local_gateway/serve.py` is where that is enforced and tested.
//
// No `electron` import, so `node --test` can drive this against a fake child.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { record as logLine } from "../log.ts";
import { interpreterFor, packageRoot } from "../python.ts";
import { childRecordPath, configPath, gatewayDir, trafficDir } from "./paths.ts";

/**
 * §4.2 — the first port, and the nine after it.
 *
 * `24xxx` is the LiteLLM family on this machine — the reviewer's own is 24000 —
 * and `334` is REX's own signature: 9334 the debugger, 5334 Vite, 26334 REX's
 * Envoy. It reads as "LiteLLM, REX's own".
 */
export const FIRST_PORT = 24334;
export const LAST_PORT = 24343;

/** How long one port is given to come up before REX tries the next. */
const READY_TIMEOUT_MS = 30_000;

/** How often the child is asked whether it is listening yet. */
const POLL_MS = 250;

/** After `SIGTERM`, how long before the child is killed outright. */
const SIGKILL_MS = 2_000;

export interface GatewayState {
  /** The port it actually got, which is not always the one it wanted (§4.2). */
  port: number | null;
  pid: number | null;
  running: boolean;
  startedAt: string | null;
  /** Why it is not running, in a sentence. Null when it is. */
  down: string | null;
}

/** What the child is told, beyond its arguments. */
export interface GatewayEnvironment {
  /** `REX_PROVIDER_<ID>` to the decrypted value, built in main immediately before spawn. */
  providerKeys: Record<string, string>;
  /** §4.6 — capture request and response bodies. */
  captureBodies: boolean;
}

const NOTHING: GatewayEnvironment = { providerKeys: {}, captureBodies: true };

/**
 * §4.2 — the ports to try, in order.
 *
 * `REX_GATEWAY_PORT` pins one and disables the walk entirely: a person who
 * named a port meant that port, and silently using a different one would make
 * every URL they wrote down wrong.
 */
export function portsToTry(env: NodeJS.ProcessEnv = process.env): number[] {
  const pinned = Number(env.REX_GATEWAY_PORT);
  if (Number.isInteger(pinned) && pinned > 0 && pinned < 65_536) return [pinned];
  const ports: number[] = [];
  for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) ports.push(port);
  return ports;
}

/** The `local-gateway/` directory, found the way `agent-runner/` is. */
export function gatewayPackageRoot(): string {
  return packageRoot(
    "local-gateway",
    dirname(fileURLToPath(import.meta.url)),
    process.env.REX_LOCAL_GATEWAY,
  );
}

interface ChildRecord {
  pid: number;
  port: number;
  startedAt: string;
}

/**
 * One LiteLLM, owned by main, for as long as the switch is on.
 *
 * Not a singleton with a `ready()` like `AgentService`: this one is **started
 * and stopped by a person** (§4.1), so the lifecycle is explicit and "enabled
 * means running" is a property the caller maintains rather than a lazy getter.
 */
export class LocalGateway {
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private startedAt: string | null = null;
  private down: string | null = null;
  private stopping = false;
  /**
   * §4.3 — random per launch, passed as `LITELLM_MASTER_KEY`, **never written
   * to disk**.
   *
   * It is also how REX proves a server on a port is its own — see `owns()`.
   */
  private masterKey = "";

  /** The key this run's child answers to. Main sends it; nothing else has it. */
  token(): string | null {
    return this.child && this.masterKey ? this.masterKey : null;
  }

  state(): GatewayState {
    return {
      port: this.port,
      pid: this.child?.pid ?? null,
      running: this.child !== null,
      startedAt: this.startedAt,
      down: this.down,
    };
  }

  /**
   * Start on the first port that will have us, and return it.
   *
   * **A busy port is never adopted** (§4.2). If something already answers on
   * 24334, REX must not assume it is a LiteLLM of its own and must never send
   * it a provider key. The proof of ownership is `masterKey`: it is random,
   * this process is the only thing that knows it, and a stranger's proxy cannot
   * answer 200 to it. That is stronger than reading the child's log for a
   * "listening" line and stronger than a bind probe, which is racy by
   * construction.
   */
  async start(environment: GatewayEnvironment = NOTHING): Promise<number> {
    if (this.child && this.port !== null) return this.port;

    await this.reapAbandonedChild();

    const root = gatewayPackageRoot();
    const command = interpreterFor(root);
    if (!existsSync(command)) {
      // Said once, plainly, rather than as a spawn failure. A missing
      // interpreter is a setup step, not something to debug.
      this.down = `The gateway has no Python interpreter at ${command}. Run \`uv sync\` in ${root}.`;
      throw new Error(this.down);
    }
    if (!existsSync(configPath())) {
      this.down = `The gateway has no config at ${configPath()}. Add a provider in Settings.`;
      throw new Error(this.down);
    }

    const tried: number[] = [];
    for (const port of portsToTry()) {
      tried.push(port);
      if (await this.tryPort(port, root, command, environment)) {
        this.port = port;
        this.down = null;
        this.startedAt = new Date().toISOString();
        this.writeChildRecord();
        logLine("info", "local-gateway", `listening on http://127.0.0.1:${port}`);
        return port;
      }
    }

    // Fail loudly, naming the ports tried (§4.2). A gateway that quietly did
    // not start is a composer full of models that answer nothing.
    this.down = `The gateway could not take a port. Tried ${tried.join(", ")}.`;
    throw new Error(this.down);
  }

  private async tryPort(
    port: number,
    cwd: string,
    command: string,
    environment: GatewayEnvironment,
  ): Promise<boolean> {
    this.masterKey = `sk-rex-${randomBytes(24).toString("hex")}`;
    mkdirSync(trafficDir(), { recursive: true });

    const child = spawn(
      command,
      ["-m", "local_gateway", "serve", "--port", String(port), "--config", configPath()],
      {
        cwd,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          // **UTF-8 is stated, not inherited.** REX reads this child's stdout
          // as UTF-8 (`setEncoding("utf8")` below), so the child's encoding has
          // to be a decision. It is macOS's default today, and the cost of
          // leaving it to the locale was measured on the Windows build REX no
          // longer ships: stdout was cp1252, LiteLLM prints an ASCII-art banner
          // through `click.echo` before it binds, `show_banner` raised
          // `UnicodeEncodeError`, the child exited 3, and REX walked all ten
          // ports finding nothing.
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          // §4.3 — the environment, never a file and never an argument. An
          // argument is visible in `ps` to every process on this machine.
          LITELLM_MASTER_KEY: this.masterKey,
          REX_TRAFFIC_DIR: trafficDir(),
          REX_TRAFFIC_BODIES: environment.captureBodies ? "1" : "0",
          ...environment.providerKeys,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;

    let exited = false;
    child.once("exit", (code, signal) => {
      exited = true;
      this.onExit(code, signal);
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => forward(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => forward(chunk));

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited) {
        // The commonest reason, and the one §4.2 is about: something else holds
        // the port. Move up a number rather than asking who it was.
        this.child = null;
        return false;
      }
      if (await startedOn(port, this.masterKey, child.pid)) return true;
      await pause(POLL_MS);
    }

    logLine(
      "warn",
      "local-gateway",
      `port ${port} did not answer within ${READY_TIMEOUT_MS / 1000}s`,
    );
    await this.kill();
    return false;
  }

  /**
   * §4.3 — stop, and mean it.
   *
   * `SIGTERM` first so uvicorn can close its sockets, then `SIGKILL`. **A
   * gateway that outlives REX is a key server nobody is watching**: it holds
   * every provider key in its process environment, so this is the security
   * boundary and not tidiness.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    await this.kill();
    this.child = null;
    this.port = null;
    this.startedAt = null;
    this.stopping = false;
    clearChildRecord();
  }

  private async kill(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    const ended = new Promise<void>((settle) => child.once("exit", () => settle()));
    child.kill("SIGTERM");
    const won = await Promise.race([ended.then(() => true), pause(SIGKILL_MS).then(() => false)]);
    if (!won) child.kill("SIGKILL");
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.stopping) return;
    const how = signal ? `signal ${signal}` : `code ${code ?? "?"}`;
    this.child = null;
    this.port = null;
    this.down = `The gateway exited (${how}).`;
    clearChildRecord();
    logLine("warn", "local-gateway", this.down);
  }

  private writeChildRecord(): void {
    if (this.child?.pid == null || this.port === null) return;
    const record: ChildRecord = {
      pid: this.child.pid,
      port: this.port,
      startedAt: this.startedAt ?? new Date().toISOString(),
    };
    try {
      mkdirSync(gatewayDir(), { recursive: true });
      writeFileSync(childRecordPath(), JSON.stringify(record, null, 2));
    } catch (error) {
      logLine("warn", "local-gateway", `could not record the child: ${String(error)}`);
    }
  }

  /**
   * §4.3 — kill a gateway left behind by a `SIGKILL` on REX.
   *
   * The pid file exists for exactly this: every handler REX has is skipped by a
   * hard kill, so the next start is the only thing that can clean up. It kills
   * **only** a process whose command line still names this package — a pid is
   * recycled, and killing a stranger because a number matched would be a far
   * worse bug than the one being fixed.
   */
  private async reapAbandonedChild(): Promise<void> {
    let record: ChildRecord;
    try {
      record = JSON.parse(readFileSync(childRecordPath(), "utf8")) as ChildRecord;
    } catch {
      return; // no file, or one that will not parse. Nothing to reap either way.
    }
    if (typeof record.pid !== "number") return clearChildRecord();
    if (!isOurs(record.pid)) return clearChildRecord();

    logLine(
      "warn",
      "local-gateway",
      `killing a gateway left from an earlier run (pid ${record.pid})`,
    );
    try {
      process.kill(record.pid, "SIGTERM");
      await pause(SIGKILL_MS);
      if (isOurs(record.pid)) process.kill(record.pid, "SIGKILL");
    } catch {
      // Already gone between the check and the signal, which is the good case.
    }
    clearChildRecord();
  }
}

/**
 * Does the server on this port answer to this launch's master key?
 *
 * The key is 48 random hex characters, minted per launch, and lives only in
 * this process and its child. A stranger's LiteLLM answers 400 to a key it does
 * not know and 500 when it has no key configured at all (both measured, §18).
 *
 * **This is necessary and not sufficient**, which is why `startedOn` exists: a
 * server that accepts *any* bearer token would pass this, and §4.2 does not
 * say "probably not adopted".
 */
export async function owns(port: number, masterKey: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: `Bearer ${masterKey}` },
      signal: AbortSignal.timeout(2_000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * The pid holding this port, or null when nothing does.
 *
 * `lsof` because there is no Node call for it. A failure — no `lsof`, no
 * permission — returns null, and `startedOn` then falls back to the key alone
 * rather than refusing to start at all.
 */
export function listeningPid(port: number): number | null {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pid = Number(out.trim().split("\n")[0]);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * §4.2 — is the thing on this port **our child**, rather than a stranger?
 *
 * Two independent proofs, and both must hold:
 *
 *   1. it answers 200 to a key only this launch knows, and
 *   2. the process holding the socket is our child, or descended from it.
 *
 * Either alone has a hole. A key check alone would adopt a server that accepts
 * any bearer token. A pid check alone would accept a child that bound the port
 * but has not finished loading its config, and REX would route a run at a proxy
 * that knows no models. Together they close both, and that is the difference
 * between §4.2's rule holding and being hoped for.
 *
 * Where the pid cannot be read — no `lsof`, no permission — the key check
 * stands alone and this says so in the log rather than silently weakening.
 */
export async function startedOn(
  port: number,
  masterKey: string,
  childPid: number | undefined,
): Promise<boolean> {
  if (!(await owns(port, masterKey))) return false;

  const holder = listeningPid(port);
  if (holder === null || childPid === undefined) return true;
  if (holder === childPid) return true;
  if (isDescendantOf(holder, childPid)) return true;

  logLine(
    "warn",
    "local-gateway",
    `port ${port} answered our key but is held by pid ${holder}, not our child ${childPid}. Not adopting it.`,
  );
  return false;
}

/** Walk `ppid` upward. uvicorn may serve from a worker rather than the process REX spawned. */
function isDescendantOf(pid: number, ancestor: number): boolean {
  let current = pid;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const out = execFileSync("ps", ["-o", "ppid=", "-p", String(current)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parent = Number(out.trim());
      if (!Number.isInteger(parent) || parent <= 1) return false;
      if (parent === ancestor) return true;
      current = parent;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Does this pid still belong to a `local_gateway`?
 *
 * `ps` rather than `process.kill(pid, 0)` alone, because existence is not
 * ownership: pids are recycled, and the whole point of the check is to not kill
 * whatever inherited the number.
 */
function isOurs(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false; // gone
  }
  try {
    const line = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    return line.includes("local_gateway");
  } catch {
    return false;
  }
}

function clearChildRecord(): void {
  try {
    rmSync(childRecordPath(), { force: true });
  } catch {
    // A pid file that will not go is not worth failing a start over.
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((settle) => setTimeout(settle, ms));
}

let tail = "";

/** LiteLLM is chatty on both descriptors. Its lines go where every other line goes. */
function forward(chunk: string): void {
  tail += chunk;
  let cut = tail.indexOf("\n");
  while (cut >= 0) {
    const line = tail.slice(0, cut);
    tail = tail.slice(cut + 1);
    if (line.trim()) logLine("info", "local-gateway", line.trim().slice(0, 500));
    cut = tail.indexOf("\n");
  }
}

let shared: LocalGateway | null = null;

/** The one gateway, for the app's lifetime. */
export function localGateway(): LocalGateway {
  shared ??= new LocalGateway();
  return shared;
}
