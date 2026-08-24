// Spec 03 §5.8 — the first enrichment pass: Mermaid diagrams.
//
// A `mermaid` fence arrives from main as a <pre class="rex-mermaid"> holding
// its own source, with a stable id derived from the source line. This pass
// replaces the source with the drawn SVG. On failure the source stays on
// screen, which is §4.2 rule 3: failing loudly and readably beats an empty box.

/** One place decides how a REX diagram looks, whichever half of the app drew it. */
const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral",
  fontFamily: '"DM Sans", system-ui, sans-serif',
} as const;

/**
 * Spec 11 §7.4.2 — the second entry point: Mermaid source in, a PNG out.
 *
 * Main asks for this because it cannot do it. Mermaid needs a live DOM to
 * measure text, and the rasterising needs a canvas 2D context — and it happens
 * in **this** document rather than in the document iframe, which never
 * composites a canvas (spec 03 §7).
 *
 * PNG, not SVG. PowerPoint's SVG support needs an `<asvg:svgBlip>` extension
 * *and* a raster fallback, which is two representations to keep in step for a
 * sharpness gain a 2× raster mostly closes.
 */
export async function drawDiagramPng(source: string, scale = 2): Promise<Uint8Array> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize(MERMAID_CONFIG);

  const renderId = `rex-plan-diagram-${Math.random().toString(36).slice(2)}`;
  let svg: string;
  try {
    ({ svg } = await mermaid.render(renderId, source));
  } finally {
    // `render` appends a temporary `d<id>` div to this document to measure text
    // in, and removes it again only when it succeeds. A diagram that fails to
    // parse leaves it behind for the life of the window — measured, and it is
    // not invisible: 113px of stranded SVG gave the whole window a scrollbar.
    document.getElementById(`d${renderId}`)?.remove();
  }

  // The size comes from the drawing rather than from a guess, so a wide
  // flowchart and a tall sequence diagram both come out at their own shape.
  const measured = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const width = Math.max(1, Math.round(Number(measured?.[1] ?? 800) * scale));
  const height = Math.max(1, Math.round(Number(measured?.[2] ?? 600) * scale));

  // A `data:` URL rather than a blob, and that is not a style choice: REX's own
  // page carries `img-src 'self' data: rex-doc: https:`, with no `blob:`.
  // Measured on 2026-08-25 — an object URL loads nothing and the image fires
  // `onerror` with no console message that names the CSP. Widening the policy
  // to rasterise one diagram would be the wrong trade.
  const image = new Image();
  image.width = width;
  image.height = height;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("the drawn diagram could not be rasterised"));
    image.src = `data:image/svg+xml;base64,${base64Of(svg)}`;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this window has no 2D canvas context");
  // A slide is opaque and a PNG is not, so the ground is painted first. A
  // transparent diagram on a dark slide is unreadable, and unreadable is a
  // worse outcome than a white box.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/png");
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

/**
 * Spec 11 §7.4.5 step 2 — one frame out of a video, as its poster.
 *
 * A video with no poster is a **black rectangle** in PowerPoint's editing view,
 * so the poster is not decoration: it is what the deck looks like until someone
 * presses play. REX does not convert media (§7.4.5), and this is not converting
 * — it is reading one already-decoded frame out of the picture the user agent
 * is drawing anyway.
 *
 * Here rather than in main for the same reason as `drawDiagramPng`: decoding
 * needs a live media element and a canvas, and main has neither.
 */
export async function posterFramePng(
  url: string,
): Promise<{ png: Uint8Array; durationSeconds: number }> {
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  // Off-screen but attached: a detached element is allowed not to decode.
  video.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px";
  document.body.append(video);

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("REX could not decode this video to make a poster."));
    });

    // A tenth of a second in, not zero: the first frame of a clip is very often
    // black or a fade, and a black poster is the failure this exists to avoid.
    const at = Math.min(0.1, (video.duration || 0) / 10);
    if (at > 0) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = at;
      });
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("this window has no 2D canvas context");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/png");
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return {
      png: Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
      durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
    };
  } finally {
    video.remove();
  }
}

/**
 * Base64 of a string's UTF-8 bytes.
 *
 * `btoa` alone throws on anything outside Latin-1, and a Mermaid diagram
 * labelled in Czech is exactly that — the same trap §2.3 recorded on the read
 * path, arriving from the other direction.
 */
function base64Of(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * `mermaid.render` draws into the *renderer's* own document, not the iframe's:
 * it appends a temporary element to `document.body`, measures the text with a
 * real layout, and removes it again. That is why this cannot be moved into
 * main, and why the id handed to `render` must not collide with anything on
 * REX's own page — hence the `-svg` suffix on an id that is already unique.
 */
export async function mermaidPass(doc: Document): Promise<void> {
  const blocks = [...doc.querySelectorAll<HTMLElement>("pre.rex-mermaid")];
  // A document with no diagram never pays for roughly three megabytes.
  if (blocks.length === 0) return;

  const { default: mermaid } = await import("mermaid");
  mermaid.initialize(MERMAID_CONFIG);

  for (const block of blocks) {
    const renderId = `${block.id}-svg`;
    try {
      const { svg } = await mermaid.render(renderId, block.textContent ?? "");
      block.innerHTML = svg;
      // The <pre> keeps `white-space: pre` and a monospace font otherwise, and
      // the SVG inherits both and draws wrong. The stylesheet resets them on
      // this attribute.
      block.dataset.rendered = "true";
    } catch (error) {
      console.warn(`[rex] mermaid: ${block.id} did not render`, error);
      // §4.2 rule 3 — the source stays on screen. Do not clear the block.
    } finally {
      // `render` appends a temporary `d<id>` div to THIS document to measure
      // text in — the reason this pass cannot live in main — and removes it
      // again only when it succeeds. A diagram that fails to parse leaves it
      // behind for the life of the window.
      //
      // It is not invisible, which is how this was found: `components.md` has
      // one malformed diagram, and its 113px of stranded SVG sat below a
      // full-height shell and gave the whole window a page scrollbar. Nothing
      // logged it, and it looked like a styling bug.
      //
      // In `finally` rather than in the `catch`: mermaid's own cleanup is not
      // this module's to depend on, and removing an element that is already
      // gone costs nothing.
      document.getElementById(`d${renderId}`)?.remove();
    }
  }
}
