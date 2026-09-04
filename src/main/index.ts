// App bootstrap and window creation (SPEC.md §3.1).

import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { allowGenerationTools } from "./agent/gate.ts";
import { allowGenerationServer } from "./agent/profiles.ts";
import { agentService } from "./agent/service.ts";
import { isAgentMode, userAgent, windowTitle } from "./agentMode.ts";
import { type CdpStatus, chooseCdpPort, probeCdp } from "./cdp.ts";
import { closeDatabase, openDatabase } from "./db/database.ts";
import { installDiagnostics } from "./diagnostics.ts";
import { registerIpc } from "./ipc.ts";
import { openLogFile, record } from "./log.ts";
import { generationAvailable } from "./pptx/media.ts";
import { setGenerationEnabled } from "./pptx/plan.ts";
import { registerDocProtocol, registerDocSchemePrivileges } from "./protocol.ts";
import { migrateWorkingCopyNames } from "./work.ts";

let window: BrowserWindow | null = null;

registerDocSchemePrivileges();

// Spec 13 §3 — before anything else can fail. A log opened after the first
// failure is a log that missed it.
openLogFile();
installDiagnostics();

/**
 * Spec 13 §2.1 — the debugger, opened by default.
 *
 * Both must happen before `app.whenReady()`: Chromium reads its command line
 * once, at startup, and a switch appended afterwards is ignored in silence.
 * `argv` wins, so an agent that launched REX the way `rules/06-testing.md` says
 * gets exactly the port it asked for and REX appends nothing.
 */
const cdpChoice = chooseCdpPort(process.argv, process.env);
if (cdpChoice.warning) record("warn", "cdp", cdpChoice.warning);
if (cdpChoice.source !== "argv" && cdpChoice.port !== null) {
  app.commandLine.appendSwitch("remote-debugging-port", String(cdpChoice.port));
}

/**
 * Spec 20 §2 — an agent's REX says so. Read once, here, so the title, the user
 * agent and the way the window is shown cannot disagree with each other.
 */
const agentMode = isAgentMode(process.env);
if (agentMode) {
  app.userAgentFallback = userAgent(app.userAgentFallback, true);
  record("info", "agent", "PW_AGENT set — agent window: title tagged, shown inactive");
}

/** Filled in once the app is up; §2.2 — what opened, never what was asked for. */
let cdpStatus: CdpStatus = {
  port: cdpChoice.port,
  source: cdpChoice.source,
  listening: false,
  browser: null,
  detail: "not probed yet",
  owner: null,
};

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1400,
    height: 950,
    show: false,
    title: windowTitle("REX", agentMode),
    // The Graphite ground, so the window does not flash a different dark grey
    // before the renderer paints. Must track `--bg` in overlay.css.
    backgroundColor: "#0e1012",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      // Invariant I2 — the renderer displays untrusted document content, so it
      // holds no database handle, no credentials and no Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium suspends the "update the rendering" steps for a window it
      // considers hidden — behind another window, on another Space, minimised.
      // Everything that hangs off those steps stops with them:
      // `requestAnimationFrame`, `IntersectionObserver` delivery and `scroll`
      // dispatch. PDF.js paints its pages from a `requestAnimationFrame` loop
      // (spec 03 §7.2), so a PDF opened while REX is not frontmost would sit
      // there blank, with no error to see. Measured on 2026-08-21.
      backgroundThrottling: false,
    },
  });

  // Spec 20 §2.2 — an agent's window must never take the desktop with it.
  // `show()` activates the app, and macOS follows an activated window to its
  // space; `showInactive()` maps the window where the yabai rule put it and
  // leaves the reviewer where they are.
  created.once("ready-to-show", () => (agentMode ? created.showInactive() : created.show()));

  // The renderer sets `document.title`, and Electron copies it onto the window
  // — without the tag. Keep the tag on, or the window stops being an agent's
  // the moment a document opens.
  created.on("page-title-updated", (event, title) => {
    if (!agentMode) return;
    event.preventDefault();
    created.setTitle(windowTitle(title, true));
  });

  // A document's links open in the user's browser, never inside REX.
  created.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void created.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void created.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  return created;
}

void app.whenReady().then(() => {
  registerDocProtocol();
  // Spec 11 §6.4.3 — the generation tools are off unless the key is set. That
  // is a deliberate line: REX stays self-contained, and a missing key means the
  // feature is *absent* rather than half-working.
  const generation = generationAvailable();
  if (generation) {
    allowGenerationTools();
    // The tool allowlist stops a call; this is what lets the server start at
    // all. Without both, generation is either refused or silently reachable.
    allowGenerationServer();
  }
  setGenerationEnabled(generation);
  // Spec 15 §3.1 — beside the database migration and for the same reason: a
  // working copy on disk was written by an older REX, and it has to keep
  // opening. Before the first window, because the first thing a window does is
  // render one.
  migrateWorkingCopyNames();
  // Spec 34 §3.4 — and nothing is swept. A copy that matches its file is a
  // document whose current version happens to equal the file, which is the
  // ordinary state of every document; an agent may hold its path.
  const db = openDatabase();
  registerIpc(
    db,
    () => window,
    () => cdpStatus,
  );

  window = createWindow();

  // Spec 42 §4.1 — the agent library is one child process, started here and
  // kept for the app's lifetime. Started eagerly and not on the first ASK: a
  // missing `.venv` is a setup step, and the reviewer should meet the sentence
  // that names it before they have written a comment, not inside a run they
  // waited for. Not awaited, for the same reason the CDP probe is not.
  void agentService()
    .ready()
    .catch((error: unknown) => {
      record("error", "agent-service", error instanceof Error ? error.message : String(error));
    });

  // Not awaited: the window must not wait on a loopback fetch. The report is
  // asked for by a human, minutes later at the earliest.
  void probeCdp(cdpChoice).then((status) => {
    cdpStatus = status;
    record(
      status.listening ? "info" : "warn",
      "cdp",
      status.port === null
        ? "no debugger this run (REX_CDP_PORT)"
        : `http://localhost:${status.port} · ${status.listening ? `listening · ${status.browser}` : `NOT listening — ${status.detail}`}`,
    );
  });
});

/**
 * The last window closing quits REX — on macOS too, against the convention.
 *
 * Mail and Safari stay in the Dock with no window because a new window is a
 * new thing to do. REX has exactly one window and one document in it, so the
 * windowless state offers nothing and costs something real: it keeps holding
 * the debugger port. A REX left that way survives the terminal it was started
 * from, and every later `npm run dev` then meets `bind() failed: Address
 * already in use` from a process with no window to close.
 *
 * Measured on 2026-09-03: one such REX from 2026-09-01 had held 9334 for two
 * days. Ctrl+C never leaked one — closing the window did.
 */
app.on("window-all-closed", () => app.quit());

/**
 * Spec 42 §4.1 step 6 — the child is asked to end, and the quit waits for it.
 *
 * `before-quit` and not `will-quit`, because this is asynchronous and
 * `will-quit` is the last chance to run anything at all. The quit is deferred
 * once, the child is given `shutdown` and then five seconds to finish its runs,
 * and then the quit is let through — whether or not it went cleanly, because a
 * REX that will not quit is worse than a Python process that had to be killed.
 */
let childEnded = false;
app.on("before-quit", (event) => {
  if (childEnded) return;
  event.preventDefault();
  void agentService()
    .quit()
    .catch((error: unknown) => {
      record("warn", "agent-service", `did not stop cleanly: ${String(error)}`);
    })
    .finally(() => {
      childEnded = true;
      app.quit();
    });
});

app.on("will-quit", closeDatabase);
