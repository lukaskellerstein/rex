// SPEC.md §8.6 — system prompts, verbatim, and the templates that build a
// user prompt from a thread.

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Anchor, LineRange, Message, Thread } from "../../shared/types.ts";

export const READ_SYSTEM_PROMPT = `You answer questions about a document. The user has highlighted a passage and
written a comment about it. Answer that comment.

You have read-only access to the repository containing the document. Use it.
Read the surrounding sections, other documents, the source code, and the git
history whenever they help you give a correct and specific answer. You cannot
change any file, and you should not try.

The \`LSP\` tool is deferred: its name is listed but it has no schema until you
call ToolSearch("select:LSP"). Do that before any question about where a symbol
is defined, who implements it, or what calls it. It is much more reliable than
grep for those questions.

Be concrete. Quote what you found and say where you found it as file:line.
If the answer depends on something you cannot determine, say so plainly rather
than guessing.`;

export const WRITE_SYSTEM_PROMPT = `You are applying a change to one or more documents that was agreed in a
discussion. The full discussion is given below.

Make the smallest change that achieves what was agreed. Do not reformat
surrounding text, do not fix unrelated issues, and do not improve prose that
nobody asked about.

You may be given several files. Change only the ones the discussion actually
calls for. Leaving a file exactly as it is is a correct outcome, and is better
than finding something to adjust in it.

Edit the source file, not the rendered output.`;

/** §8.6 — inlining the section is a head start, not a limit. */
const SECTION_MAX = 2000;

/**
 * The text around the anchor, taken from the *source* file so that the agent
 * reads what it would have to edit rather than the rendered output.
 */
export function enclosingSection(sourcePath: string, anchor: Anchor): string | null {
  let source: string;
  try {
    source = readFileSync(sourcePath, "utf8");
  } catch {
    return null;
  }

  if (anchor.source) {
    const lines = source.split("\n");
    const start = findSectionStart(lines, anchor.source.line - 1);
    const end = findSectionEnd(lines, anchor.source.line - 1);
    return lines.slice(start, end).join("\n").slice(0, SECTION_MAX);
  }

  // No `data-src-line` — tier 1 HTML (§5.4). Find the prose in the file by its
  // opening words, allowing for the line wrapping the file may have.
  const exact = anchor.quote?.exact;
  if (!exact) return null;
  const words = exact.split(/\s+/).slice(0, 8).map(escapeRegExp);
  if (words.length === 0) return null;

  const probe = new RegExp(words.join("\\s+"));
  const at = source.search(probe);
  if (at === -1) return null;
  return source.slice(Math.max(0, at - SECTION_MAX / 2), at + SECTION_MAX / 2);
}

function findSectionStart(lines: string[], from: number): number {
  for (let i = Math.min(from, lines.length - 1); i >= 0; i--) {
    if (/^#{1,6}\s/.test(lines[i])) return i;
  }
  return 0;
}

function findSectionEnd(lines: string[], from: number): number {
  for (let i = from + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) return i;
  }
  return lines.length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
function describeTarget(anchor: Anchor, documentPath: string | null): string {
  if (anchor.extent === "document") return "the whole document";

  const quote = anchor.quote?.exact?.trim();
  if (anchor.extent === "section") {
    const named = quote ? `Section "${quote}"` : "(a section whose heading has no text)";
    const range = documentPath ? sectionLineRange(documentPath, anchor) : null;
    return range ? `${named} — lines ${range.from}–${range.to}` : named;
  }
  if (quote) return quote;

  const named = anchor.element?.id ? `#${anchor.element.id}` : anchor.element?.css;
  const region = anchor.region ? ", a region of it" : "";
  return named
    ? `(no text — an element anchor: ${named}${region})`
    : "(no text and no element — a stored position only)";
}

/**
 * Spec 06 §7.1 — "the whole document" is a phrase with no action behind it, so
 * the one instruction that gives it one is stated outright.
 */
const READ_IN_FULL = `Read the document in full before answering. This comment is about all of it,
not about a passage.`;

/** §7.1 — a drawn comment gains one line, and the agent never hears "pen". */
const DREW_A_CIRCLE = "The reviewer drew a circle around these, in this order.";

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
  const rank = /^(#{1,6})\s/.exec(lines[from - 1] ?? "")?.[1].length;
  // Not a Markdown heading any more — the file was edited under the anchor, or
  // it never was one. Either way there is nothing here to measure.
  if (!rank) return null;

  // §4.2 — the run ends at the next heading of the same or higher rank, so the
  // section is the line before it. `lines[i]` is line number `i + 1`.
  for (let i = from; i < lines.length; i++) {
    const next = /^(#{1,6})\s/.exec(lines[i]);
    if (next && next[1].length <= rank) return { from, to: i };
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
export function passageSection(input: {
  thread: Thread;
  documentPaths: ReadonlyMap<string, string>;
  repositoryRoot: string;
  heading: string;
  /**
   * Where this passage sits in the file *now*, when the caller can work it out.
   * Apply passes one; Ask does not, because a read agent does not need a line
   * and a wrong one would send it to the wrong paragraph.
   */
  lineOf?: (documentPath: string, anchor: Anchor) => number | null;
}): string[] {
  const { thread, documentPaths, repositoryRoot } = input;
  if (thread.targets.length === 0) return [];

  const groups = new Map<string, string[]>();
  thread.targets.forEach((target, position) => {
    const path = documentPaths.get(target.documentId) ?? target.documentId;
    const name = displayPath(repositoryRoot, path);
    const lines = groups.get(name) ?? [];
    // Spec 06 §7.1 — an extent target carries its own range, or deliberately
    // none. A single line for a section would name where it *starts* as though
    // that were the passage.
    const line = target.anchor.extent ? null : (input.lineOf?.(path, target.anchor) ?? null);
    const where = line === null ? "" : ` — line ${line}`;
    lines.push(`${position + 1}. ${describeTarget(target.anchor, path)}${where}`);
    groups.set(name, lines);
  });

  const parts = [input.heading];
  // One document needs no heading of its own — it is already named at the top
  // of the prompt, and a lone `### file.md` reads as if a second is missing.
  const single = groups.size === 1;
  for (const [name, lines] of groups) {
    if (!single) parts.push("", `### ${name}`);
    parts.push(...lines);
  }
  // §7.1 — one line, and the agent still never hears the word "pen". The order
  // is the panel's, which is the order the reviewer left them in.
  if (thread.stroke) parts.push("", DREW_A_CIRCLE);
  parts.push("");
  return parts;
}

/** §8.6 and spec 05 §5.5 — the user prompt for Ask. */
export function askPrompt(input: {
  thread: Thread;
  /** Absolute path per documentId, for every document the thread targets. */
  documentPaths: ReadonlyMap<string, string>;
  /** The repository root of `targets[0]`'s document. */
  repositoryRoot: string;
}): string {
  const { thread, documentPaths, repositoryRoot } = input;
  const primary = thread.targets[0] ?? null;
  const primaryPath = primary ? (documentPaths.get(primary.documentId) ?? null) : null;

  // Spec 06 §7.1 — a document target has no line, and a wrong one sends the
  // agent to the wrong place. It carries no `source` at all (§4.3), so the
  // header below is already omitted for it; this names why, so nobody adds a
  // fallback line later.
  const wholeDocument = primary?.anchor.extent === "document";

  const parts: string[] = [];
  if (primaryPath) parts.push(`Document: ${displayPath(repositoryRoot, primaryPath)}`);
  if (primary?.anchor.source) parts.push(`Line: ${primary.anchor.source.line}`);
  parts.push("");

  parts.push(
    ...passageSection({
      thread,
      documentPaths,
      repositoryRoot,
      heading: "## Highlighted passages",
    }),
  );

  if (thread.targets.some((target) => target.anchor.extent === "document")) {
    parts.push(READ_IN_FULL, "");
  }

  // §8.6 — emitted for the primary target only. Nine of these would bury the
  // question the comment is actually asking.
  //
  // Spec 06 §7.1 — skipped for a document target: the surrounding section of
  // the whole document is the whole document, and printing it twice buys
  // nothing.
  const section =
    primary && primaryPath && !wholeDocument ? enclosingSection(primaryPath, primary.anchor) : null;
  if (section) parts.push("## Surrounding section", section, "");

  parts.push("## Comment", thread.note);
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
  const parts = ["You are being asked about several comments on the same document at once.", ""];

  input.referenced.forEach(({ thread, messages }, position) => {
    parts.push(`## Comment ${position + 1}`);
    const quote = thread.targets[0]?.anchor.quote;
    if (quote) parts.push(`Highlighted passage: ${quote.exact}`);
    parts.push(`The user wrote: ${thread.note}`);
    const answers = messages.filter((m) => m.role === "assistant" && m.kind === "text");
    if (answers.length > 0) {
      parts.push("The agent answered:");
      for (const answer of answers) parts.push(answer.content ?? "");
    }
    parts.push("");
  });

  parts.push(
    "## The question now",
    input.note,
    "",
    "These comments may contradict each other. If they do, say so explicitly and explain the contradiction.",
  );
  return parts.join("\n");
}
