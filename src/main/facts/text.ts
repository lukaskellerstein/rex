// Spec 07 §4.2 — the document's text, as the renderer will see it.
//
// WORKER (§10.2), and pure: no Electron, no DOM, no database. `node --test` runs
// it directly.
//
// This file exists because of one requirement in §4.3 step 2: every claim's
// quote becomes an `Anchor`, and that anchor is resolved in the renderer against
// the **live DOM** (invariant I1). Layer 1 of spec 01 §6.5 is an exact string
// match over `textIndex.ts`'s normalised text — so a quote that is not
// character-for-character a substring of that text can never resolve, however
// good the extraction was. The whole feature would report `orphaned` for
// everything and look like a model problem.
//
// So the normalisation below is not "a reasonable way to flatten HTML". It is a
// deliberate copy of `src/renderer/anchor/textIndex.ts`, and the two must not
// drift:
//
//   - a whitespace run collapses to exactly one space (`emitText`),
//   - leading whitespace at the very start of the document is dropped,
//   - a run spanning a node boundary still yields one space,
//   - tags are zero-width — `<p>a</p><p>b</p>` is `ab`, exactly as `textContent`
//     is, and the separating space in real Markdown output comes from the
//     newline markdown-it emits between blocks,
//   - SCRIPT, STYLE, NOSCRIPT, TEMPLATE, HEAD, TITLE and DESC never contribute.
//
// What it does *not* reproduce is `position`, and it does not need to: §6.5 uses
// `TextPosition` only to disambiguate a repeated quote and to seed the fuzzy
// search. An offset that is off by the length of a diagram still resolves at
// layer 1. `quote` is the load-bearing field; `position` is a hint.

import { decodeHTML } from "entities";

/** Never contributes visible prose (spec 01 §6.3 rule 2, `textIndex.ts`). */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "title", "desc"]);

/**
 * Void elements, which have no closing tag. Without this list a `<br>` would
 * open a depth that never closes and every block after it would be swallowed.
 */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * What the chunker treats as one indivisible piece of the document.
 *
 * Only the **outermost** one is recorded, so a `<ul>` is one block rather than
 * one per `<li>`, and a `<table>` is one block rather than one per cell. That is
 * the right granularity for §4.2's "never mid-sentence": markdown-it emits these
 * as a flat sequence at the top level, which is exactly the sequence a reader
 * sees.
 */
const BLOCK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "dl",
  "pre",
  "blockquote",
  "table",
  "figure",
  "hr",
]);

/**
 * A mermaid fence, which `src/renderer/overlay/mermaid.ts` replaces with a
 * rendered SVG: `block.innerHTML = svg`.
 *
 * Its source text is therefore in the HTML main produced and **not** in the DOM
 * the resolver indexes, so a claim quoting it could never resolve. Dropping it
 * here is also the honest reading of §4.3 — a flowchart's node labels are not
 * prose making a claim, and extracting from them yields subjects like
 * `Frontend\n(Web UI or TUI)`.
 */
const MERMAID_CLASS = "rex-mermaid";

export interface TextBlock {
  /** This block's own normalised text. */
  text: string;
  /** Inclusive offset into `DocumentText.text`. */
  start: number;
  /** Exclusive offset into `DocumentText.text`. */
  end: number;
  /** Lower-case tag name. */
  tag: string;
  /** 1..6 for `h1`..`h6`, 0 for everything else. */
  heading: number;
}

export interface DocumentText {
  /** The whole document, normalised exactly as `textIndex.ts` would. */
  text: string;
  /** The outermost block elements, in document order. */
  blocks: TextBlock[];
}

/**
 * Entities become the character the DOM would hold.
 *
 * `entities` rather than a hand-written table, because a hand-written table is
 * wrong and fails silently: HTML5 defines about two thousand named references,
 * and every one that is missing survives into the text as its own source —
 * `&middot;` staying `&middot;` where the DOM holds `·`. That shifts every offset
 * after it, and makes any quote containing it unresolvable at layer 1. Measured
 * exactly that way on 2026-08-21 against the review HTML document, by the test
 * beside this file, which is why the table is gone.
 *
 * `decodeHTML` and not `decodeHTMLStrict`: a browser resolves `&amp` without its
 * semicolon in text content, and matching the browser is the whole job here.
 *
 * `&nbsp;` becomes U+00A0 rather than a plain space, which is right — JavaScript's
 * `\s` matches U+00A0, so the collapsing below turns it into one space, the same
 * thing the browser's own text node does. By rule rather than by luck.
 */
function decodeEntities(value: string): string {
  return value.includes("&") ? decodeHTML(value) : value;
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attributes: string;
}

/**
 * Reads one tag starting at `html[from]`, honouring quoted attribute values.
 *
 * A plain `/<[^>]+>/` is wrong on `<a title="a > b">`, and being wrong there
 * does not throw — it emits the rest of the attribute as if it were prose, which
 * shifts every offset after it and poisons a quote that looked fine. Returns
 * null when this is not a tag after all, so a bare `<` in text stays text.
 */
function readTag(html: string, from: number): { tag: Tag; end: number } | null {
  let i = from + 1;
  const closing = html[i] === "/";
  if (closing) i++;

  const nameStart = i;
  while (i < html.length && /[a-zA-Z0-9:-]/.test(html[i])) i++;
  if (i === nameStart) return null;
  const name = html.slice(nameStart, i).toLowerCase();

  const attributesStart = i;
  let quote: string | null = null;
  while (i < html.length) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      const attributes = html.slice(attributesStart, i);
      return {
        tag: { name, closing, selfClosing: attributes.trimEnd().endsWith("/"), attributes },
        end: i + 1,
      };
    }
    i++;
  }
  return null;
}

function hasClass(attributes: string, wanted: string): boolean {
  const match = attributes.match(/\bclass\s*=\s*("([^"]*)"|'([^']*)')/i);
  const value = match?.[2] ?? match?.[3];
  return value ? value.split(/\s+/).includes(wanted) : false;
}

const WHITESPACE = /\s/;

/**
 * HTML → the text the renderer's index will hold, plus its block structure.
 *
 * `html` is a fragment or a whole page; a `<head>` is skipped either way.
 */
export function htmlToText(html: string): DocumentText {
  const out: string[] = [];
  let length = 0;
  /** True when the last emitted character was a collapsed space. */
  let pendingSpace = false;

  const blocks: TextBlock[] = [];
  /**
   * The block being recorded, or null when between blocks.
   *
   * `pieceFrom` is an index into `out`, not into the text: joining only this
   * block's own pieces keeps closing a block O(block) instead of O(document),
   * which on a 1,000-block file is the difference between linear and quadratic.
   */
  let open: { tag: string; heading: number; textFrom: number; pieceFrom: number } | null = null;
  /** Nesting depth inside the recorded block, so only the outermost is taken. */
  let blockDepth = 0;
  /** Nesting depth inside a subtree whose text is dropped entirely. */
  let skipDepth = 0;
  let skipTag: string | null = null;

  const emit = (raw: string): void => {
    const data = decodeEntities(raw);
    for (let i = 0; i < data.length; ) {
      if (WHITESPACE.test(data[i])) {
        let j = i;
        while (j < data.length && WHITESPACE.test(data[j])) j++;
        // Leading whitespace at the very start is dropped; elsewhere a run
        // becomes one space, and a run already covered by a previous space is
        // dropped too. `textIndex.ts` `emitText`, character for character.
        if (length > 0 && !pendingSpace) {
          out.push(" ");
          length++;
          pendingSpace = true;
        }
        i = j;
        continue;
      }
      const start = i;
      while (i < data.length && !WHITESPACE.test(data[i])) i++;
      out.push(data.slice(start, i));
      length += i - start;
      pendingSpace = false;
    }
  };

  let cursor = 0;
  for (let i = 0; i < html.length; i++) {
    if (html[i] !== "<") continue;

    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      if (close === -1) break;
      if (skipDepth === 0) emit(html.slice(cursor, i));
      cursor = close + 3;
      i = close + 2;
      continue;
    }

    if (html.startsWith("<!", i)) {
      const close = html.indexOf(">", i);
      if (close === -1) break;
      if (skipDepth === 0) emit(html.slice(cursor, i));
      cursor = close + 1;
      i = close;
      continue;
    }

    const read = readTag(html, i);
    if (!read) continue;

    if (skipDepth === 0) emit(html.slice(cursor, i));
    cursor = read.end;
    i = read.end - 1;

    const { tag } = read;

    if (skipDepth > 0) {
      if (tag.name === skipTag) skipDepth += tag.closing ? -1 : 1;
      if (skipDepth === 0) skipTag = null;
      continue;
    }

    const dropped =
      SKIP_TAGS.has(tag.name) || (tag.name === "pre" && hasClass(tag.attributes, MERMAID_CLASS));
    if (dropped && !tag.closing && !tag.selfClosing && !VOID_TAGS.has(tag.name)) {
      skipDepth = 1;
      skipTag = tag.name;
      continue;
    }

    if (!BLOCK_TAGS.has(tag.name)) continue;

    if (tag.closing) {
      if (open === null) continue;
      blockDepth--;
      if (blockDepth > 0) continue;
      const raw = out.slice(open.pieceFrom).join("");
      const text = raw.trim();
      if (text.length > 0) {
        // Measured rather than assumed. A block can pick up a space at either
        // end — `<p> a </p>`, or the newline before the next block landing
        // inside a `<blockquote>` — and guessing "one leading space" put `end`
        // one character past the text, which is a quote that starts right and
        // ends on the neighbour's first letter.
        const lead = raw.length - raw.trimStart().length;
        blocks.push({
          text,
          start: open.textFrom + lead,
          end: open.textFrom + lead + text.length,
          tag: open.tag,
          heading: open.heading,
        });
      }
      open = null;
      continue;
    }

    if (open !== null) {
      blockDepth++;
      continue;
    }

    // A void or self-closed block — `<hr>` — opens and closes at once and has no
    // text, so it is simply not a block worth recording.
    if (VOID_TAGS.has(tag.name) || tag.selfClosing) continue;
    const heading = /^h[1-6]$/.test(tag.name) ? Number(tag.name[1]) : 0;
    open = { tag: tag.name, heading, textFrom: length, pieceFrom: out.length };
    blockDepth = 1;
  }

  if (skipDepth === 0) emit(html.slice(cursor));

  return { text: out.join(""), blocks };
}
