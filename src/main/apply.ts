// SPEC.md §8.7 and spec 05 §5.6 — Apply.
//
// Step 5 is not optional: an agent must never change a file the user has not
// seen a diff for. The write agent does edit the files first — that is how the
// diff comes to exist — so rejecting reverts them, and the guards below refuse
// to start at all unless that revert is guaranteed to be clean.
//
// Spec 05 widens what Apply reaches from one document to every document the
// comment is about. Two things follow, and both are safety rather than plumbing:
// one agent turn per **repository**, because `git checkout` is a per-repository
// promise; and the revert list is the files this run *introduced*, never every
// dirty file in the tree, because somebody else's uncommitted work is not ours
// to discard.

import { readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { ApplyConfirmResponse, DeckPreview } from "../shared/channels.ts";
import type {
  Anchor,
  AnchorSummary,
  ChangedRegion,
  Message,
  SkippedDocument,
  Thread,
} from "../shared/types.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import { passageSection, writeInstructions } from "./agent/prompts.ts";
import { runAgent } from "./agent/runner.ts";
import { renderTranscript } from "./agent/transcript.ts";
import type { Db } from "./db/database.ts";
import {
  completeApplyRun,
  createApplyRun,
  getApplyRun,
  getThread,
  listMessages,
  type MessageDraft,
  setApplyRunDiff,
  setDocumentHash,
} from "./db/queries.ts";
import { changedRegions } from "./diff.ts";
import { changedFiles, diff, isRepository, repositoryRoot, revert } from "./git.ts";
import type { MediaResolver } from "./pptx/media.ts";
import { acceptDeckApply, discardDeckApply, runDeckApply } from "./pptx/run.ts";
import { isPptxPath } from "./render/formats.ts";
import { sha256 } from "./render/html.ts";
import { applyPlan, documentsOf } from "./threads.ts";

export interface ApplyContext {
  db: Db;
  /** Persists the draft and streams it to the renderer. */
  record: (threadId: string, message: MessageDraft) => Message;
  /**
   * Re-resolves every thread in the renderer — invariant I1 (§8.7 step 6).
   *
   * Takes every document this run changed, not one: Apply now edits several, and
   * the renderer has to re-render the document on screen only when that document
   * is one of them. Re-rendering a document that did not change would cost the
   * reviewer their scroll position for nothing.
   */
  reanchor: (changedDocumentIds: string[]) => Promise<AnchorSummary>;
  /**
   * Spec 11 §7.4.2 — how a Mermaid diagram in a plan becomes a picture.
   *
   * Injected because main cannot draw one: Mermaid measures text with a real
   * layout, so the renderer draws and hands back a PNG.
   */
  resolver: MediaResolver;
  onApplyReady: (event: {
    applyRunId: string;
    threadId: string;
    diff: string;
    files: string[];
    regions: ChangedRegion[];
    skipped: SkippedDocument[];
    /** Spec 11 §7.7 — the before-and-after slides that replace the diff. */
    decks?: DeckPreview[];
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
function currentSourceLine(documentPath: string, anchor: Anchor): number | null {
  const quote = anchor.quote?.exact ?? null;
  const stored = anchor.source?.line ?? null;
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

/** Absolute path per documentId, for every document the thread targets. */
function pathsOf(db: Db, thread: Thread): Map<string, string> {
  const paths = new Map<string, string>();
  for (const record of documentsOf(db, thread)) {
    paths.set(record.id, record.ref.value);
  }
  return paths;
}

function writePrompt(input: {
  db: Db;
  thread: Thread;
  root: string;
  files: string[];
  instruction: string;
  transcript: string;
}): string {
  const parts = ["Files you may edit:"];
  for (const file of input.files) parts.push(`- ${relative(input.root, file) || file}`);
  parts.push("");

  parts.push(
    ...passageSection({
      thread: input.thread,
      documentPaths: pathsOf(input.db, input.thread),
      repositoryRoot: input.root,
      heading: "## The passages under discussion",
      lineOf: currentSourceLine,
    }),
  );

  parts.push(...writeInstructions(input.transcript, input.instruction));
  return parts.join("\n");
}

/**
 * The conversation so far, WITHOUT the instruction that started this run.
 *
 * `thread:apply` records the reviewer's text as a user message before calling
 * in, so the card shows it while the agent works. That message is the last one
 * in the list, and leaving it in the transcript would print the instruction
 * twice — once as the order and once as the final line of its own context.
 */
function transcriptBefore(db: Db, threadId: string, note: string): string {
  const messages = listMessages(db, threadId);
  const last = messages.at(-1);
  const earlier =
    last?.role === "user" && last.content === note ? messages.slice(0, -1) : messages;
  return renderTranscript(earlier);
}

/** Spec 05 §5.6 — the editable documents, grouped by the repository that owns them. */
function groupByRepository(editable: string[], skipped: SkippedDocument[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const path of editable) {
    if (!isRepository(path)) {
      skipped.push({
        file: path,
        reason:
          "Apply requires the document to be in a git repository — rejecting a change reverts it with git checkout, and without git there is no way back.",
      });
      continue;
    }
    const root = repositoryRoot(path);
    const files = groups.get(root) ?? [];
    files.push(path);
    groups.set(root, files);
  }

  return groups;
}

/**
 * The guard that makes step 5 reversible.
 *
 * A target file that already differs from HEAD cannot be offered: rejecting the
 * Apply runs `git checkout` on it, which would throw away whatever was there
 * before the agent ran. Other dirty files in the same repository are none of
 * Apply's business and are left alone — see the note at the top of this file.
 */
function refuseDirtyTargets(groups: Map<string, string[]>): void {
  for (const [root, files] of groups) {
    const dirty = new Set(changedFiles(root));
    for (const file of files) {
      const path = relative(root, file);
      if (dirty.has(path)) {
        throw new Error(
          `${path} already has uncommitted changes. Commit or stash them first — rejecting this Apply would discard them too.`,
        );
      }
    }
  }
}

/**
 * Spec 11 §7 — Apply on a deck, which is a different flow and not a variation.
 *
 * `git diff` on a `.pptx` prints `Binary files differ`, so step 5 — show the
 * change and wait — has to be a picture rather than a patch. The agent writes a
 * plan, REX performs it on a copy, and the reviewer accepts a rendering of the
 * result. §7.7 is what makes that as safe as a diff, not a rubber stamp.
 *
 * A run touching both a deck and a prose file would need one dialog showing a
 * unified diff and slide pictures at once. That is not a thing REX has, so a
 * mixed comment applies to the decks and reports the rest as skipped, with the
 * reason. Stated rather than silently dropped.
 */
/**
 * Names one deck's slot in an apply run, safely enough to be a file name.
 *
 * The deck's own path cannot be used: it is full of separators, and
 * `plan-${key}.json` quietly became a nested directory rather than a file.
 * Position is stable because `confirmApply` reads the same `run.files` list in
 * the same order it was written.
 */
function deckRunKey(applyRunId: string, position: number): string {
  return `${applyRunId}-${position}`;
}

async function startDeckApply(
  context: ApplyContext,
  thread: Thread,
  decks: string[],
  others: string[],
  skipped: SkippedDocument[],
  instruction: string,
): Promise<string> {
  const { db } = context;
  for (const file of others) {
    skipped.push({
      file,
      reason:
        "This comment also targets a PowerPoint deck. A deck's change is shown as before-and-after slides rather than as a diff, and REX will not put both in one review — apply this file from a comment of its own.",
    });
  }

  const run = createApplyRun(db, thread.id);
  const transcript = transcriptBefore(db, thread.id, instruction);
  const previews: DeckPreview[] = [];

  for (const [position, deckPath] of decks.entries()) {
    try {
      const result = await runDeckApply({
        runKey: deckRunKey(run.id, position),
        deckPath,
        instruction,
        transcript,
        passages: passageSection({
          thread,
          documentPaths: pathsOf(db, thread),
          repositoryRoot: dirname(deckPath),
          heading: "## The passages under discussion",
        }),
        model: thread.model,
        resolver: context.resolver,
        onMessage: (message) => context.record(thread.id, message),
      });
      previews.push(result.preview);
    } catch (error) {
      // Nothing was written, so there is nothing to undo — the whole point of
      // §7.1's ordering. The run is failed and the reason is the reviewer's.
      completeApplyRun(db, run.id, "failed");
      throw error;
    }
  }

  setApplyRunDiff(db, run.id, "", decks);
  context.onApplyReady({
    applyRunId: run.id,
    threadId: thread.id,
    diff: "",
    files: decks,
    regions: [],
    skipped,
    decks: previews,
  });
  return run.id;
}

/** SPEC.md §8.7 steps 1–4, across every document the comment is about. */
export async function startApply(
  context: ApplyContext,
  threadId: string,
  instruction: string,
): Promise<string> {
  const { db } = context;
  const thread = getThread(db, threadId);
  if (!thread) throw new Error(`No such thread: ${threadId}`);
  // §4.3 — ACT with an empty box does nothing. The button is disabled for it,
  // and this is the backstop: an empty instruction reaches the agent as an
  // order to do nothing in particular, which is the one way a write run can go
  // wrong without anybody having asked for anything.
  if (instruction.trim().length === 0) {
    throw new Error("Say what to change. ACT needs an instruction, not an empty message.");
  }

  const plan = applyPlan(db, thread);
  const skipped = [...plan.skipped];

  const decks = plan.editable.filter((path) => isPptxPath(path));
  if (decks.length > 0) {
    return startDeckApply(
      context,
      thread,
      decks,
      plan.editable.filter((path) => !isPptxPath(path)),
      skipped,
      instruction,
    );
  }

  const groups = groupByRepository(plan.editable, skipped);

  if (groups.size === 0) {
    throw new Error(
      skipped.length > 0
        ? `Apply cannot edit any of this comment's documents. ${skipped[0].reason}`
        : "This comment has no document to edit.",
    );
  }
  refuseDirtyTargets(groups);

  const run = createApplyRun(db, threadId);
  const transcript = transcriptBefore(db, threadId, instruction);

  const touched: string[] = [];
  const diffs: string[] = [];
  const regions: ChangedRegion[] = [];

  for (const [root, files] of groups) {
    // What was already dirty here before this run. Anything outside this set
    // afterwards is ours, and only that is diffed, shown and reverted.
    const before = new Set(changedFiles(root));

    const result = await runAgent({
      cwd: root,
      profile: "write",
      prompt: writePrompt({ db, thread, root, files, instruction, transcript }),
      // One session per repository: two turns sharing a session id would resume
      // the first one's transcript in the second one's working directory.
      sessionId: sessionIdFor(`${run.id}:${root}`),
      resume: false,
      model: thread.model,
      onMessage: (message) => context.record(threadId, message),
    });

    if (result.error) {
      // Whatever this run has already written elsewhere is undone before the
      // error is raised: a half-applied comment is the one state with no button
      // to fix it.
      revertAll(touched);
      completeApplyRun(db, run.id, "failed");
      throw new Error(result.error);
    }

    const introduced = changedFiles(root).filter((path) => !before.has(path));
    if (introduced.length === 0) continue;

    const unified = diff(root, introduced);
    diffs.push(unified);
    regions.push(...changedRegions(unified, root));
    touched.push(...introduced.map((path) => `${root}/${path}`));
  }

  const unified = diffs.join("\n");
  setApplyRunDiff(db, run.id, unified, touched);

  // §8.7 step 5 — show the change and WAIT. Nothing is final until apply:confirm.
  context.onApplyReady({
    applyRunId: run.id,
    threadId,
    diff: unified,
    files: touched,
    regions,
    skipped,
  });
  return run.id;
}

/** Undo everything a run wrote, whichever repositories it wrote into. */
function revertAll(files: string[]): void {
  const byRoot = new Map<string, string[]>();
  for (const file of files) {
    const root = repositoryRoot(file);
    const list = byRoot.get(root) ?? [];
    list.push(relative(root, file));
    byRoot.set(root, list);
  }
  for (const [root, paths] of byRoot) revert(root, paths);
}

/** SPEC.md §8.7 steps 5–7, and spec 05 §5.6.1's OK / Undo. */
export async function confirmApply(
  context: ApplyContext,
  applyRunId: string,
  accept: boolean,
): Promise<ApplyConfirmResponse> {
  const { db } = context;
  const run = getApplyRun(db, applyRunId);
  if (!run) throw new Error(`No such apply run: ${applyRunId}`);

  const thread = getThread(db, run.threadId);
  if (!thread) throw new Error("The apply run's thread is missing from the database.");

  // Spec 11 §7.1 — a deck run has written nothing yet. Accepting is what moves
  // the copy over the original, and rejecting is a delete rather than a revert:
  // there is no `git checkout` here, because there was never anything to undo.
  const decks = run.files.filter((file) => isPptxPath(file));
  const others = run.files.filter((file) => !isPptxPath(file));

  if (accept) {
    decks.forEach((deck, position) => acceptDeckApply(deck, deckRunKey(applyRunId, position)));
    completeApplyRun(db, applyRunId, "applied");
  } else {
    decks.forEach((deck, position) => discardDeckApply(deck, deckRunKey(applyRunId, position)));
    revertAll(others);
    completeApplyRun(db, applyRunId, "rejected");
  }

  const undone =
    decks.length > 0 && others.length === 0
      ? "Discarded. The deck was never modified — REX edits a copy and only replaces the file when you accept."
      : "Undone. Every file was restored with git checkout.";

  context.record(run.threadId, {
    role: "system",
    kind: accept ? "completed" : "error",
    content: accept ? `Applied to ${run.files.length} file(s).` : undone,
    toolName: null,
    toolInput: null,
    isError: !accept,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  });

  // Every document this run touched has to be re-hashed, not only the one on
  // screen: the hash is what §6.6 compares to tell `ok` from `moved`, and a
  // document left with a stale hash reports every anchor as moved the next time
  // it is opened.
  const changed = new Set(run.files);
  const changedDocumentIds: string[] = [];
  for (const record of documentsOf(db, thread)) {
    if (!changed.has(record.ref.value)) continue;
    changedDocumentIds.push(record.id);
    try {
      setDocumentHash(db, record.id, sha256(readFileSync(record.ref.value)));
    } catch {
      // The file was deleted or is unreadable. The next open reports it.
    }
  }

  // §8.7 step 6 is MANDATORY on both paths — an undo still leaves the documents
  // re-read. Only the document on screen can be swept (invariant I1); targets
  // elsewhere are checked when their own document is next opened (§5.4).
  const reanchored = await context.reanchor(changedDocumentIds);
  return { reanchored };
}
