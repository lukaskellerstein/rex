// Mounts the shell inside a shadow root (SPEC.md §7).
//
// The isolation is not a style preference: documents carry their own light and
// dark stylesheets, and without a shadow boundary the document's CSS would
// restyle REX's controls while REX's CSS changed how the document looks — in a
// review tool, the second of those is unacceptable.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
