// SPEC.md §8.7 and spec 05 §5.6 — Apply.
//
// Step 5 is not optional: an agent must never change a file the user has not
// seen. **Spec 15 changed how that promise is kept.** The write agent no longer
// edits the reviewer's file at all — it edits a working copy in `~/.rex/work`,
// which survives the run so the reviewer can keep talking to it, and the file is
// replaced only when the new version is approved (spec 15 §7.2).
//
// What that buys, and why the old mechanism had to go: git was the only source
// of "what changed", and `git status --porcelain` prints one line for an
// untracked tree — identical before an edit and after it. So an ACT run on an
// untracked document reported nothing, showed no diff, and could not be undone
// (spec 15 §1). Content hashes replaced it; git keeps one job, in §4.3.
//
// Spec 05 widens what Apply reaches from one document to every document the
// comment is about, so there is one agent turn per **repository** — the working
// directory an agent reads from is per-repository even now that what it writes
// is not.

import { readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import type { ApplyConfirmResponse, DeckPreview } from "../shared/channels.ts";
import type {
  Anchor,
  AnchorSummary,
  ChangedRegion,
  Message,
  SkippedDocument,
  Thread,
  WorkingCopyView,
} from "../shared/types.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import { type PassagePlace, passageSection, writeInstructions } from "./agent/prompts.ts";
import { runAgent } from "./agent/runner.ts";
import { beginRun, endRun } from "./agent/runs.ts";
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
import { changedFiles, isRepository, repositoryRoot, revert } from "./git.ts";
import type { MediaResolver } from "./pptx/media.ts";
import { acceptDeckApply, discardDeckApply, runDeckApply } from "./pptx/run.ts";
import { isPptxPath } from "./render/formats.ts";
import { sha256 } from "./render/html.ts";
import { applyPlan, documentsOf } from "./threads.ts";
import {
  type BeforeSet,
  basePath,
  currentHash,
  currentPath,
  forkWorkingCopy,
  movedSince,
  restoreFromBeforeSet,
  saveRevision,
  takeBeforeSet,
  type WorkingMeta,
  workRoot,
} from "./work.ts";
import { workingDiff } from "./workDiff.ts";

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
    /** Spec 15 §3 — the working copy of each document this run changed. */
    working: WorkingCopyView[];
    /** Spec 15 §4.3 — files the agent wrote that were not its to write. */
    restored: string[];
    /** Spec 17 §3.4 — the reviewer ended this run, so it reports no verdict. */
    stopped: boolean;
    /** Spec 11 §7.7 — the before-and-after slides that replace the diff. */
    decks?: DeckPreview[];
  }) => void;
}

/**
 * The line a quote is actually on in one file, or null when it is not in it.
 *
 * `Anchor.source.line` is stamped when the anchor is created and never moves
 * again, so any edit above it — including REX's own previous Apply — leaves it
 * pointing at the wrong line. Handing a stale line to a write agent is worse
 * than handing it none, so the quote is looked up in the file instead.
 *
 * Null is an answer here, not a failure: spec 16 §5.1 asks each of the two
 * versions in turn, and "not in this one" is exactly what tells the two apart.
 */
function quoteLine(documentPath: string, quote: string | null): number | null {
  if (!quote) return null;

  let source: string;
  try {
    source = readFileSync(documentPath, "utf8");
  } catch {
    return null;
  }

  // The quote comes from normalised text, so its words may be split across
  // lines in the source; match on the opening words with flexible whitespace.
  const words = quote
    .split(/\s+/)
    .slice(0, 8)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return null;

  const at = source.search(new RegExp(words.join("\\s+")));
  if (at === -1) return null;
  return source.slice(0, at).split("\n").length;
}

/**
 * Spec 16 §5.1 — which version this passage's text lives in, and where.
 *
 * **Nothing stores the answer.** A comment is about the version its text is in,
 * and the only way to know is to look — which is what the renderer does with two
 * live DOMs and what this does with the two files. That also removes a class of
 * bug a stored field would have created: an anchor whose recorded version
 * disagreed with where its text actually turned out to be.
 *
 * The fallback when neither copy has it is the stored line, exactly as before.
 * A passage the agent cannot find anywhere is not evidence about which version
 * it belonged to.
 */
export function locatePassage(copy: string, base: string | null, anchor: Anchor): PassagePlace {
  // §6.7 — a gap has no text of its own. Its two neighbours are what say where
  // it is, and both are looked up in the version the agent will edit.
  if (anchor.gap) {
    return {
      version: "current",
      line: quoteLine(copy, anchor.gap.before?.quote?.exact ?? null),
      between: {
        after: quoteLine(copy, anchor.gap.after?.quote?.exact ?? null),
        before: quoteLine(copy, anchor.gap.before?.quote?.exact ?? null),
      },
    };
  }

  const quote = anchor.quote?.exact ?? null;
  const here = quoteLine(copy, quote);
  if (here !== null) return { version: "current", line: here };

  const there = base ? quoteLine(base, quote) : null;
  if (there !== null) return { version: "original", line: there };

  return { version: "current", line: anchor.source?.line ?? null };
}

/** Absolute path per documentId, for every document the thread targets. */
function pathsOf(db: Db, thread: Thread): Map<string, string> {
  const paths = new Map<string, string>();
  for (const record of documentsOf(db, thread)) {
    paths.set(record.id, record.ref.value);
  }
  return paths;
}

/** One document this run may change: the reviewer's file, and REX's copy of it. */
interface Editable {
  documentId: string;
  /** The reviewer's file. Never written by the agent (spec 15 §2). */
  original: string;
  /** `~/.rex/work/<documentId>/<name>.new<ext>` — the one file the agent may edit. */
  copy: string;
  meta: WorkingMeta;
}

/**
 * Spec 15 §4.1 — the agent is pointed at the working copies, and told what they
 * are.
 *
 * The passages keep naming the **document**, because that is what the reviewer
 * commented on and what the agent should reason about. Only the line numbers
 * come from the copy, through `locate` — they have to, since the copy is what
 * the agent will open and a line number from the original is wrong the moment
 * the first revision lands.
 */
function writePrompt(input: {
  db: Db;
  thread: Thread;
  root: string;
  files: Editable[];
  instruction: string;
  transcript: string;
}): string {
  const copies = new Map(input.files.map((file) => [file.original, file.copy]));
  const bases = new Map(input.files.map((file) => [file.original, basePath(file.meta)]));
  const locate = (documentPath: string, anchor: Anchor): PassagePlace =>
    locatePassage(
      copies.get(documentPath) ?? documentPath,
      bases.get(documentPath) ?? null,
      anchor,
    );

  // Spec 16 §5.4 — a comment can be about a passage only the ORIGINAL has, and
  // then the agent needs to be able to read the original. It is handed as a
  // readable path and is deliberately NOT on the editable list: spec 15 §4.3
  // puts back anything written outside that list, and `base` is the only copy
  // of the reviewer's own bytes in this whole design.
  const fromOriginal = input.thread.targets.some((target) => {
    const path = pathsOf(input.db, input.thread).get(target.documentId);
    return path !== undefined && locate(path, target.anchor).version === "original";
  });

  const parts = ["Files you may edit:"];
  for (const file of input.files) {
    parts.push(`- ${file.copy}`);
    parts.push(
      `  — the current version of ${relative(input.root, file.original) || file.original}`,
    );
  }
  parts.push("");
  parts.push(
    "Edit those files in place. They are REX's working copies: the reviewer has not",
    "accepted these changes yet, so the originals must not be touched. Anything you",
    "write outside the list above is put back and reported.",
    "",
  );

  if (fromOriginal) {
    parts.push("Files you may READ but never write:");
    for (const file of input.files) {
      parts.push(`- ${bases.get(file.original)}`);
      parts.push(
        `  — the ORIGINAL version of ${relative(input.root, file.original) || file.original},`,
        "    as it was before any of these changes. Read it to see what a passage said.",
      );
    }
    parts.push("");
  }

  parts.push(
    ...passageSection({
      thread: input.thread,
      documentPaths: pathsOf(input.db, input.thread),
      repositoryRoot: input.root,
      heading: "## The passages under discussion",
      locate,
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
  const earlier = last?.role === "user" && last.content === note ? messages.slice(0, -1) : messages;
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
 * Spec 15 §3.4 — everything REX might have to put back, copied before the run.
 *
 * Narrow on purpose: the working copy is where the change lives, so this exists
 * only to undo a write the agent had no business making (§4.3). Every path in
 * it is one `git checkout` could not restore — untracked, or already modified
 * when the run started — plus the targets themselves, which the agent is told
 * not to touch and might.
 *
 * Spec 14 and earlier refused to start on a dirty target for exactly the
 * opposite reason: the undo was `git checkout`, which discards everything since
 * the last commit. It is a copy now, so a dirty file is not even touched, and
 * `refuseDirtyTargets` is gone.
 */
function beforeSetFor(root: string, targets: readonly string[]): BeforeSet {
  const paths = new Set<string>(targets);
  for (const relativePath of changedFiles(root)) paths.add(`${root}/${relativePath}`);
  return takeBeforeSet(root, [...paths]);
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
    const controller = beginRun(thread.id);
    let result: Awaited<ReturnType<typeof runDeckApply>>;
    try {
      result = await runDeckApply({
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
        signal: controller.signal,
        onMessage: (message) => context.record(thread.id, message),
      });
    } catch (error) {
      // Nothing was written, so there is nothing to undo — the whole point of
      // §7.1's ordering. The run is failed and the reason is the reviewer's.
      completeApplyRun(db, run.id, "failed");
      throw error;
    } finally {
      endRun(thread.id, controller);
    }

    // Spec 17 §2.6 — stopped, with the same untouched deck a throw leaves. No
    // preview, because there is no edit, and no `apply:ready`, because there is
    // nothing to decide about. The conversation's STOPPED block says why.
    if (!result) {
      completeApplyRun(db, run.id, "failed");
      return run.id;
    }
    previews.push(result.preview);
  }

  setApplyRunDiff(db, run.id, "", decks);
  context.onApplyReady({
    applyRunId: run.id,
    threadId: thread.id,
    diff: "",
    files: decks,
    regions: [],
    skipped,
    // Spec 15 §10 — the deck pipeline is untouched. Its copy already lives in
    // the deck cache under its own name, and it is still accepted through
    // `apply:confirm` rather than through a working copy.
    working: [],
    restored: [],
    // A stopped deck run returned above, so reaching here means every deck was
    // planned and performed.
    stopped: false,
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

  const run = createApplyRun(db, threadId);
  const transcript = transcriptBefore(db, threadId, instruction);
  const documentIds = documentIdsByPath(db, thread);

  const touched: string[] = [];
  const working: WorkingCopyView[] = [];
  const restored: string[] = [];
  const regions: ChangedRegion[] = [];
  const diffs: string[] = [];
  /** Spec 17 §3.4 — the reviewer ended it, so it has no verdict to report. */
  let stopped = false;

  for (const [root, files] of groups) {
    // §3 — fork before anything runs. `base` is the reviewer's bytes, and it is
    // on disk before the agent's first tool call.
    const editable: Editable[] = files.map((original) => {
      const documentId = documentIds.get(original) as string;
      const meta = forkWorkingCopy(documentId, original);
      return { documentId, original, copy: currentPath(meta), meta };
    });
    const hashesBefore = new Map(editable.map((file) => [file.copy, currentHash(file.meta)]));
    const allowed = new Set(editable.map((file) => file.copy));
    const beforeSet = beforeSetFor(root, files);

    // §4.3 — the primary source for what this run touched. Exact, and it needs
    // no git: every write tool call carries the path it is about to write.
    const wrote = new Set<string>();

    // Spec 17 §2.5 — a write run is the one a reviewer most wants to be able to
    // end, and the one whose book-keeping must survive being ended.
    const controller = beginRun(threadId);
    let result: Awaited<ReturnType<typeof runAgent>>;
    try {
      result = await runAgent({
        cwd: root,
        profile: "write",
        prompt: writePrompt({ db, thread, root, files: editable, instruction, transcript }),
        // One session per repository: two turns sharing a session id would resume
        // the first one's transcript in the second one's working directory.
        sessionId: sessionIdFor(`${run.id}:${root}`),
        resume: false,
        model: thread.model,
        signal: controller.signal,
        onMessage: (message) => context.record(threadId, message),
        onWrote: (path) => wrote.add(path),
      });
    } finally {
      endRun(threadId, controller);
    }

    // §4.3 — put back anything written outside the working copies, whichever
    // source found it. Done before the error check, because a failed run can
    // have written just as much as a successful one.
    restored.push(...putBack(run.id, root, beforeSet, wrote, allowed));

    if (result.error) {
      completeApplyRun(db, run.id, "failed");
      throw new Error(result.error);
    }

    for (const file of editable) {
      // §4.2 — a file is changed when its hash moved. A rewrite with identical
      // bytes is not a revision anybody needs to undo.
      const next = saveRevision(file.meta, {
        applyRunId: run.id,
        threadId,
        before: hashesBefore.get(file.copy) ?? "",
      });
      if (!next) continue;

      const view = viewOf(next, root);
      working.push(view);
      touched.push(file.original);
      regions.push(...view.added);
      diffs.push(view.patch);
    }

    // Spec 17 §2.5 — stop means stop. This repository's partial change is
    // recorded above, so it is visible and undoable; the next repository is
    // simply not started.
    if (result.stopped) {
      stopped = true;
      break;
    }
  }

  const unified = diffs.join("\n");
  setApplyRunDiff(db, run.id, unified, touched);

  // §7.4 — a notice, not a gate. The reviewer's files still hold exactly what
  // they held before this ran, and they keep holding it until §7.2.
  context.onApplyReady({
    applyRunId: run.id,
    threadId,
    diff: unified,
    files: touched,
    regions,
    skipped,
    working,
    restored,
    stopped,
  });
  return run.id;
}

/** Absolute path → documentId, for every document the thread targets. */
function documentIdsByPath(db: Db, thread: Thread): Map<string, string> {
  const ids = new Map<string, string>();
  for (const record of documentsOf(db, thread)) ids.set(record.ref.value, record.id);
  return ids;
}

/** Spec 15 §3 — one working copy, as the two panes and the top bar need it. */
export function viewOf(meta: WorkingMeta, root: string): WorkingCopyView {
  const change = workingDiff({
    base: basePath(meta),
    current: currentPath(meta),
    path: meta.path,
    root,
  });
  let conflict: string | null = null;
  try {
    if (sha256(readFileSync(meta.path)) !== meta.baseSha256) {
      conflict =
        "This file has changed on disk since REX made its copy. Approving would throw your own edit away. Discard the copy and ask again, or open the two versions and copy across what you want.";
    }
  } catch {
    conflict = "This file cannot be read any more, so REX will not write over it.";
  }

  return {
    documentId: meta.documentId,
    path: meta.path,
    name: basename(meta.path),
    revisions: meta.revisions.length,
    addedLines: change.addedLines,
    removedLines: change.removedLines,
    added: change.added,
    removed: change.removed,
    patch: change.patch,
    conflict,
  };
}

/**
 * Spec 15 §4.3 — every file the agent wrote that was not its to write, put back.
 *
 * Two sources, because neither is complete on its own. `wrote` is exact but
 * blind to `Bash` — the write profile allows it (spec 11 §6.4.4), so `sed -i`
 * is a write no tool call names. The before-set catches those by content, but
 * only for paths git listed, so a brand-new file in an ignored directory is
 * seen by the first source and not the second.
 *
 * Restoring is a copy back, or a delete for a file that did not exist —
 * `git checkout` is not used, and cannot be: the paths that most need putting
 * back are the ones git does not track.
 */
function putBack(
  applyRunId: string,
  root: string,
  beforeSet: BeforeSet,
  wrote: ReadonlySet<string>,
  allowed: ReadonlySet<string>,
): string[] {
  const store = `${workRoot()}/`;
  const suspects = new Set<string>();
  for (const path of wrote) if (!allowed.has(path)) suspects.add(path);
  for (const path of beforeSet.contents.keys()) {
    if (!allowed.has(path) && movedSince(beforeSet, path)) suspects.add(path);
  }

  const done: string[] = [];
  for (const path of suspects) {
    // Never REX's own store. A stray write to a working copy's `base` would be
    // "restored" by deleting it, and `base` is the only copy of the reviewer's
    // original bytes — the one file in this design that must never be lost.
    if (path.startsWith(store)) continue;
    // A path the agent named but never changed is not a write. It happens: an
    // Edit that fails leaves the tool call in the transcript and the file alone.
    if (beforeSet.contents.has(path) && !movedSince(beforeSet, path)) continue;
    if (restoreFromBeforeSet(beforeSet, path, applyRunId)) done.push(relative(root, path) || path);
  }
  return done;
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
