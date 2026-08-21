// App bootstrap and window creation (SPEC.md §3.1).

import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { closeDatabase, openDatabase } from "./db/database.ts";
import { stopBuild } from "./facts/supervisor.ts";
import { registerIpc } from "./ipc.ts";
import { registerDocProtocol, registerDocSchemePrivileges } from "./protocol.ts";

let window: BrowserWindow | null = null;

registerDocSchemePrivileges();

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1400,
    height: 950,
    show: false,
    title: "REX",
    // The Workbench ground, so the window does not flash a different dark grey
    // before the renderer paints. design/system/Components — `--bg`.
    backgroundColor: "#0d1420",
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
  const db = openDatabase();
  registerIpc(db, () => window);

  window = createWindow();

  // Spec 07 §10.1 rule 2 — the fact build's utilityProcess is killed before the
  // app goes away. What survives a quit is the `fact_run` row and its cursor, so
  // reopening REX offers Resume (§8.5); what must not survive is an orphaned
  // process still calling the gateway with no window to report to.
  app.on("before-quit", () => stopBuild(db));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) window = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", closeDatabase);
