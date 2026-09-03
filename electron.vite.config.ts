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
      rollupOptions: {
        input: { index: resolve("src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
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
    // 5334 instead of Vite's default 5173, which every other Vite project on
    // this machine also wants. The digits mirror REX's CDP port 9334, so one
    // number identifies the app in `lsof` output. strictPort stays off on
    // purpose: a second REX (the Playwright agent instance) then slides to
    // 5335 instead of failing, and the main process follows either way because
    // electron-vite hands it the real URL in ELECTRON_RENDERER_URL.
    // REX_NO_HMR=1 (npm run dev:nohmr) cuts the HMR socket. Without it Vite
    // pushes every renderer edit into the running window, and an edit that
    // Fast Refresh cannot swap in becomes a full page reload — which throws
    // away the state of whoever is reviewing a document at the time. An agent
    // session editing src/renderer/ is exactly that case. Reload by hand
    // (Cmd+R) to pick the change up.
    server: { port: 5334, hmr: process.env.REX_NO_HMR ? false : undefined },
    build: {
      rollupOptions: { input: { index: resolve("src/renderer/index.html") } },
    },
  },
});
