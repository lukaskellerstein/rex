// App bootstrap and window creation (SPEC.md §3.1).

import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { allowGenerationTools } from "./agent/gate.ts";
import { allowGenerationServer } from "./agent/profiles.ts";
import { closeDatabase, openDatabase } from "./db/database.ts";
import { registerIpc } from "./ipc.ts";
import { generationAvailable } from "./pptx/media.ts";
import { setGenerationEnabled } from "./pptx/plan.ts";
import { registerDocProtocol, registerDocSchemePrivileges } from "./protocol.ts";

let window: BrowserWindow | null = null;

registerDocSchemePrivileges();

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
      // Tier 2 (§5.2, milestone 7) shows a remote page in a <webview>.
      webviewTag: true,
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
  registerIpc(db, () => window);

  window = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) window = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", closeDatabase);
