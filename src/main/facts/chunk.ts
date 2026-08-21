// Spec 07 §4.2 — stage 1. WORKER (§10.2), and pure: plain code, no model, no
// cost.
//
// Why 1,500 tokens and not the whole document: the gateway's aliases cap output
// at 8,192 tokens (§5.1). A 5,000-word document would need more claims than that
// cap allows, and a truncated JSON reply is a wasted call — which on a local
// model is a wasted *minute*. 1,500 tokens of source yields roughly 8 to 15
// claims, about 800 tokens of JSON, comfortably inside the cap.

import type { DocumentText, TextBlock } from "./text.ts";

/** §4.2 — "about 1,500 tokens". */
export const CHUNK_TOKENS = 1500;

/**
 * Characters per token, for English prose in a Gemma-family tokeniser.
 *
 * An estimate on purpose. The alternative is to load a real tokeniser to decide
 * where to cut a passage that is then handed to a model with a 128k window and
 * an 8k output cap — precision nothing downstream can use. It is only ever used
 * to keep a chunk comfortably under the output cap, and §7.4 means a chunk that
 * does overrun is reported rather than silently truncated.
 */
const CHARS_PER_TOKEN = 4;

const MAX_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN;

/**
 * A heading deep enough to be a subsection rarely starts a new subject, so only
 * these begin a chunk. `h4` and below stay with the prose they introduce.
 */
const SPLIT_HEADING_LEVEL = 3;

/**
 * Below this, a chunk is not worth a call.
 *
 * A local model takes tens of seconds per call whatever the input (§5.3), so a
 * chunk holding one heading and a two-line paragraph costs the same minute as a
 * full one and returns almost nothing. Short trailing material is merged
 * backwards instead of being called on alone.
 */
const MIN_CHARS = 200;

export interface Chunk {
  /** Position in the document, 0-based. The build cursor of §4.7 counts these. */
  index: number;
  /** The chunk's text, as the renderer's index will hold it (`text.ts`). */
  text: string;
  /** Inclusive offset into `DocumentText.text`. */
  start: number;
  /** Exclusive offset into `DocumentText.text`. */
  end: number;
  /**
   * The nearest heading at or above this chunk, for the prompt.
   *
   * Extraction reads one passage with no sight of the rest of the document
   * (§4.3), so without this a chunk that says "it runs in a separate process"
   * has nothing to say *what* does. It is context for the model, never a source
   * of claims — a quote must still come from `text`.
   */
  heading: string | null;
}

/**
 * Splits one document into chunks, on heading and paragraph boundaries, never
 * mid-sentence.
 *
 * Never mid-sentence is structural rather than checked: a chunk is always a run
 * of whole blocks from `text.ts`, and a block is a whole paragraph, list or
 * table. There is no code path that can cut inside one.
 */
export function chunkDocument(document: DocumentText): Chunk[] {
  const chunks: Chunk[] = [];
  let current: TextBlock[] = [];
  let heading: string | null = null;
  /** The heading in force when `current` began, which is the one it belongs to. */
  let currentHeading: string | null = null;

  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    chunks.push({
      index: chunks.length,
      // Sliced from the blocks rather than from `document.text`, so anything
      // dropped between them — a mermaid diagram — is not silently quoted back
      // to the model as if it were prose.
      text: current.map((block) => block.text).join("\n\n"),
      start: first.start,
      end: last.end,
      heading: currentHeading,
    });
    current = [];
  };

  for (const block of document.blocks) {
    const size = current.reduce((total, b) => total + b.text.length + 2, 0);

    const startsSection = block.heading > 0 && block.heading <= SPLIT_HEADING_LEVEL;
    if (startsSection && size >= MIN_CHARS) flush();
    else if (size + block.text.length > MAX_CHARS && size >= MIN_CHARS) flush();

    if (block.heading > 0) heading = block.text;
    if (current.length === 0) currentHeading = block.heading > 0 ? null : heading;
    current.push(block);
  }
  flush();

  return chunks;
}

/**
 * Where a quote sits in the document, given the chunk it came from.
 *
 * §4.3 step 1 requires the quote to appear verbatim in the chunk before it is
 * believed, and this is the same search doing double duty: the offset it finds
 * is what `anchor.ts` turns into a `TextPosition`. Returns null when the model
 * returned something that is not in the passage — which is a hallucination, and
 * §4.3 drops and counts it.
 *
 * The chunk's text joins blocks with a blank line that the document's own text
 * does not have, so a quote spanning two blocks cannot be located and is not
 * believed. That is the right answer rather than a limitation: §3.2 asks for
 * "the exact sentence", and a sentence does not span two paragraphs.
 */
export function locateQuote(
  document: DocumentText,
  chunk: Chunk,
  quote: string,
): { start: number; end: number } | null {
  if (quote.length === 0) return null;
  if (!chunk.text.includes(quote)) return null;

  // Search the document window the chunk covers, not the whole document: a
  // sentence repeated in two sections would otherwise resolve to the first one
  // and anchor the evidence into a passage the model never read.
  const window = document.text.slice(chunk.start, chunk.end);
  const at = window.indexOf(quote);
  if (at === -1) return null;
  return { start: chunk.start + at, end: chunk.start + at + quote.length };
}
