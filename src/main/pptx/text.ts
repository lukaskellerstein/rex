// Spec 11 §7.3 — the run-merge problem, which is the one piece of real XML work
// in the whole write half.
//
// PowerPoint splits a sentence across many `<a:r>` runs, each with its own
// `<a:rPr>`, so "replace this sentence" is rarely one `<a:t>`. The title on
// slide 4 of the Agrofert deck happens to be a single run; the body copy three
// shapes along is not, and neither is any sentence a human edited twice.
//
// The rule, and its cost, stated once:
//
// - Concatenate the `<a:t>` values of the shape to find the match.
// - Write the replacement into the **first** run of the matched span and empty
//   the rest.
// - Keep the first run's `<a:rPr>` — which is automatic here, because nothing
//   outside the `<a:t>` elements is touched.
//
// This loses mid-sentence formatting: a bolded word inside a replaced sentence
// comes back unbolded. That is real, it is shown in the preview (§7.7), and it
// is better than guessing how formatting should be redistributed across words
// that no longer exist.

import { type ElementSpan, escapeXml, scanElements, splice, unescapeXml } from "./xml.ts";

/** One `<a:t>`, both as text and as the two offsets that can replace it. */
interface TextPiece {
  /** Offset of this piece's first character in the concatenation. */
  at: number;
  text: string;
  /** Offsets into the slide XML of the `<a:t>` element's inner content. */
  innerStart: number;
  innerEnd: number;
}

/** Paragraphs are separate lines on the slide, so they concatenate as such. */
const PARAGRAPH_BREAK = "\n";

/**
 * Every `<a:t>` inside `range`, in document order, with the text they spell out.
 *
 * `range` is a `<p:txBody>` rather than the whole shape: a `<p:sp>` can carry
 * text in places that are not its body — a `<p:cNvPr descr>` is one — and an
 * edit that reached into those would change something the reviewer never saw.
 */
export function textPieces(xml: string, range: ElementSpan): { pieces: TextPiece[]; text: string } {
  const pieces: TextPiece[] = [];
  let text = "";

  const paragraphs = scanElements(xml, "a:p", range.openEnd, range.innerEnd);
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) text += PARAGRAPH_BREAK;
    for (const span of scanElements(xml, "a:t", paragraph.openEnd, paragraph.innerEnd)) {
      const value = unescapeXml(xml.slice(span.openEnd, span.innerEnd));
      pieces.push({
        at: text.length,
        text: value,
        innerStart: span.openEnd,
        innerEnd: span.innerEnd,
      });
      text += value;
    }
  });

  return { pieces, text };
}

/**
 * Where `needle` sits in `haystack`, exactly if it can and across whitespace if
 * it must.
 *
 * The flexible pass exists because the agent reads the text sidecar, where the
 * text of a shape has already been collapsed to single spaces (§6.2) — so a
 * sentence that spans two paragraphs in the deck reaches the plan with a space
 * where the deck has a newline. Refusing that would refuse most real edits, and
 * the operation still names what it expects to find, which is the protection
 * §7.2.2 rule 1 is actually after.
 */
function locate(haystack: string, needle: string): { start: number; end: number } | null {
  const exact = haystack.indexOf(needle);
  if (exact !== -1) return { start: exact, end: exact + needle.length };

  const words = needle
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return null;

  const match = new RegExp(words.join("\\s+")).exec(haystack);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

export interface ReplaceOutcome {
  xml: string;
  /** True when the match spanned more than one run, so formatting was flattened. */
  runsMerged: boolean;
  /** True when the match spanned more than one paragraph. */
  paragraphsMerged: boolean;
}

/**
 * Replace `from` with `to` inside one text body.
 *
 * Refuses when `from` is not there — §7.2.2 rule 1, the anchor fingerprint idea
 * applied to edits. An operation that names its expectation cannot silently act
 * on something else.
 */
export function replaceText(
  xml: string,
  body: ElementSpan,
  from: string,
  to: string,
): ReplaceOutcome {
  const { pieces, text } = textPieces(xml, body);
  if (pieces.length === 0) throw new Error("This shape holds no text to replace.");

  const span = locate(text, from);
  if (!span) {
    throw new Error(
      `This shape does not currently say '${clip(from)}'. It says '${clip(text)}'. Nothing was written.`,
    );
  }

  const touched = pieces.filter(
    (piece) => piece.at < span.end && piece.at + piece.text.length > span.start,
  );
  if (touched.length === 0) throw new Error("The matched text does not fall inside any run.");

  const first = touched[0];
  const last = touched[touched.length - 1];
  // The head and tail of the first and last runs that the match did not cover.
  const head = first.text.slice(0, Math.max(0, span.start - first.at));
  const tail = last.text.slice(Math.max(0, span.end - last.at));

  const paragraphsMerged = text.slice(span.start, span.end).includes(PARAGRAPH_BREAK);

  // Written back to front, so every offset ahead of the edit is still valid.
  let out = xml;
  for (let i = touched.length - 1; i >= 0; i--) {
    const piece = touched[i];
    let replacement = "";
    if (i === 0) replacement = head + to + (touched.length === 1 ? tail : "");
    else if (i === touched.length - 1) replacement = tail;
    out = splice(out, piece.innerStart, piece.innerEnd, escapeXml(replacement));
  }

  return { xml: out, runsMerged: touched.length > 1, paragraphsMerged };
}

/** Enough of a string to recognise it in a refusal, and no more. */
function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}
