// App bootstrap and window creation (SPEC.md §3.1).

import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { allowGenerationTools } from "./agent/gate.ts";
import { allowGenerationServer } from "./agent/profiles.ts";
import { type CdpStatus, chooseCdpPort, probeCdp } from "./cdp.ts";
import { closeDatabase, openDatabase } from "./db/database.ts";
import { installDiagnostics } from "./diagnostics.ts";
import { registerIpc } from "./ipc.ts";
import { openLogFile, record } from "./log.ts";
import { generationAvailable } from "./pptx/media.ts";
import { setGenerationEnabled } from "./pptx/plan.ts";
import { registerDocProtocol, registerDocSchemePrivileges } from "./protocol.ts";

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

/** Filled in once the app is up; §2.2 — what opened, never what was asked for. */
let cdpStatus: CdpStatus = {
  port: cdpChoice.port,
  source: cdpChoice.source,
  listening: false,
  browser: null,
  detail: "not probed yet",
};

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1400,
    height: 950,
    show: false,
    title: "REX",
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

  created.once("ready-to-show", () => created.show());

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
  const db = openDatabase();
  registerIpc(
    db,
    () => window,
    () => cdpStatus,
  );

  window = createWindow();

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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) window = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", closeDatabase);
