// Spec 42 §4 — the pipe client. One child, one line per message, no port.
//
// This file moves bytes and processes. `bridge.ts` moves meaning. Together they
// are REX's whole agent-independent abstraction, and neither of them knows what
// an SDK is.
//
// **A pipe is not a port**, so invariant I3 holds to the letter: the child is
// spawned by main, reads only its own stdin, and nothing else on this machine
// can reach it. There is no health-poll chain, nothing to reconnect to, and no
// number for a second REX to clash on — which is three of the five failures
// Vex's own specs record about its broker, avoided by not having one.
//
// No `electron` import, deliberately: `test/service.spec.ts` drives this class
// against a fake child written in a few lines of Node.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentEvent,
  HostMessage,
  ReplyValue,
  RunResult,
  ServiceMessage,
  ToolCall,
} from "../../shared/agent-protocol.ts";
import { record as logLine } from "../log.ts";

/** The child's first line has to arrive inside this, or the spawn has failed. */
const READY_TIMEOUT_MS = 20_000;

/** §4.1 step 6 — how long a quit waits for the child to end its own runs. */
const SHUTDOWN_MS = 5_000;

/** After `SIGTERM`, how long before the child is killed outright. */
const SIGKILL_MS = 1_000;

/**
 * §4.1 step 5 — a crash loop stops being a restart and starts being a symptom.
 *
 * Vex has a `restartProcess` that nothing calls. Here the call site is the
 * point: an SDK that segfaults must not take the window down, and an SDK that
 * segfaults on every run must not be restarted forever in silence.
 */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

export interface ServiceSpawn {
  command: string;
  args: string[];
  cwd: string;
}

/** What one run wants from the service while it is alive. */
export interface RunHandlers {
  onEvent: (event: AgentEvent) => void;
  /** The host's gate. Null allows the call; a string is the refusal. */
  onPolicy: (call: ToolCall) => string | null;
}

export interface ServiceState {
  interpreter: string;
  root: string;
  pid: number | null;
  /** The protocol version the child speaks. */
  version: string | null;
  python: string | null;
  /** The `agent-gateway` distribution's own version. */
  library: string | null;
  /** SDK distribution name to version, as the child's interpreter imported them. */
  sdks: Record<string, string>;
  startedAt: string | null;
  restarts: number;
  openRuns: number;
  down: string | null;
}

/**
 * The repository root, found by looking for the package rather than by counting
 * directories.
 *
 * Counting `..` is wrong in one of the two places this runs: main is bundled to
 * `out/main/index.js` at runtime and lives at `src/main/agent/service.ts` in a
 * test, and those are different depths. Walking up until `agent-gateway/`
 * appears is right in both, and says plainly what it is looking for.
 */
function findPackageRoot(): string {
  const override = process.env.REX_AGENT_GATEWAY;
  if (override) return resolve(override);

  let here = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(here, "agent-gateway");
    if (existsSync(join(candidate, "pyproject.toml"))) return candidate;
    const up = dirname(here);
    if (up === here) break;
    here = up;
  }
  // Nothing found. Return the path the message will name, so the sentence the
  // reviewer reads points at a real place rather than at nothing.
  return join(process.cwd(), "agent-gateway");
}

/**
 * §4.1 step 1 — the interpreter, and never `python` from `PATH`.
 *
 * A Mac app started from the Dock gets a stunted `PATH` — which is the whole
 * reason Vex carries a `system-path.ts` — so the one on `PATH` is either absent
 * or the wrong one. The venv's own interpreter is the only correct answer in
 * development, and a bundled runtime will be the only correct answer once REX
 * is packaged.
 */
export function interpreterFor(root: string): string {
  const override = process.env.REX_PYTHON;
  if (override) return override;

  const bundled = join(dirname(dirname(root)), "python", "bin", "python");
  const venv = join(root, ".venv", "bin", "python");
  if (existsSync(venv)) return venv;
  if (existsSync(bundled)) return bundled;
  return venv;
}

export function defaultSpawn(): ServiceSpawn {
  const root = findPackageRoot();
  return { command: interpreterFor(root), args: ["-m", "agent_gateway"], cwd: root };
}

interface PendingRequest {
  resolve: (value: ReplyValue | null) => void;
  reject: (error: Error) => void;
}

interface OpenRun {
  handlers: RunHandlers;
  settle: (result: RunResult) => void;
}

/**
 * One child process, kept for the app's lifetime, shared by every run.
 *
 * Concurrency is the child's: it runs one task per run on one event loop, and
 * every run-scoped message carries its `run_id`. This class only has to keep
 * the ids apart, which is what the two maps below are.
 */
export class AgentService {
  private readonly config: ServiceSpawn;
  private child: ChildProcess | null = null;
  private buffer = "";
  private nextId = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly runs = new Map<string, OpenRun>();
  private readyPromise: Promise<void> | null = null;
  private version: string | null = null;
  private python: string | null = null;
  private library: string | null = null;
  private sdks: Record<string, string> = {};
  private startedAt: string | null = null;
  private restartTimes: number[] = [];
  private quitting = false;
  private down: string | null = null;

  constructor(config: ServiceSpawn = defaultSpawn()) {
    this.config = config;
  }

  /** §4.1 step 3 — the child is up and has said so. The only health check. */
  ready(): Promise<void> {
    this.readyPromise ??= this.start();
    return this.readyPromise;
  }

  private start(): Promise<void> {
    if (!existsSync(this.config.command)) {
      // Said once, plainly, before any window offers an agent control. A
      // missing interpreter is a setup step, not a failure to debug.
      const reason = `The agent library has no Python interpreter at ${this.config.command}. Run \`uv sync\` in ${this.config.cwd}.`;
      this.down = reason;
      return Promise.reject(new Error(reason));
    }

    return new Promise<void>((settle, fail) => {
      const child = spawn(this.config.command, this.config.args, {
        cwd: this.config.cwd,
        // Nothing is added but the buffering flag: routing and credentials
        // travel in `run` messages, per run, never in the child's environment.
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      this.startedAt = new Date().toISOString();
      this.buffer = "";

      const timer = setTimeout(() => {
        fail(
          new Error(`The agent library did not start within ${READY_TIMEOUT_MS / 1000} seconds.`),
        );
      }, READY_TIMEOUT_MS);

      const onReady = (): void => {
        clearTimeout(timer);
        settle();
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => this.receive(chunk, onReady));
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => forwardStderr(chunk));

      child.on("error", (error) => {
        clearTimeout(timer);
        this.down = error.message;
        fail(error);
      });
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        this.onExit(code, signal);
      });
    });
  }

  // ── reading ───────────────────────────────────────────────────

  private receive(chunk: string, onReady: () => void): void {
    this.buffer += chunk;
    let cut = this.buffer.indexOf("\n");
    while (cut >= 0) {
      const line = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut + 1);
      if (line) this.handle(line, onReady);
      cut = this.buffer.indexOf("\n");
    }
  }

  private handle(line: string, onReady: () => void): void {
    let message: ServiceMessage;
    try {
      message = JSON.parse(line) as ServiceMessage;
    } catch {
      // A line on fd 1 that is not JSON is a bug in the service, and the child
      // guards fd 1 precisely so this cannot happen. Recorded rather than
      // guessed at, and never thrown: one bad line must not end every run.
      logLine("error", "agent-service", `unreadable line: ${line.slice(0, 200)}`);
      return;
    }

    switch (message.type) {
      case "ready":
        this.version = message.version;
        this.python = message.python;
        this.library = message.library;
        this.sdks = message.sdks;
        this.down = null;
        logLine("info", "agent-service", `ready · protocol ${message.version}`);
        onReady();
        break;

      case "reply": {
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        if (message.ok) waiting.resolve(message.value);
        else waiting.reject(new Error(message.error ?? "The agent library refused."));
        break;
      }

      case "event": {
        this.runs.get(message.runId)?.handlers.onEvent(message.event);
        break;
      }

      case "result": {
        const run = this.runs.get(message.runId);
        if (!run) return;
        this.runs.delete(message.runId);
        run.settle(message.result);
        break;
      }

      case "policy": {
        const run = this.runs.get(message.runId);
        // A policy for a run REX has already forgotten is refused, not allowed.
        // An unanswerable safety check must never become a write.
        const reason = run
          ? run.handlers.onPolicy(message.call)
          : `REX has no record of this run, so ${message.call.name} was refused.`;
        this.send({ type: "policy_reply", id: message.id, reason });
        break;
      }

      case "log":
        logLine(message.level, "agent-service", message.text);
        break;
    }
  }

  // ── writing ───────────────────────────────────────────────────

  private send(message: HostMessage): void {
    this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private request(build: (id: string) => HostMessage): Promise<ReplyValue | null> {
    this.nextId += 1;
    const id = `r${this.nextId}`;
    return new Promise<ReplyValue | null>((settle, fail) => {
      this.pending.set(id, { resolve: settle, reject: fail });
      this.send(build(id));
    });
  }

  /** Ask a question that has one answer, and wait for it. */
  async ask(build: (id: string) => HostMessage): Promise<ReplyValue | null> {
    await this.ready();
    return this.request(build);
  }

  /**
   * Start a run and resolve when it is over.
   *
   * The run's id is the caller's, because the caller is the one that has to be
   * able to stop it — and because `run_id` is the only thing keeping two
   * interleaved runs apart on either side of the pipe.
   */
  async run(message: HostMessage & { type: "run" }, handlers: RunHandlers): Promise<RunResult> {
    await this.ready();
    return new Promise<RunResult>((settle) => {
      this.runs.set(message.runId, { handlers, settle });
      this.send(message);
    });
  }

  stop(runId: string): void {
    if (this.runs.has(runId)) this.send({ type: "stop", runId });
  }

  // ── ending, and starting again ────────────────────────────────

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    const how = signal ? `signal ${signal}` : `code ${code ?? "?"}`;
    this.child = null;
    this.readyPromise = null;

    for (const waiting of this.pending.values()) {
      waiting.reject(new Error(`The agent service exited (${how}).`));
    }
    this.pending.clear();

    // §4.1 step 5 — every open run gets one error event and a result, so no
    // caller is left awaiting a promise that can never settle.
    const orphans = [...this.runs.entries()];
    this.runs.clear();
    for (const [runId, run] of orphans) {
      const text = `The agent service exited (${how}).`;
      run.handlers.onEvent({ type: "error", text, costUsd: null, durationMs: null });
      run.settle({
        sessionId: runId,
        costUsd: null,
        durationMs: null,
        denials: [],
        error: text,
        stopped: false,
      });
    }

    if (this.quitting) return;

    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((at) => now - at < RESTART_WINDOW_MS);
    if (this.restartTimes.length >= MAX_RESTARTS) {
      this.down = `The agent library exited ${MAX_RESTARTS + 1} times in a minute and was not restarted (${how}).`;
      logLine("error", "agent-service", this.down);
      return;
    }
    this.restartTimes.push(now);
    logLine("warn", "agent-service", `exited (${how}); restarting`);
    // Started eagerly rather than on the next run: the probe and the descriptor
    // are asked once at start-up, and a service that comes back silently is the
    // difference between one failed run and every later one failing too.
    this.ready().catch((error: unknown) => {
      this.down = error instanceof Error ? error.message : String(error);
    });
  }

  /** §4.1 step 6 — `shutdown`, then `SIGTERM`, then `SIGKILL`. */
  async quit(): Promise<void> {
    this.quitting = true;
    const child = this.child;
    if (!child) return;

    const ended = new Promise<void>((settle) => child.once("exit", () => settle()));
    this.send({ type: "shutdown" });
    if (await raced(ended, SHUTDOWN_MS)) return;

    child.kill("SIGTERM");
    if (await raced(ended, SIGKILL_MS)) return;
    child.kill("SIGKILL");
  }

  /** Spec 13 §4 — what the debug report says about the child. */
  state(): ServiceState {
    return {
      interpreter: this.config.command,
      root: this.config.cwd,
      pid: this.child?.pid ?? null,
      version: this.version,
      python: this.python,
      library: this.library,
      sdks: this.sdks,
      startedAt: this.startedAt,
      restarts: this.restartTimes.length,
      openRuns: this.runs.size,
      down: this.down,
    };
  }
}

/** True when the promise won the race, false when the timeout did. */
async function raced(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((settle) => {
    timer = setTimeout(() => settle(false), ms);
  });
  const won = await Promise.race([promise.then(() => true), timeout]);
  clearTimeout(timer);
  return won;
}

let stderrTail = "";

/** §4.1 step 4 — `stderr` is not the protocol. It is where the log lines are. */
function forwardStderr(chunk: string): void {
  stderrTail += chunk;
  let cut = stderrTail.indexOf("\n");
  while (cut >= 0) {
    const line = stderrTail.slice(0, cut);
    stderrTail = stderrTail.slice(cut + 1);
    if (line.trim()) logLine("info", "agent-service", line);
    cut = stderrTail.indexOf("\n");
  }
}

let shared: AgentService | null = null;

/** The one child, for the app's lifetime. */
export function agentService(): AgentService {
  shared ??= new AgentService();
  return shared;
}
