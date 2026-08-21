// Spec 03 §8 — DOCX, through mammoth, in main.
//
// mammoth converts a .docx to semantic HTML — headings, paragraphs, lists,
// tables — from bytes, with no DOM. So it runs here and takes the same path as
// Markdown: static HTML, straight into the iframe, no enrichment pass at all.
// DOCX is therefore the cheapest of the three formats to add, which is the
// opposite of what spec 01's tier table implies. It is tier 1 in everything but
// the ability to write back.
//
// What is lost: page layout, headers and footers, fonts and colours, text
// boxes, tracked changes and Word comments. That is acceptable because REX
// anchors on *text*, and a comment's unit is a passage, not a page. Reviewing a
// Word file in REX means reviewing its prose.

import { convertToHtml } from "mammoth";

export interface RenderedDocx {
  html: string;
  /** The first <h1>, for the window title. Null when the file has none. */
  title: string | null;
}

const HEADING = /<h1[^>]*>([\s\S]*?)<\/h1>/i;

/** Strips mammoth's inline markup out of a heading so the title is plain text. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function renderDocx(path: string): Promise<RenderedDocx> {
  // Asynchronous, which is what makes `renderDocument` async (§8.1).
  const { value, messages } = await convertToHtml({ path });

  // `messages` is not noise: it lists every style mammoth did not recognise.
  // When a DOCX renders as a wall of undifferentiated paragraphs, the reason is
  // in here — usually that the author used direct formatting instead of Word's
  // built-in heading styles, which mammoth cannot map because there is nothing
  // to map. Logged once per document, never per paragraph.
  if (messages.length > 0) {
    console.info(`[rex] docx: ${messages.length} unmapped styles in ${path}`);
    for (const message of messages) console.info(`[rex] docx:   ${message.message}`);
  }

  const heading = HEADING.exec(value);
  const title = heading ? plainText(heading[1]) : null;
  return { html: value, title: title && title.length > 0 ? title : null };
}
