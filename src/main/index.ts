// App bootstrap and window creation (SPEC.md §3.1).

import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { closeDatabase, openDatabase } from "./db/database.ts";
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) window = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", closeDatabase);
