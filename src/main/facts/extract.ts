// Spec 07 §4.3 — stage 2. WORKER (§10.2).
//
// One gateway call per chunk, structured output against `ExtractedClaim`, then
// the one guard that is not negotiable: the quote must appear verbatim in the
// chunk, checked in code and never trusted.

import type { Anchor, ExtractedClaim } from "../../shared/types.ts";
import { type Chunk, locateQuote } from "./chunk.ts";
import { type CallStats, CLAIMS_SCHEMA, type Gateway, parseClaims } from "./gateway.ts";
import type { DocumentText } from "./text.ts";

/**
 * §4.2 — 1,500 tokens of source is about 800 tokens of JSON. The cap is set well
 * above that rather than at it: a reply that hits the cap is truncated JSON, and
 * on a local model that wastes a whole minute (§5.3) to learn nothing.
 */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * §4.3 — the system prompt.
 *
 * Milestone 0 exists to tune this, and it has been. What the first draft in the
 * spec produced, measured against `local-31b` on 2026-08-21:
 *
 *   - `subject` came back as the sentence's grammatical subject — "ProtoBot",
 *     "The team", "The dispatcher". Those are noun phrases, so they pass the
 *     letter of the rule and fail its purpose: nothing merges, because two
 *     documents discussing the same decision name different actors. §3.1 needs
 *     the *attribute* — "implementation language" — because that is the merge
 *     key the whole three-level model rests on.
 *   - `value` came back as a predicate — "is written in TypeScript." — where
 *     §3.2 wants "TypeScript". A value carrying its own verb never matches
 *     another document's phrasing of the same fact.
 *   - `modality` came back as `decided` for "considered Python and rejected
 *     it", which is the single confusion §3.2 rule 3 warns produces more false
 *     red lines than any other cause.
 *
 * All three are failures of *demonstration*, not of capability: the fix is
 * worked examples showing the split, not more prose about it.
 */
export const EXTRACT_SYSTEM_PROMPT = `You extract claims from one passage of a document.

A claim is one thing asserted about one subject. Return every claim the passage
makes, and nothing the passage does not say.

FIELDS

- subject: the TOPIC being decided or described, as a short noun phrase. It is
  what a reader would put in an index, not the grammatical subject of the
  sentence. Never a sentence, never a verb.
- value: what is asserted about that subject. Short, and with no verb — it
  completes "the <subject> is …".
- quote: one sentence from the passage, copied exactly, character for character,
  including its punctuation. If you cannot copy it exactly, do not return the
  claim.
- modality: decided | proposed | rejected | observed.
- statedAt: a date the passage itself gives for this claim, ISO 8601, or null.
  Never today's date, and never a date you inferred.

SPLITTING SUBJECT FROM VALUE

  "ProtoBot is written in TypeScript."
    subject: "implementation language"   NOT "ProtoBot"
    value:   "TypeScript"                NOT "is written in TypeScript"

  "The dispatcher runs as a separate service."
    subject: "dispatcher deployment"     NOT "The dispatcher"
    value:   "a separate service"        NOT "runs as a separate service"

  "Comments are stored in SQLite at ~/.rex/rex.db."
    subject: "comment storage"
    value:   "SQLite at ~/.rex/rex.db"

Two documents that disagree must produce the SAME subject and DIFFERENT values.
If your subject names the actor rather than the topic, nothing will ever line up.

MODALITY

  "We use TypeScript."                          -> decided
  "The team considered Python and rejected it." -> rejected
  "We could add a cache later."                 -> proposed
  "The build currently takes nine minutes."     -> observed

An option that was considered and turned down is "rejected", never "decided",
even when the sentence also names what was chosen. If one sentence both rejects
one option and decides another, return two claims.

Return an empty list if the passage asserts nothing — a heading, a table of
contents, or a code listing usually asserts nothing.`;

/**
 * §4.3 step 2 — the quote's offsets become an `Anchor`, so evidence is anchored
 * exactly like a comment is and the renderer resolves it with code that already
 * exists.
 *
 * It cannot literally call `src/renderer/anchor/create.ts`, which the spec's
 * wording suggests: that function needs a live `Range` and a `TextIndex` built
 * from a DOM, and invariant I1 keeps both in the renderer. What it does instead
 * is produce the same *shape* over the same normalised text — which is exactly
 * as good, because layer 1 of spec 01 §6.5 matches on `quote.exact` and nothing
 * else, and `text.ts` guarantees that string is character-for-character what the
 * renderer's index will hold.
 *
 * The three layers it leaves null are honest rather than missing:
 *
 *   - `element` and `source` would need the DOM node the quote sits in, which
 *     the worker does not have. A wrong CSS path is worse than none — spec 01
 *     §6.5 makes layer 3 deliberately unreachable for a text anchor anyway.
 *   - `region` is for a dragged box, and nothing here drags one.
 *
 * `position` is filled and is a genuine hint rather than a guarantee: enrichment
 * in the renderer (KaTeX, highlight.js) can shift offsets after a diagram. §6.5
 * uses it only to pick between repeats and to seed the fuzzy search, both of
 * which degrade gracefully.
 */
const CONTEXT_CHARS = 32;

export function anchorForQuote(document: DocumentText, at: { start: number; end: number }): Anchor {
  const { text } = document;
  return {
    quote: {
      exact: text.slice(at.start, at.end),
      prefix: text.slice(Math.max(0, at.start - CONTEXT_CHARS), at.start),
      suffix: text.slice(at.end, Math.min(text.length, at.end + CONTEXT_CHARS)),
    },
    position: { start: at.start, end: at.end },
    element: null,
    region: null,
    source: null,
  };
}

export interface ExtractedFromChunk {
  claims: Array<{
    claim: ExtractedClaim;
    /** §4.3 step 2 — ready for `fact_evidence.anchor`. */
    anchor: Anchor;
  }>;
  /** §4.3 step 1 and §7.4 — claims dropped because the quote was not verbatim. */
  droppedQuotes: number;
  stats: CallStats;
}

function userPrompt(chunk: Chunk): string {
  const heading = chunk.heading ? `SECTION: ${chunk.heading}\n\n` : "";
  return `${heading}PASSAGE:\n${chunk.text}`;
}

/**
 * Extracts one chunk. Throws only when the call itself failed after its retry —
 * §4.3 records that chunk as failed and the build continues.
 */
export async function extractChunk(
  gateway: Gateway,
  alias: string,
  document: DocumentText,
  chunk: Chunk,
): Promise<ExtractedFromChunk> {
  const { value, stats } = await gateway.chat({
    alias,
    system: EXTRACT_SYSTEM_PROMPT,
    user: userPrompt(chunk),
    schema: CLAIMS_SCHEMA,
    schemaName: "claims",
    maxTokens: MAX_OUTPUT_TOKENS,
    parse: parseClaims,
  });

  const claims: ExtractedFromChunk["claims"] = [];
  let droppedQuotes = 0;

  for (const claim of value) {
    // §4.3 step 1 — the cheapest hallucination guard available, one string
    // search. A quote that does not match is not evidence of anything, and an
    // anchor built from it could only ever orphan.
    const at = locateQuote(document, chunk, claim.quote);
    if (!at) {
      droppedQuotes++;
      continue;
    }
    claims.push({ claim, anchor: anchorForQuote(document, at) });
  }

  return { claims, droppedQuotes, stats };
}
