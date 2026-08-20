// SPEC.md §8.7 — Apply.
//
// Step 5 is not optional: an agent must never change a file the user has not
// seen a diff for. The write agent does edit the file first — that is how the
// diff comes to exist — so rejecting reverts it, and the guard below refuses
// to start at all unless that revert is guaranteed to be clean.

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { ApplyConfirmResponse } from "../shared/channels.ts";
import type { AnchorSummary, Message } from "../shared/types.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import { runAgent } from "./agent/runner.ts";
import { renderTranscript } from "./agent/transcript.ts";
import type { Db } from "./db/database.ts";
import {
  completeApplyRun,
  createApplyRun,
  getApplyRun,
  getDocument,
  getThread,
  listMessages,
  type MessageDraft,
  setApplyRunDiff,
  setDocumentHash,
} from "./db/queries.ts";
import { changedFiles, diff, isRepository, repositoryRoot, revert } from "./git.ts";
import { sha256 } from "./render/html.ts";

export interface ApplyContext {
  db: Db;
  /** Persists the draft and streams it to the renderer. */
  record: (threadId: string, message: MessageDraft) => Message;
  /** Re-resolves every thread in the renderer — invariant I1 (§8.7 step 6). */
  reanchor: (documentId: string) => Promise<AnchorSummary>;
  onApplyReady: (event: {
    applyRunId: string;
    threadId: string;
    diff: string;
    files: string[];
  }) => void;
}

/**
 * The line the quote is actually on now.
 *
 * `Anchor.source.line` is stamped when the anchor is created and never moves
 * again, so any edit above it — including REX's own previous Apply — leaves it
 * pointing at the wrong line. Handing a stale line to a write agent is worse
 * than handing it none, so the quote is looked up in the file and the stored
 * line is used only as a fallback when the quote cannot be found.
 */
function currentSourceLine(
  documentPath: string,
  quote: string | null,
  stored: number | null,
): number | null {
  if (!quote) return stored;
  let source: string;
  try {
    source = readFileSync(documentPath, "utf8");
  } catch {
    return stored;
  }

  // The quote comes from normalised text, so its words may be split across
  // lines in the source; match on the opening words with flexible whitespace.
  const words = quote
    .split(/\s+/)
    .slice(0, 8)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return stored;

  const at = source.search(new RegExp(words.join("\\s+")));
  if (at === -1) return stored;
  return source.slice(0, at).split("\n").length;
}

function writePrompt(input: {
  documentPath: string;
  root: string;
  transcript: string;
  quote: string | null;
  sourceLine: number | null;
}): string {
  const parts = [`File to edit: ${relative(input.root, input.documentPath) || input.documentPath}`];
  if (input.sourceLine !== null) parts.push(`Line: ${input.sourceLine}`);
  if (input.quote) parts.push("", "## The passage under discussion", input.quote);
  parts.push("", "## The discussion", input.transcript);
  return parts.join("\n");
}

/** SPEC.md §8.7 steps 1–4, plus the guard that makes step 5 reversible. */
export async function startApply(context: ApplyContext, threadId: string): Promise<string> {
  const { db } = context;
  const thread = getThread(db, threadId);
  if (!thread) throw new Error(`No such thread: ${threadId}`);

  const document = getDocument(db, thread.documentId);
  if (!document) throw new Error("The thread's document is missing from the database.");
  if (document.ref.kind !== "file") {
    throw new Error("Apply needs a local source file; this document is a URL (SPEC.md §5.2).");
  }

  const documentPath = document.ref.value;
  if (!isRepository(documentPath)) {
    throw new Error(
      "Apply requires the document to be in a git repository — rejecting a change reverts it with git checkout, and without git there is no way back.",
    );
  }

  const root = repositoryRoot(documentPath);
  const relativePath = relative(root, documentPath);
  if (changedFiles(root).includes(relativePath)) {
    throw new Error(
      `${relativePath} already has uncommitted changes. Commit or stash them first — rejecting this Apply would discard them too.`,
    );
  }

  const run = createApplyRun(db, threadId);
  const messages = listMessages(db, threadId);

  const result = await runAgent({
    cwd: root,
    profile: "write",
    prompt: writePrompt({
      documentPath,
      root,
      transcript: renderTranscript(messages),
      quote: thread.anchor?.quote?.exact ?? null,
      sourceLine: currentSourceLine(
        documentPath,
        thread.anchor?.quote?.exact ?? null,
        thread.anchor?.source?.line ?? null,
      ),
    }),
    sessionId: sessionIdFor(run.id),
    resume: false,
    model: thread.model,
    onMessage: (message) => context.record(threadId, message),
  });

  if (result.error) {
    completeApplyRun(db, run.id, "failed");
    throw new Error(result.error);
  }

  const touched = changedFiles(root);
  const unified = diff(root, touched);
  setApplyRunDiff(db, run.id, unified, touched);

  // §8.7 step 5 — show the diff and WAIT. Nothing is final until apply:confirm.
  context.onApplyReady({ applyRunId: run.id, threadId, diff: unified, files: touched });
  return run.id;
}

/** SPEC.md §8.7 steps 5–7. */
export async function confirmApply(
  context: ApplyContext,
  applyRunId: string,
  accept: boolean,
): Promise<ApplyConfirmResponse> {
  const { db } = context;
  const run = getApplyRun(db, applyRunId);
  if (!run) throw new Error(`No such apply run: ${applyRunId}`);

  const thread = getThread(db, run.threadId);
  const document = thread ? getDocument(db, thread.documentId) : null;
  if (!thread || !document || document.ref.kind !== "file") {
    throw new Error("The apply run's document is missing or is not a local file.");
  }

  const root = repositoryRoot(document.ref.value);

  if (accept) {
    completeApplyRun(db, applyRunId, "applied");
  } else {
    revert(root, run.files);
    completeApplyRun(db, applyRunId, "rejected");
  }

  context.record(run.threadId, {
    role: "system",
    kind: accept ? "completed" : "error",
    content: accept
      ? `Applied to ${run.files.length} file(s).`
      : "Rejected. The change was reverted with git checkout.",
    toolName: null,
    toolInput: null,
    isError: !accept,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  });

  // §8.7 step 6 is MANDATORY on both paths — a reject still leaves the
  // document re-read, and the summary must account for every thread.
  setDocumentHash(db, document.id, sha256(readFileSync(document.ref.value)));
  const reanchored = await context.reanchor(document.id);
  return { reanchored };
}
