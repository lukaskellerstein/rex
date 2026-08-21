// Spec 03 §5.8 — the first enrichment pass: Mermaid diagrams.
//
// A `mermaid` fence arrives from main as a <pre class="rex-mermaid"> holding
// its own source, with a stable id derived from the source line. This pass
// replaces the source with the drawn SVG. On failure the source stays on
// screen, which is §4.2 rule 3: failing loudly and readably beats an empty box.

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
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  });

  for (const block of blocks) {
    try {
      const { svg } = await mermaid.render(`${block.id}-svg`, block.textContent ?? "");
      block.innerHTML = svg;
      // The <pre> keeps `white-space: pre` and a monospace font otherwise, and
      // the SVG inherits both and draws wrong. The stylesheet resets them on
      // this attribute.
      block.dataset.rendered = "true";
    } catch (error) {
      console.warn(`[rex] mermaid: ${block.id} did not render`, error);
      // §4.2 rule 3 — the source stays on screen. Do not clear the block.
    }
  }
}
