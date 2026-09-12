// SPEC.md §8.6 — system prompts, verbatim, and the templates that build a
// user prompt from a thread.

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import {
  findPart,
  locateFence,
  partLabel,
  scanDiagram,
  textOfLines,
} from "../../shared/diagram.ts";
import {
  type Anchor,
  type DiagramRef,
  ELEMENT_QUOTE_MAX,
  type LineRange,
  type Message,
  type Thread,
} from "../../shared/types.ts";
import { type Attributes, FRAME_NOTE, type Tags, tagsFor } from "./tags.ts";

export const READ_SYSTEM_PROMPT = `You answer questions about a document. The user has highlighted a passage and
written a comment about it. Answer that comment.

${FRAME_NOTE}

You have read-only access to the repository containing the document. Use it.
Read the surrounding sections, other documents, the source code, and the git
history whenever they help you give a correct and specific answer. You cannot
change any file, and you should not try.

You may also fetch the web to check a claim the document makes. Do that when the
comment asks whether something is still true, still current, or consistent with
what is published elsewhere, and whenever the passage cites a source you can
open. You still cannot write anything, anywhere, by any route.

Fetch with whichever of these you actually have. If you have a \`WebFetch\` or
\`web_search\` tool, use it. Otherwise use the shell: \`curl -sL --max-time 15
<url>\` prints a page to stdout. The flags that write a file or send a body —
\`-o\`, \`-O\`, \`-d\`, \`-F\`, \`-T\`, \`-X POST\` — are refused, and that is
the only thing about \`curl\` that is refused.

If the reviewer asks you to change a file, say that this message was sent in
ASK, that ASK cannot write, and that the same request sent with the switch on
ACT will make the change. Do not paste the change into the thread.

The \`LSP\` tool is deferred: its name is listed but it has no schema until you
call ToolSearch("select:LSP"). Do that before any question about where a symbol
is defined, who implements it, or what calls it. It is much more reliable than
grep for those questions.

When the document is a PowerPoint deck, the file you are given is a Markdown
text version of it, written by REX: one section per slide, each shape listed by
the name PowerPoint gave it, followed by that shape's text and the speaker
notes. Read it. It is a copy for reading and never something to edit — nothing
you write to it would ever reach the deck.

Be concrete. Quote what you found and say where you found it as file:line.
If the answer depends on something you cannot determine, say so plainly rather
than guessing.`;

export const WRITE_SYSTEM_PROMPT = `You are applying a change to one or more documents that was agreed in a
discussion. The full discussion is given below, inside <rex-discussion>, and
what to do is inside <rex-instruction>.

${FRAME_NOTE}

Make the smallest change that achieves what was agreed. Do not reformat
surrounding text, do not fix unrelated issues, and do not improve prose that
nobody asked about.

You may be given several files. Change only the ones the discussion actually
calls for. Leaving a file exactly as it is is a correct outcome, and is better
than finding something to adjust in it.

Edit the source file, not the rendered output.`;

/**
 * Spec 11 §7.2 — the write prompt for a deck, where the agent does not edit
 * anything at all.
 *
 * Apply on a `.pptx` inverts who does the writing: the agent produces a plan,
 * REX validates it, performs it on a copy, and shows the reviewer a picture of
 * the result. That exists because the write profile's hook allows every tool,
 * so an agent asked to change a deck *could* splice arbitrary bytes into the
 * reviewer's file with nothing between it and the deck.
 *
 * §6.4.5's instruction about Mermaid is in here rather than in a skill, because
 * `graph-generation` tells an agent to rasterise a diagram with a Playwright
 * MCP — which REX's allowlist refuses — and the agent follows the more specific
 * instruction unless told otherwise.
 */
export const DECK_WRITE_SYSTEM_PROMPT = `You are proposing a change to a PowerPoint deck that was agreed in a
discussion. The full discussion is given below, inside <rex-discussion>, and
what to do is inside <rex-instruction>.

${FRAME_NOTE}

You do not edit the deck. You cannot: it is a zip, and REX is the only thing
that writes into it. What you produce is a PLAN, as one JSON file, and REX
validates it, performs it on a copy, and shows the reviewer the affected slides
before and after. A plan that names something the deck does not contain is
refused and nothing is written.

Read the deck's text through the Markdown file named below — one section per
slide, each shape listed by the name PowerPoint gave it. Those names are how
the plan addresses shapes, so use them exactly as they appear.

Write the plan with the Write tool, to the exact path given below, and write
nothing anywhere else.

The plan looks like this:

{
  "deck": "/absolute/path/to/the.pptx",
  "operations": [
    { "op": "setText", "slide": 4, "shape": "Text 1",
      "from": "Onion: the group data plane",
      "to": "Onion: the group control plane" }
  ]
}

There are exactly thirteen operations. Use one of these and never invent
another — a plan naming an operation that is not on this list is refused whole,
and nothing is written.

TEXT
  { "op": "setText", "slide": 4, "shape": "Text 1", "from": "…", "to": "…" }
  { "op": "insertTextBox", "slide": 4, "box": {…}, "text": "…", "name": "…" }

PICTURES — every one takes a "source", which is one of four shapes:
    { "from": "web", "query": "…", "url": "…", "credit": "…", "licence": "…" }
    { "from": "diagram", "engine": "mermaid", "source": "flowchart LR\\n  A --> B" }
    { "from": "file", "path": "/abs/path.png" }
    { "from": "generated", "engine": "image", "prompt": "…", "path": "/abs/path.png" }

  { "op": "insertImage", "slide": 4, "box": {…}, "source": {…}, "alt": "…" }
  { "op": "insertImage", "slide": 4, "placement": "background", "source": {…}, "alt": "…" }
  { "op": "replaceImage", "slide": 4, "shape": "Picture 3", "from": "…", "source": {…}, "alt": "…" }
  { "op": "insertVideo", "slide": 4, "box": {…}, "source": {…}, "alt": "…" }

SHAPES
  { "op": "moveShape", "slide": 4, "shape": "Shape 3", "from": {…box…}, "to": {…box…} }
  { "op": "setStyle", "slide": 4, "shape": "Text 1", "scope": "shape",
    "from": { "fontSize": 24 }, "set": { "fontSize": 32, "bold": true } }
  { "op": "deleteShape", "slide": 4, "shape": "Text 4", "from": "the text it holds now" }

SLIDES
  { "op": "reorderSlides", "order": [1, 2, 3, 7, 4, 5, 6, 8] }
  { "op": "duplicateSlide", "slide": 4 }
  { "op": "deleteSlide", "slide": 4, "from": "that slide's title" }

NOTES
  { "op": "setNotes", "slide": 4, "from": "the note it holds now", "to": "…" }

DECK
  { "op": "setThemeFont", "major": "Georgia", "minor": "Inter" }

A diagram is therefore an **insertImage with a diagram source**. There is no
operation that takes Mermaid on its own.

Rules that decide whether a plan runs at all:

- Every operation that changes something which already exists must carry
  "from" — what it expects to find. If the deck does not currently say that,
  the whole run is refused and nothing is written.
- Shapes are addressed by name, never by position. Slides are addressed by
  their current position, counting from 1.
- setNotes changes the speaker notes and nothing on the slide itself. Its
  "from" is the note as the sidecar shows it under "### Notes", and it is an
  empty string when the slide has no notes yet.
- Boxes are fractions of the slide — {"x":0.05,"y":0.28,"w":0.42,"h":0.55} —
  never points. A deck can be 16:9 or 4:3 and a plan in points misplaces
  everything on the other one.
- A plan may not both reorder slides and edit them. Do one or the other.
- Make the smallest change the discussion actually calls for. Leaving the deck
  alone is a correct outcome when nothing was agreed.

Write Mermaid **source** into a plan when a diagram is wanted. Do not render
it, screenshot it, or produce an image file. REX draws it.`;

/**
 * Spec 11 §6.4.3 — said plainly when generation is off, so the agent does not
 * plan around a tool that will refuse it.
 */
export const NO_GENERATION_NOTE = `Generated pictures and video are NOT available in this REX. Do not use
"from": "generated" in a plan and do not call any media generation tool. Use a
real picture from the web, a file already on this machine, or Mermaid source.`;

/**
 * Spec 19 §4.6 — what the agent is told before it changes a Word file.
 *
 * The same three loads as the deck prompt: you do not edit the file, you write
 * a plan, and a plan that names something the document does not contain is
 * refused. Two instructions a deck does not need are here because a `.docx` is
 * a zip an agent could plausibly open by hand — §4.2's warning — and because a
 * paragraph is addressed by two things at once, not one.
 */
export const DOCX_WRITE_SYSTEM_PROMPT = `You are proposing a change to a Word document that was agreed in a
discussion. The full discussion is given below, inside <rex-discussion>, and
what to do is inside <rex-instruction>.

${FRAME_NOTE}

You do not edit the document. You cannot: it is a zip of XML, and REX is the
only thing that writes into it. What you produce is a PLAN, as one JSON file,
and REX validates it, performs it on a copy, and shows the reviewer the before
and after. A plan that names something the document does not contain is refused
and nothing is written.

Do NOT open the .docx yourself with any tool. Read the document's text through
the Markdown file named below. Every paragraph in it is numbered, and those
numbers are how the plan addresses paragraphs.

Write the plan with the Write tool, to the exact path given below, and write
nothing anywhere else.

The plan looks like this:

{
  "document": "/absolute/path/to/the.docx",
  "operations": [
    { "op": "setText", "at": 34,
      "from": "the paragraph exactly as the sidecar shows it",
      "to": "what it should say instead" }
  ]
}

There are exactly nine operations. Use one of these and never invent another —
a plan naming an operation that is not on this list is refused whole, and
nothing is written.

TEXT
  { "op": "setText", "at": 34, "from": "…", "to": "…" }
  { "op": "insertParagraph", "after": 34, "text": "…", "style": "Heading2" }
  { "op": "deleteParagraph", "at": 34, "from": "…" }
  { "op": "moveParagraph", "at": 34, "from": "…", "after": 12 }

SHAPE
  { "op": "setStyle", "at": 34, "set": { "bold": true, "fontSize": 14 } }
  { "op": "setHeadingLevel", "at": 34, "from": "…", "level": 2 }
  { "op": "setListLevel", "at": 34, "from": "…", "level": 2 }

TABLE — "at" is any paragraph inside the table
  { "op": "insertRow", "at": 51, "cells": ["Week 4", "Agents", "3h"] }
  { "op": "deleteRow", "at": 51, "from": ["Week 3", "Tools", "3h"] }

Rules that decide whether a plan runs at all:

- Address a paragraph by BOTH its number and its text. "at" is the number in
  the sidecar; "from" is what that paragraph says now, copied exactly. If the
  two disagree the operation is refused and nothing is written.
- Every operation that changes something which already exists must carry
  "from". setStyle is the exception: the sidecar does not show formatting, so
  it cannot be quoted.
- A paragraph the sidecar marks "locked" cannot be changed at all. Do not plan
  an edit to one.
- Every number in one plan refers to the document as the sidecar shows it now.
  Do not renumber for your own earlier operations, and do not change the same
  paragraph twice — REX refuses that.
- A cell is an ordinary paragraph with its own number. Use setText on it. There
  is no setCellText.
- Make the smallest change the discussion actually calls for. Leaving the
  document alone is a correct outcome when nothing was agreed.`;

/**
 * Spec 54 §9 — the heading rank of every line, with fenced code excluded.
 *
 * `# from PyPI` inside a ```bash fence is a shell comment, not an h1. Every
 * scanner here used to match it with a bare `/^#{1,6}\s/`, so a section holding
 * a shell or Python fence was cut at its first comment line and its range was
 * short by a dozen lines. Nothing said so — the agent was handed a section that
 * stopped mid-fence and answered about the half it could see.
 *
 * `null` is "not a heading". A fence line is never one, and neither is anything
 * between a fence and its close.
 */
function headingRanks(lines: readonly string[]): Array<number | null> {
  const ranks: Array<number | null> = [];
  let fence: { marker: string; length: number } | null = null;

  for (const line of lines) {
    const rail = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      // CommonMark: a fence closes on the same character, at least as long, and
      // with nothing after it. An info string only ever opens one.
      if (rail && rail[0] === fence.marker && rail.length >= fence.length) {
        if (/^ {0,3}(?:`{3,}|~{3,})\s*$/.test(line)) fence = null;
      }
      ranks.push(null);
      continue;
    }
    if (rail) {
      fence = { marker: rail[0], length: rail.length };
      ranks.push(null);
      continue;
    }
    const heading = /^(#{1,6})\s/.exec(line);
    ranks.push(heading ? heading[1].length : null);
  }
  return ranks;
}

/**
 * Spec 54 §4 — what the reviewer picked, as text.
 *
 * The body of `rex-section` is the **selection itself**, never the section
 * around it. Before 2026-09-11 REX inlined up to 2000 characters of enclosing
 * section as a head start and put a truncated copy of the pick beside it; the
 * reviewer read one of those prompts and asked what the second block was for.
 * It was the address. An address is an attribute, so both are gone.
 *
 * Where the file can be read and the pick has a line range, the text comes from
 * the FILE, at full length. The stored quote is the fallback, and for a block
 * pick it is capped at `ELEMENT_QUOTE_MAX` — which is what `truncated` reports,
 * because a table cut at 320 characters that does not say so is read as the
 * whole table.
 */
interface Selected {
  text: string | null;
  lines: LineRange | null;
  truncated: boolean;
}

function selectedText(anchor: Anchor, documentPath: string | null): Selected {
  const quote = anchor.quote?.exact ?? null;
  const range = documentPath ? sectionLineRange(documentPath, anchor) : null;

  // A section extent names a heading and means everything under it, so its text
  // is the file's own lines rather than the heading the anchor stored.
  if (range && documentPath) {
    const source = readSource(documentPath);
    if (source !== null) {
      return {
        text: source
          .split("\n")
          .slice(range.from - 1, range.to)
          .join("\n"),
        lines: range,
        truncated: false,
      };
    }
  }

  const line = anchor.source?.line ?? null;
  return {
    text: quote,
    lines: line === null ? null : { from: line, to: line },
    truncated: quote !== null && quote.length >= ELEMENT_QUOTE_MAX,
  };
}

/** §3.1 — one line, or a range. Never a range whose ends are equal. */
function lineSpan(range: LineRange | null): string | null {
  if (!range) return null;
  return range.from === range.to ? String(range.from) : `${range.from}-${range.to}`;
}

/**
 * Spec 05 §5.5 — relative to the repository root of `targets[0]`'s document.
 *
 * A target outside that root is written absolute: a relative path that climbs
 * out of the tree tells the agent less than the real one, and `../../../..` is
 * not something it can act on.
 */
function displayPath(repositoryRoot: string, path: string): string {
  const rel = relative(repositoryRoot, path);
  return rel && !rel.startsWith("..") ? rel : path;
}

/**
 * One target, in one line.
 *
 * A quoteless anchor is described rather than dropped. Spec 04 dropped it, which
 * meant a comment about a table and a paragraph reached the agent as a comment
 * about a paragraph — and the agent answered confidently about the half it could
 * see. The selector is not pretty, but it is true and it is findable.
 *
 * Spec 06 §7.1 adds the two scopes that cover more than the thing they name.
 * Both are named by what they *are*: a section anchor stores its heading's text
 * (§4.3), and printing that bare would tell the agent the comment is about a
 * title rather than about the section under it.
 */
function placeBlock(input: {
  anchor: Anchor;
  documentPath: string | null;
  /** The reviewer's own number for this place, as the chips and outlines say it. */
  n: number;
  place: PassagePlace | null;
  added: boolean;
  tags: Tags;
}): string[] {
  const { anchor, documentPath, tags } = input;
  // Spec 24 §6.2 — the discussion an ACT prompt carries never mentions places,
  // so without this the agent sees five and a conversation that spoke of three.
  const common = {
    n: input.n,
    added: input.added ? "yes" : null,
    // Spec 16 §5.4 — a passage only the ORIGINAL has. The agent would otherwise
    // be handed text it cannot find in the file it may edit.
    version: input.place?.version === "original" ? "original" : null,
  };

  // Spec 16 §6.7 — a gap has no text of its own, so it is not a section at all.
  // It is named by both its sides: naming only the block above would let an
  // edit to that block move the insertion point.
  if (anchor.gap) {
    const between = input.place?.between ?? null;
    return [
      tags.selfClosing("insert", {
        ...common,
        after: neighbourQuote(anchor.gap.after ?? null),
        before: neighbourQuote(anchor.gap.before ?? null),
        lines:
          between && between.after !== null && between.before !== null
            ? `${between.after}-${between.before}`
            : null,
      }),
    ];
  }

  // Spec 29 §5.8 — a diagram part, in the words of the source and the line it
  // is on now. Its body is the declaring line, not the whole fence.
  if (anchor.diagram) return diagramBlock(anchor, documentPath, common, tags);

  const selected = selectedText(anchor, documentPath);
  const attributes = {
    ...common,
    lines: lineSpan(
      selected.lines ??
        (input.place?.line ? { from: input.place.line, to: input.place.line } : null),
    ),
    // Spec 06 §4.4 — a quote at the cap is an OPENING, not the whole pick.
    // `createElementAnchor` truncates at `ELEMENT_QUOTE_MAX` so a long table
    // does not store a copy of itself; unsaid, 320 characters cut mid-word read
    // as the whole block and the agent answers about the opening.
    truncated: selected.truncated ? "yes" : null,
    element: selected.text
      ? null
      : anchor.element?.id
        ? `#${anchor.element.id}`
        : anchor.element?.css,
    region: anchor.region ? "yes" : null,
  };

  // No text and no way to get any — a figure, a region, a stored position. The
  // attributes are the whole of what REX knows, so there is no body to write.
  if (!selected.text) return [tags.selfClosing("section", attributes)];
  return tags.block("section", selected.text, attributes);
}

/**
 * Spec 29 §5.8 — a part of a Mermaid diagram, as the agent reads it:
 *
 *     In the Mermaid diagram (flowchart) at lines 156–162 of docs/SPEC.md:
 *        the node B, labelled "Has comment?" — declared on line 157:
 *            B{Has comment?}
 *        It is also mentioned on lines 158 and 159.
 *
 * The lines are the file's as it is NOW: the fence is found again in the file
 * by its fingerprint, else by the part (`locateFence`), and the part in it by
 * what names it (`findPart`). When the file cannot be read, or the fence is
 * gone, the stored ref still says what the part was — it carries the lines
 * that stated it — and the stored line is the last resort, as it is for every
 * anchor.
 */
function diagramBlock(
  anchor: Anchor,
  documentPath: string | null,
  common: Attributes,
  tags: Tags,
): string[] {
  const ref = anchor.diagram as DiagramRef;
  const file = documentPath ? readSource(documentPath) : null;
  const fence = file ? locateFence(file, ref) : null;
  const parts = fence ? scanDiagram(fence.source) : null;
  const found = parts ? findPart(parts, ref) : null;

  // The fence's opening line: from the file when it was found there, else
  // worked back from the stored line, which is the part's own.
  const fenceLine =
    fence?.fenceLine ?? (anchor.source ? anchor.source.line - ref.lines.from : null);
  const lines = found?.lines ?? ref.lines;
  const at = (line: number): string => String(fenceLine === null ? line : fenceLine + line);
  const where = lines.from === lines.to ? at(lines.from) : `${at(lines.from)}-${at(lines.to)}`;
  const span =
    fence && fenceLine !== null
      ? `${fenceLine + 1}-${fenceLine + fence.source.split("\n").length}`
      : null;

  // Spec 54 §4 — the body is the part's own source, as the file holds it now.
  // Everything REX knows *about* the part is an attribute, so the body stays
  // pure document text.
  const body = fence && found ? textOfLines(fence.source, lines) : ref.text;

  const part = found?.part ?? ref.part;
  const label = parts && found ? partLabel(parts, part) : describeRefLabel(ref);
  let describes: string;
  switch (part.kind) {
    case "node":
      describes = `node ${part.id}`;
      break;
    case "edge":
      describes = `edge ${part.from} to ${part.to}`;
      break;
    case "subgraph":
      describes = `subgraph ${part.id}`;
      break;
    case "lines":
      describes = "lines";
      break;
  }

  // A node's other mentions: the agent has to change all of them, and a node is
  // declared once but referred to on every edge that touches it.
  const alsoOn =
    part.kind === "node" && parts
      ? (parts.nodes.get(part.id)?.mentions ?? []).filter((l) => l !== lines.from).map(at)
      : [];

  return tags.block("section", body, {
    ...common,
    lines: where,
    diagram: ref.type || "mermaid",
    fence: span,
    part: describes,
    label,
    also: alsoOn.length > 0 ? alsoOn.join(",") : null,
    // The fence moved or went: the body is what the part said, not what the
    // file says now, and an agent told otherwise would edit the wrong lines.
    stale: !fence && file ? "yes" : null,
  });
}

/** The label a stored ref alone can give, through the one-fence scan `describeRef` does. */
function describeRefLabel(ref: DiagramRef): string | null {
  const parts = scanDiagram(`${ref.type}\n${ref.text}`);
  return partLabel(parts, ref.part);
}

function readSource(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Spec 06 §7.1 — "the whole document" is a phrase with no action behind it, so
 * the one instruction that gives it one is stated outright.
 */
const READ_IN_FULL = `Read the document in full before answering. This comment is about all of it,
not about a passage.`;

/**
 * Spec 16 §5.4 — the sentence a comment on removed text needs.
 *
 * Without it the agent is handed a quote it cannot find in the file it may
 * edit, which reads as a mistake rather than as the point. It is the point: the
 * reviewer is looking at what the change took away and asking for it back, or
 * for something else in its place.
 */
const LOOKING_AT_THE_ORIGINAL = `The reviewer is looking at that passage in the original and asking for a change
to the current version. The current version is the file you may edit.`;

/**
 * How much of a gap's neighbour is quoted back, so the agent can find it.
 *
 * Spec 16 §6.7 — "insert here" is the one pick where there is nothing to show,
 * so both sides are named: a gap that named only the block above would let an
 * edit to that block move the insertion point, and a bare line number moves the
 * moment anything above it changes. Spec 54 §4 puts them in attributes, so the
 * text is escaped rather than tagged.
 */
const NEIGHBOUR_MAX = 160;

function neighbourQuote(side: { quote: { exact: string } | null } | null): string | null {
  const text = side?.quote?.exact?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > NEIGHBOUR_MAX ? `${text.slice(0, NEIGHBOUR_MAX)}…` : text;
}

/**
 * Spec 06 §7.1 — where a section starts and ends in the source, when that can
 * be **computed** rather than guessed.
 *
 * It needs two things: `data-src-line` on the heading, which only the Markdown
 * renderer stamps (spec 03 §5.3), and that line still holding a heading of the
 * rank the run was built from. DOCX has neither, and there the section is named
 * by its heading alone — §8.6 already refuses a guessed line for the same
 * reason, and a range that had to be guessed is worse than none.
 */
function sectionLineRange(documentPath: string, anchor: Anchor): LineRange | null {
  const from = anchor.source?.line;
  if (!from) return null;

  let source: string;
  try {
    source = readFileSync(documentPath, "utf8");
  } catch {
    return null;
  }

  const lines = source.split("\n");
  const ranks = headingRanks(lines);
  const rank = ranks[from - 1];
  // Not a Markdown heading any more — the file was edited under the anchor, or
  // it never was one. Either way there is nothing here to measure.
  if (!rank) return null;

  // §4.2 — the run ends at the next heading of the same or higher rank, so the
  // section is the line before it. `lines[i]` is line number `i + 1`.
  for (let i = from; i < lines.length; i++) {
    const next = ranks[i];
    if (next !== null && next <= rank) return { from, to: i };
  }
  return { from, to: lines.length };
}

/**
 * Spec 05 §5.5 — every target, grouped under the document it came from.
 *
 * The numbers are the target's own position in the comment, not its position in
 * its group, so they are the numbers the reviewer saw in the selection panel and
 * on the outlines. Targets that alternate between two documents therefore
 * produce 1, 3 under one heading and 2 under the other, which is correct: the
 * number identifies the place, not the line of the prompt.
 */
/**
 * Spec 12 §4.2 — the tail of every ACT prompt: the context, then the order.
 *
 * Two sections, never one. Before this spec the instruction WAS the discussion
 * — Apply read the whole transcript and inferred what to do from it — and that
 * is why Apply could not run before the agent had answered at least once, and
 * why a reviewer who already knew what they wanted had to ask a question first
 * (§1.3).
 *
 * The order comes LAST, and that ordering is the reason this lives here rather
 * than being inlined at its two call sites. The discussion can run to thousands
 * of words of somebody thinking aloud, some of it abandoned; the instruction is
 * one sentence that supersedes all of it. Put it first and it is read as the
 * opening of a conversation that then changes its mind.
 *
 * Both write paths use it — the prose one in `apply.ts` and the deck one in
 * `pptx/run.ts` — so a deck and a Markdown file are told what to do the same
 * way.
 */
export function writeInstructions(transcript: string, instruction: string, tags: Tags): string[] {
  return [
    ...tags.block("discussion", transcript),
    "",
    ...tags.block("instruction", instruction.trim()),
  ];
}

/**
 * Spec 54 §5 — the tags for one ACT prompt, chosen before anything is written.
 *
 * Exported because the deck path builds its passages in `apply.ts` and its
 * prompt in `pptx/run.ts`: one prompt must have one suffix, so the two places
 * share the object rather than each making its own.
 */
export function writeTags(input: {
  thread: Thread;
  transcript: string;
  instruction: string;
}): Tags {
  return tagsFor(input.transcript, input.instruction, ...threadSources(input.thread));
}

/**
 * Every string in a thread that came from a document or from the reviewer.
 *
 * `JSON.stringify` over the targets rather than a walk of each anchor shape: a
 * quote, an element selector, a diagram's stored source and a gap's two
 * neighbours are all in there, and a new field added to `Anchor` later is in
 * there too, without anyone having to remember this function exists.
 */
function threadSources(thread: Thread): string[] {
  return [thread.note, JSON.stringify(thread.targets)];
}

/**
 * Spec 16 §5.1 — where a passage's text actually lives, and on which line.
 *
 * Nothing stores this. A comment is about the version its text is in, and the
 * only way to know which is to look — which is what the renderer does with two
 * live DOMs (§5.2) and what `apply.ts` does with the two files.
 */
export interface PassagePlace {
  version: "current" | "original";
  /** Its line in the version named above, when it can be found. */
  line: number | null;
  /** §6.7 — a gap's two neighbours, as lines in the version that will exist. */
  between?: { after: number | null; before: number | null };
}

export function passageSection(input: {
  thread: Thread;
  documentPaths: ReadonlyMap<string, string>;
  repositoryRoot: string;
  /** Spec 54 §5.1 — the caller's tags, so one prompt carries one suffix. */
  tags: Tags;
  /**
   * Where this passage sits *now*, when the caller can work it out. Apply
   * passes one; Ask passes one only while a working copy exists, because a read
   * agent does not need a line and a wrong one would send it to the wrong
   * paragraph.
   */
  locate?: (documentPath: string, anchor: Anchor) => PassagePlace;
  /**
   * Spec 24 §6.1 — list only the targets from this position on. The numbers
   * stay the targets' own, so a follow-up that adds places 4 and 5 says `4.`
   * and `5.`, which is what the reviewer's chips and outlines say.
   */
  from?: number;
  /**
   * Spec 24 §6.2 — the user message being sent. A target that arrived with it
   * has its line end in `— added with this instruction`, because the discussion
   * the ACT prompt carries never mentions passages, and without the marker the
   * agent sees five places and a conversation that only ever spoke of three.
   */
  addedWith?: string | null;
  /**
   * Spec 34 §7 — where the agent READS each document: REX's working copy. The
   * paths stay the reviewer's own, because those are the names the prompt uses.
   */
  readAt?: ReadonlyMap<string, string>;
}): string[] {
  const { thread, documentPaths, repositoryRoot, tags } = input;
  const from = input.from ?? 0;
  if (thread.targets.length <= from) return [];

  // One group per document, in the order the reviewer's places first mention
  // it, each holding that document's picks.
  const groups = new Map<
    string,
    { name: string; copy: string | null; whole: boolean; places: string[] }
  >();
  let anyOriginal = false;

  thread.targets.forEach((target, position) => {
    if (position < from) return;
    const path = documentPaths.get(target.documentId) ?? target.documentId;
    const name = displayPath(repositoryRoot, path);
    const copy = input.readAt?.get(target.documentId) ?? null;
    const group = groups.get(name) ?? {
      name,
      copy: copy && copy !== path ? copy : null,
      whole: false,
      places: [],
    };
    const place = input.locate?.(path, target.anchor) ?? null;
    if (place?.version === "original") anyOriginal = true;

    // Spec 06 §7.1 — `document` names nothing inside the file and means all of
    // it, so it is a fact about the document rather than a place inside it.
    if (target.anchor.extent === "document") {
      group.whole = true;
      groups.set(name, group);
      return;
    }

    group.places.push(
      ...placeBlock({
        anchor: target.anchor,
        documentPath: path,
        n: position + 1,
        place,
        // Spec 24 §6.2 — `messageId` is null on a place the comment started
        // with, so a null `addedWith` marks nothing rather than everything.
        added: !!input.addedWith && target.messageId === input.addedWith,
        tags,
      }),
    );
    groups.set(name, group);
  });

  const parts: string[] = [];
  for (const group of groups.values()) {
    if (parts.length > 0) parts.push("");
    parts.push(...documentBlock({ ...group, tags }));
  }
  // REX's own sentences about the groups, so they sit outside the frame.
  if ([...groups.values()].some((group) => group.copy)) parts.push("", WORKING_COPY_NOTE);
  if (anyOriginal) parts.push("", LOOKING_AT_THE_ORIGINAL);
  parts.push("");
  return parts;
}

/**
 * Spec 54 §4 — one document, with everything picked inside it.
 *
 * The hierarchy is the reviewer's, asked for on 2026-09-11: *"I would like to
 * see maybe one REX document tag and, inside that tag, all the selections or
 * sections that were selected."* It replaces a flat list beside a section,
 * which duplicated the pick and said nothing the attributes do not.
 */
function documentBlock(input: {
  name: string;
  copy: string | null;
  whole: boolean;
  places: string[];
  tags: Tags;
}): string[] {
  const { tags } = input;
  // Spec 34 §7 — where the agent READS this document: REX's working copy. An
  // attribute rather than three lines of body, because three lines repeated per
  // document is what `Also read at:` existed to avoid, and the sentence that
  // explains a copy is said once for the whole prompt (`WORKING_COPY_NOTE`).
  const attributes = {
    path: input.name,
    "read-at": input.copy,
    whole: input.whole ? "yes" : null,
  };

  if (input.places.length === 0) return [tags.selfClosing("document", attributes)];
  return [tags.open("document", attributes), ...input.places, tags.close("document")];
}

/**
 * Spec 34 §7 — what `read-at` means, said once however many documents carry one.
 *
 * The location never changes, so no later turn repeats it: approve and discard
 * move bytes between the two files, not the files.
 */
const WORKING_COPY_NOTE = `Each \`read-at\` is REX's copy and is the current version. The file at \`path\` is
what the reviewer has approved so far. Do not edit either file.`;

/**
 * Spec 56 §3.5 — where the document's repository is, in one line.
 *
 * Said because §3.1 moved the working directory. An ASK on the Codex adapter
 * now runs in an empty throwaway, so `ls` and `rg` with no path search a folder
 * with nothing in it — and the agent has no other way to learn where the
 * repository went. Reading it is allowed from anywhere and `cd` is on the
 * gate's read-only list (spec 12 §6.2), so the path is the only missing piece.
 *
 * Harmless on the three adapters whose working directory did not move: it names
 * the folder they are already standing in.
 */
function repositoryNote(root: string): string {
  return `The document's repository is at ${root}. Read anything in it — \`cd\` there
first, or use absolute paths. You cannot change it.`;
}

/**
 * Spec 34 §7 — the document's name, and where to read it: the top of the
 * first prompt every fresh session gets.
 *
 * Two fresh sessions exist. The opening ASK is one; a reply whose SDK
 * transcript was lost and is replayed from REX's own record (SPEC.md §8.5) is
 * the other, and that record holds the reviewer's notes, not the prompts — so
 * without this an agent replayed onto a pending change went looking in the
 * repository and read the file, which is the wrong version. Said once per
 * session, never per turn: the location does not move.
 */
export function documentHeader(input: {
  thread: Thread;
  documentPaths: ReadonlyMap<string, string>;
  repositoryRoot: string;
  readAt?: ReadonlyMap<string, string>;
  /** Spec 54 §5 — the caller's tags. A standalone call makes its own. */
  tags?: Tags;
}): string[] {
  const { thread, documentPaths, repositoryRoot } = input;
  const tags = input.tags ?? tagsFor(...threadSources(thread));
  const primary = thread.targets[0] ?? null;
  const primaryPath = primary ? (documentPaths.get(primary.documentId) ?? null) : null;
  if (!primaryPath) return [];
  const primaryCopy = primary ? (input.readAt?.get(primary.documentId) ?? null) : null;

  return documentBlock({
    name: displayPath(repositoryRoot, primaryPath),
    copy: primaryCopy && primaryCopy !== primaryPath ? primaryCopy : null,
    whole: false,
    places: [],
    tags,
  });
}

/** §8.6 and spec 05 §5.5 — the user prompt for Ask. */
export function askPrompt(input: {
  thread: Thread;
  /** Absolute path per documentId, for every document the thread targets. */
  documentPaths: ReadonlyMap<string, string>;
  /** The repository root of `targets[0]`'s document. */
  repositoryRoot: string;
  /**
   * Spec 16 §5.4 — where each passage is now: in the copy, with its line
   * there, or only in the original. A passage the change removed has to be
   * named as the original's or the read agent goes looking for it in a file
   * that no longer has it. Spec 34 §4 — supplied for every document that has a
   * copy, which is every text document: the line it gives is the copy's, and
   * the copy is what the agent opens.
   */
  locate?: (documentPath: string, anchor: Anchor) => PassagePlace;
  /**
   * Spec 34 §7 — where the agent READS each document, by document id: REX's
   * working copy. `documentPaths` stay the reviewer's own, because they are
   * the names the prompt uses; this is the location, said once, at the top.
   * Absent for a document that has no copy — a deck, a Word file.
   */
  readAt?: ReadonlyMap<string, string>;
}): string {
  const { thread, documentPaths, repositoryRoot } = input;
  // Spec 54 §5 — every picked passage is read before the tags are chosen,
  // because those bodies are the longest runs of document text in the prompt
  // and the ones most likely to spell a tag.
  const tags = tagsFor(...threadSources(thread), ...selectedSources(input));

  const parts: string[] = [
    ...passageSection({
      thread,
      documentPaths,
      repositoryRoot,
      tags,
      ...(input.readAt ? { readAt: input.readAt } : {}),
      ...(input.locate ? { locate: input.locate } : {}),
    }),
  ];

  if (thread.targets.some((target) => target.anchor.extent === "document")) {
    parts.push(READ_IN_FULL, "");
  }

  // Spec 56 §3.5 — outside the frame, because it is REX's sentence about the
  // machine rather than anything copied out of a document.
  parts.push(repositoryNote(repositoryRoot), "");

  parts.push(...tags.block("comment", thread.note));
  return parts.join("\n");
}

/**
 * Spec 54 §5 — the text of every pick, for the collision search only.
 *
 * `placeBlock` reads the same files again when it builds the bodies. That is
 * two reads of a file REX has already copied, and it is the honest order: the
 * suffix has to be known before the first tag is written.
 */
function selectedSources(input: {
  thread: Thread;
  documentPaths: ReadonlyMap<string, string>;
}): string[] {
  return input.thread.targets
    .map((target) => {
      const path = input.documentPaths.get(target.documentId) ?? null;
      return selectedText(target.anchor, path).text;
    })
    .filter((text): text is string => text !== null);
}

/**
 * Spec 34 §6.2 — what the reviewer did to the document since the agent last
 * spoke, in front of a reply to a RESUMED session.
 *
 * A resumed session has its own memory and gets only the reply, so an approve
 * or a discard that happened between turns is news it has no other way to
 * hear. Said once, and only when there is something: with no events the reply
 * is the bare text, exactly as `thread:reply` has always sent it. A fresh
 * session never needs this — its transcript carries the events in place.
 */
export function withEvents(events: readonly string[], prompt: string): string {
  if (events.length === 0) return prompt;
  return ["Since your last turn:", ...events.map((event) => `- ${event}`), "", prompt].join("\n");
}

/**
 * Spec 24 §6.1 — a reply that points somewhere new.
 *
 * Only the places added with THIS message are listed. On a resumed session the
 * agent remembers the opening ones from its own transcript, and listing them
 * again would bury the two that matter under the three it has. The numbers are
 * the targets' own — `from` is where the new ones start — so the prompt, the
 * chips and the outlines all say `4.`.
 *
 * With nothing new the prompt is the bare text, exactly as `thread:reply` has
 * always sent it: an ordinary reply does not grow a heading.
 */
export function followUpPrompt(input: {
  thread: Thread;
  documentPaths: ReadonlyMap<string, string>;
  repositoryRoot: string;
  /** The position of the first place this message added. */
  from: number;
  /** What the reviewer typed. */
  text: string;
  locate?: (documentPath: string, anchor: Anchor) => PassagePlace;
}): string {
  const { thread, from, text } = input;
  const tags = tagsFor(text, ...threadSources(thread));
  const fresh = thread.targets.slice(from);
  // Spec 54 §4.3 — a reply that points nowhere new is still framed. Spec 24
  // made it the bare text; if the reviewer's words are tagged on some turns and
  // not on others, the system prompt's "what the reviewer asks for is the text
  // in <rex-comment>" is false half the time.
  if (fresh.length === 0) return tags.block("comment", text).join("\n");

  const count = fresh.length === 1 ? "1 more place" : `${fresh.length} more places`;
  const numbering =
    from > 0
      ? `numbered on from the places this comment already had, 1 to ${from}`
      : "numbered from 1";

  const parts = [
    `The reviewer has pointed at ${count} since their last message. They are`,
    `${numbering}.`,
    "",
    ...passageSection({
      thread,
      documentPaths: input.documentPaths,
      repositoryRoot: input.repositoryRoot,
      tags,
      from,
      ...(input.locate ? { locate: input.locate } : {}),
    }),
  ];

  // Spec 06 §7.1 — the same instruction the opening prompt gives, for the same
  // anchor: "the whole document" is a phrase with no action behind it.
  if (fresh.some((target) => target.anchor.extent === "document")) {
    parts.push(READ_IN_FULL, "");
  }

  parts.push(...tags.block("comment", text));
  return parts.join("\n");
}

/**
 * §8.6 — a synthesis thread is built from the threads it references: each
 * anchor quote, the user's note, and what the agent answered.
 */
export function synthesisPrompt(input: {
  note: string;
  referenced: Array<{ thread: Thread; messages: Message[] }>;
}): string {
  const tags = tagsFor(
    input.note,
    ...input.referenced.flatMap(({ thread, messages }) => [
      ...threadSources(thread),
      ...messages.map((message) => message.content),
    ]),
  );
  const parts = ["You are being asked about several comments on the same document at once.", ""];

  input.referenced.forEach(({ thread, messages }, position) => {
    const n = position + 1;
    // The pick itself, not a description of it. A block pick's stored quote is
    // an opening truncated at `ELEMENT_QUOTE_MAX`, and `placeBlock` says so
    // with `truncated` rather than letting it read as the whole passage.
    const primary = thread.targets[0];
    if (primary) {
      parts.push(
        ...placeBlock({
          anchor: primary.anchor,
          documentPath: null,
          n,
          place: null,
          added: false,
          tags,
        }),
      );
    }
    parts.push(...tags.block("comment", thread.note, { n }));
    const answers = messages.filter((m) => m.role === "assistant" && m.kind === "text");
    for (const answer of answers) {
      parts.push(...tags.block("answer", answer.content ?? "", { n }));
    }
    parts.push("");
  });

  parts.push(
    "The question now:",
    ...tags.block("comment", input.note),
    "",
    "These comments may contradict each other. If they do, say so explicitly and explain the contradiction.",
  );
  return parts.join("\n");
}
