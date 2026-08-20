import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // better-sqlite3 is native and the Agent SDK spawns its own executable —
    // neither survives being bundled, so everything in `dependencies` stays
    // external and is resolved from node_modules at runtime.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve("src/main/index.ts") } },
    },
  },
  preload: {
    // A sandboxed preload cannot require from node_modules — measured: the
    // webview preload failed to load with "module not found: dompurify". The
    // resolver's own dependency has to be bundled into the preload instead.
    plugins: [externalizeDepsPlugin({ exclude: ["diff-match-patch"] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          // Tier 2: the anchor resolver, loaded inside the <webview> process
          // because invariant I1 says it runs on the live DOM.
          webview: resolve("src/preload/webview.ts"),
        },
        // CommonJS deliberately: an ESM preload only loads when the window has
        // sandbox: false, and REX's window is sandboxed (invariant I2).
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve("src/renderer/index.html") } },
    },
  },
});
