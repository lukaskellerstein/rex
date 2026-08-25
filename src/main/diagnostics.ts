// Spec 13 §3.2 — the hooks that fill the ring.
//
// Main sees more of a failure than the renderer does, which is why the renderer
// is asked for almost nothing (§4.2's VIEW block is the whole of it). A window
// that dies, a preload that did not load, a frame that failed: none of those
// reach the overlay's own code, and every one of them is what "the document
// pane is empty" turns out to be.

import { app, type WebContents } from "electron";
import { record, recordError } from "./log.ts";

/** `…/App.tsx:412` — where a console line came from, without the whole URL. */
function origin(sourceId: string, lineNumber: number): string {
  const tail = sourceId.split("/").slice(-2).join("/");
  return tail ? `${tail}:${lineNumber}` : "unknown";
}

/** Every `WebContents` REX makes is its own window — there is no guest process. */
const SOURCE = "renderer";

function watch(contents: WebContents): void {
  // Electron 43 merges the params onto the event object; the trailing
  // (level, message, line, sourceId) arguments of the old signature are
  // deprecated and not read here.
  contents.on("console-message", (details) => {
    // `info` and `debug` are dropped. A React render logs enough of both to
    // push a real error out of a 300-entry ring within seconds.
    if (details.level !== "warning" && details.level !== "error") return;
    record(
      details.level === "error" ? "error" : "warn",
      SOURCE,
      `${details.message} (${origin(details.sourceId, details.lineNumber)})`,
    );
  });

  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED, which every cancelled navigation produces — including
    // every ordinary one that was superseded. It is not a failure.
    if (code === -3) return;
    record("error", "load", `${description} (${code}) ${url}${isMainFrame ? " · main frame" : ""}`);
  });

  contents.on("preload-error", (_event, preloadPath, error) => {
    record("error", "load", `preload ${preloadPath} failed: ${error.message}`);
  });

  contents.on("render-process-gone", (_event, details) => {
    record("error", "crash", `${SOURCE} gone: ${details.reason} (exit ${details.exitCode})`);
  });

  contents.on("unresponsive", () => record("warn", "crash", `${SOURCE} is unresponsive`));
}

/**
 * Installed before the first window exists, so `web-contents-created` catches
 * that window too — the one whose console is the entire point.
 */
export function installDiagnostics(): void {
  process.on("uncaughtException", (error) => recordError("main", error));
  process.on("unhandledRejection", (reason) => recordError("main", reason));
  app.on("web-contents-created", (_event, contents) => watch(contents));
  app.on("child-process-gone", (_event, details) => {
    record("error", "crash", `${details.type} process gone: ${details.reason}`);
  });
}
