// Mounts the shell inside a shadow root (SPEC.md §7).
//
// The isolation is not a style preference: documents carry their own light and
// dark stylesheets, and without a shadow boundary the document's CSS would
// restyle REX's controls while REX's CSS changed how the document looks — in a
// review tool, the second of those is unacceptable.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The three faces the design specifies, self-hosted: a packaged app cannot
// depend on Google Fonts, and only the Latin subsets are shipped — 130KB for
// all eight files.
//
// DM Sans ships four weights because the chrome asks for four. The palette this
// replaced shipped three and let the engine fake the 700 that lost anchors and
// moved tokens are set in, which is a smeared glyph at 10px.
//
// These are imported at *document* level on purpose. @font-face declared inside
// a shadow root is ignored by the engine, so the faces have to be registered on
// the document while overlay.css merely names the families.
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import { App } from "./overlay/App.tsx";
import overlayCss from "./overlay/overlay.css?inline";

const host = document.getElementById("rex-root");
if (!host) throw new Error("REX host element is missing from index.html");

const shadow = host.attachShadow({ mode: "open" });

const style = document.createElement("style");
style.textContent = overlayCss;
shadow.append(style);

const mount = document.createElement("div");
mount.className = "rex-shell";
shadow.append(mount);

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
