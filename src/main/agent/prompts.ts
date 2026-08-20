// SPEC.md §8.6 — system prompts, verbatim, and the templates that build a
// user prompt from a thread.

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Anchor, Message, Thread } from "../../shared/types.ts";

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

export const WRITE_SYSTEM_PROMPT = `You are applying a change to a document that was agreed in a discussion. The
full discussion is given below.

Make the smallest change that achieves what was agreed. Do not reformat
surrounding text, do not fix unrelated issues, and do not improve prose that
nobody asked about.

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

/** §8.6 — the user prompt for Ask. */
export function askPrompt(input: {
  thread: Thread;
  documentPath: string;
  repositoryRoot: string;
}): string {
  const { thread, documentPath, repositoryRoot } = input;
  const anchor = thread.anchor;
  const parts = [`Document: ${relative(repositoryRoot, documentPath) || documentPath}`];

  if (anchor?.source) parts.push(`Line: ${anchor.source.line}`);
  parts.push("");

  if (anchor?.quote) {
    parts.push("## Highlighted passage", anchor.quote.exact, "");
  }

  const section = anchor ? enclosingSection(documentPath, anchor) : null;
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
    if (thread.anchor?.quote) parts.push(`Highlighted passage: ${thread.anchor.quote.exact}`);
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
