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

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import type { ApplyConfirmResponse, DeckPreview } from "../shared/channels.ts";
import { findPart, locateFence, scanDiagram } from "../shared/diagram.ts";
import type {
  Anchor,
  AnchorSummary,
  ChangedRegion,
  DiagramRef,
  Message,
  SkippedDocument,
  Thread,
  WorkingCopyView,
} from "../shared/types.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import { type PassagePlace, passageSection, writeInstructions } from "./agent/prompts.ts";
import { runAgent } from "./agent/runner.ts";
import { beginRun, endRun, HELD_REASON, isHeld } from "./agent/runs.ts";
import { renderTranscript } from "./agent/transcript.ts";
import type { Db } from "./db/database.ts";
import {
  completeApplyRun,
  createApplyRun,
  findDocument,
  getApplyRun,
  getThread,
  listMessages,
  type MessageDraft,
  setApplyRunDiff,
  setDocumentHash,
  upsertDocument,
} from "./db/queries.ts";
import { runDocxApply } from "./docx/run.ts";
import { changedFiles, isRepository, repositoryRoot, revert } from "./git.ts";
import type { MediaResolver } from "./pptx/media.ts";
import { acceptDeckApply, discardDeckApply, runDeckApply } from "./pptx/run.ts";
import { isDocxPath, isPptxPath, isTextDocumentPath } from "./render/formats.ts";
import { sha256 } from "./render/html.ts";
import { putBack } from "./stray.ts";
import { applyPlan, documentsOf } from "./threads.ts";
import {
  type BeforeSet,
  basePath,
  currentHash,
  currentPath,
  ensureWorkingCopy,
  matchesBase,
  pendingCopies,
  restoredDir,
  saveRevision,
  takeBeforeSet,
  type WorkingMeta,
  workRoot,
} from "./work.ts";
import { workingDiff } from "./workDiff.ts";
import { isInsideWorkspace } from "./workspace/created.ts";

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
    /**
     * Spec 21 §4.3 — where the bytes a put-back removed were kept.
     *
     * Null when nothing was put back. Named in the notice because the reviewer
     * is otherwise never told the copy exists, which is how spec 21 §1's report
     * started.
     */
    restoredDir: string | null;
    /** Spec 21 §2 — files the agent created, kept where it wrote them. */
    created: string[];
    /** Spec 22 §5.1 — files the agent edited under the workspace root, held as working copies. */
    changed: string[];
    /**
     * Spec 21 §13 — absolute paths the agent wrote inside REX's own store.
     *
     * Left exactly where they are, and reported. Nothing in that directory is
     * ever shown, so a run that wrote its whole answer there looked to the
     * reviewer like a run that did nothing at all.
     */
    misplaced: string[];
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

/** Spec 29 §5.8 — the file line a diagram part is on in one file, or null when it is not in it. */
function diagramPartLine(documentPath: string, ref: DiagramRef): number | null {
  let source: string;
  try {
    source = readFileSync(documentPath, "utf8");
  } catch {
    return null;
  }
  const fence = locateFence(source, ref);
  if (!fence) return null;
  const found = findPart(scanDiagram(fence.source), ref);
  return found ? fence.fenceLine + found.lines.from : null;
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
  // Spec 29 §5.8 — a diagram part has no quote either. The fence is found again
  // in each version by its fingerprint or by the part, and the part in it by
  // what names it; a line number alone is never the answer.
  if (anchor.diagram) {
    const here = diagramPartLine(copy, anchor.diagram);
    if (here !== null) return { version: "current", line: here };
    const there = base ? diagramPartLine(base, anchor.diagram) : null;
    if (there !== null) return { version: "original", line: there };
    return { version: "current", line: anchor.source?.line ?? null };
  }
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

/**
 * Spec 21 §13 and spec 22 §6.1 — what the agent may do beyond its list, said
 * with a path instead of a pronoun.
 *
 * Its own function because it has two shapes and the difference matters: with
 * no workspace open, `putBack` keeps nothing (spec 21 §3) and adopts nothing
 * (spec 22 §2.3), so an agent that creates or edits a file has the work undone.
 * Telling it not to is better than letting it work and then removing the
 * result — and telling it that it *may*, once a workspace is open, is what
 * spec 22 §1.3 found missing: the agent was not unable to write, it was told
 * the write would be undone, and it chose to describe the change instead.
 */
function workspaceParagraph(workspaceRoot: string | null): string[] {
  if (workspaceRoot === null) {
    return [
      "Anything you write outside the list above is put back and reported.",
      "",
      "No workspace is open in REX, so a new file has nowhere to appear and REX will",
      "remove it. Do not create one. Answer in the discussion instead, and say what",
      "the file would have held.",
      "",
    ];
  }
  return [
    `The reviewer's workspace is ${workspaceRoot}. You may also edit any Markdown or`,
    "HTML file under it, in place. REX will hold your version beside the original",
    "and the reviewer will approve or discard it, so make the change they asked for",
    "rather than describing it. Do not change files they did not ask about.",
    `Anything you write outside ${workspaceRoot} is put back and reported.`,
    "",
    "If the reviewer asked you to create a NEW file, write it under",
    `${workspaceRoot} — the workspace open in REX. Use the path they named,`,
    "relative to that root. It appears in their file tree when the run ends.",
    "",
    "Never write a new file beside the working copies above. Their directory,",
    `${workRoot()}, is REX's own store and is not the workspace: the file tree does`,
    "not draw it, and nothing you leave there ever reaches the reviewer.",
    "",
    "Do not create files they did not ask for.",
    "",
  ];
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
  /**
   * Spec 21 §13 — the open workspace, as an absolute path the agent can write.
   *
   * Named in the prompt and not merely used by `putBack`, because §5 told the
   * agent to create a file "inside this workspace" and never said where that
   * was. The only directory the prompt showed was `~/.rex/work/<id>/`, so an
   * agent that obeyed the sentence wrote its new file into REX's store.
   */
  workspaceRoot: string | null;
  files: Editable[];
  instruction: string;
  transcript: string;
  /** Spec 24 §6.2 — the message being sent, so the places it added are marked. */
  addedWith: string | null;
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
    "accepted these changes yet, so the originals must not be touched.",
    "",
  );

  // Spec 21 §5 and §13, spec 22 §6.1 — what lies beyond the list, stated with
  // an address. The store is named because "inside this workspace" without a
  // root sent a file into it; the workspace root is named because without it
  // the agent has no way to know an edit there is now kept rather than undone.
  parts.push(...workspaceParagraph(input.workspaceRoot));

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
      addedWith: input.addedWith,
    }),
  );

  parts.push(...writeInstructions(input.transcript, input.instruction));
  return parts.join("\n");
}

/**
 * Spec 24 §4.2 — what a send can tell Apply beyond its instruction.
 *
 * `addedWith` is the id of the user message that carried this instruction.
 * The places that arrived with it are already rows by the time `startApply`
 * runs (`thread:apply` writes them first), so nothing here has to add them;
 * the id only lets the passage list say which ones the discussion never had a
 * chance to mention (§6.2).
 */
export interface ApplyOptions {
  addedWith?: string | null;
  /**
   * Spec 25 §4.1 — the model this ACT runs on, as the reviewer picked it.
   *
   * An argument and not `thread.model`, which is retired (§4.3): a field on the
   * comment would be mutable state no send owns, and an ACT started while an
   * ASK is still streaming would take the other one's model.
   */
  model?: string | null;
  /**
   * Spec 31 §2.3 — the output style this ACT writes in.
   *
   * ACT gets one for the same reason ASK does: in Claude Code a style applies
   * to everything a session does, and an exception here would be a rule the
   * reviewer has to remember.
   */
  style?: string | null;
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
  addedWith: string | null,
  /** Spec 25 §4.1 and spec 31 §4 — what this ACT runs under. `startApply`
   * already stamped `context.record`; this is the copy the deck agent needs. */
  model: string | null,
  style: string | null,
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
          addedWith,
        }),
        model,
        style,
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
    restoredDir: null,
    // Spec 22 §5.1 — and nothing edited beside it, so nothing adopted.
    changed: [],
    // Spec 21 §2 — the deck pipeline writes only into its own cache, so it has
    // no stray write to sort, nothing to keep and nothing misplaced.
    created: [],
    misplaced: [],
    // A stopped deck run returned above, so reaching here means every deck was
    // planned and performed.
    stopped: false,
    decks: previews,
  });
  return run.id;
}

/**
 * SPEC.md §8.7 steps 1–4, across every document the comment is about.
 *
 * `workspaceRoot` is spec 21 §3: the open workspace, so a file the agent
 * creates can be scoped to somewhere the reviewer will actually see it. Null
 * when no workspace is open, and then nothing created is kept.
 */
export async function startApply(
  outer: ApplyContext,
  threadId: string,
  instruction: string,
  workspaceRoot: string | null,
  options: ApplyOptions = {},
): Promise<string> {
  const model = options.model ?? null;
  const style = options.style ?? null;
  /**
   * Spec 25 §5 — every message this run produces says which model ran it.
   *
   * Stamped once, here, rather than at each of the dozen `record` calls below
   * and in `startDeckApply`: the model belongs to the run, so the run's own
   * context is the honest place to put it. `confirmApply` keeps the plain one —
   * accepting a diff is the reviewer's act and no model was involved.
   */
  const context: ApplyContext = {
    ...outer,
    record: (id, message) => outer.record(id, { ...message, model, style }),
  };
  const { db } = context;
  const thread = getThread(db, threadId);
  if (!thread) throw new Error(`No such thread: ${threadId}`);
  const addedWith = options.addedWith ?? null;
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
      addedWith,
      model,
      style,
    );
  }

  // Spec 19 §4.2 — a Word file is edited by a plan REX performs, not by the
  // agent's own Edit tool, so it runs on its own and cannot share the prose
  // agent's turn. It does share everything after that: the working copy, the
  // two panes, approve, undo and discard. So it is **not** split off the way a
  // deck is — a comment about a `.docx` and a `.md` applies to both in one run.
  const documents = plan.editable.filter((path) => isDocxPath(path));
  const prose = plan.editable.filter((path) => !isDocxPath(path));
  const groups = groupByRepository(prose, skipped);

  if (groups.size === 0 && documents.length === 0) {
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
  /** Spec 21 §2 — kept where the agent wrote them, and named in the notice. */
  const created: string[] = [];
  /** Spec 22 §5.1 — edited under the workspace root, held as working copies. */
  const changed: string[] = [];
  /** Spec 21 §13 — written into REX's store, where nothing would show them. */
  const misplaced: string[] = [];
  const regions: ChangedRegion[] = [];
  const diffs: string[] = [];
  /** Spec 17 §3.4 — the reviewer ended it, so it has no verdict to report. */
  let stopped = false;

  // Spec 19 §4.2 — the Word files, one agent each, each performed by REX.
  for (const [position, documentPath] of documents.entries()) {
    const documentId = documentIds.get(documentPath) as string;
    // §3 — the copy exists before anything runs, exactly as the prose path does.
    const meta = ensureWorkingCopy(documentId, documentPath);
    const before = currentHash(meta);
    const root = repositoryRoot(documentPath);

    // Spec 34 §5.1 — holding the document, so nobody replaces the copy under it.
    const controller = beginRun(threadId, [documentId]);
    let edited: Awaited<ReturnType<typeof runDocxApply>>;
    try {
      edited = await runDocxApply({
        runKey: deckRunKey(run.id, position),
        documentPath,
        workingPath: currentPath(meta),
        instruction,
        transcript,
        passages: passageSection({
          thread,
          documentPaths: pathsOf(db, thread),
          repositoryRoot: root,
          heading: "## The passages under discussion",
          addedWith,
        }),
        model,
        style,
        resolver: context.resolver,
        signal: controller.signal,
        onMessage: (message) => context.record(threadId, message),
      });
    } catch (error) {
      // Nothing was written, so there is nothing to undo — the whole point of
      // §4.2's ordering. The run is failed and the reason is the reviewer's.
      completeApplyRun(db, run.id, "failed");
      throw error;
    } finally {
      endRun(threadId, controller);
    }

    // Spec 17 §2.6 — stopped before the plan was finished, so the working copy
    // holds exactly what it held. The conversation's STOPPED block says why.
    if (!edited) {
      stopped = true;
      break;
    }

    // §4.2 — REX writes the copy, not the agent. `saveRevision` takes bytes and
    // does not care where they came from, so this is a new caller and not a new
    // mechanism.
    writeFileSync(currentPath(meta), edited.bytes);
    const next = saveRevision(meta, { applyRunId: run.id, threadId, before });
    // A run that took back everything an earlier one wrote has a revision and
    // no difference. There is nothing to review, so nothing is reported, and
    // `thread:apply` removes the copy when this returns (`work.ts` §4.2).
    if (next && !matchesBase(next)) {
      const view = viewOf(next, root);
      working.push(view);
      touched.push(documentPath);
      regions.push(...view.added);
      diffs.push(view.patch);
    }

    // §5.7 — the operation list, with its costs. A cost the reviewer finds
    // later is a cost REX hid, so it is said in the conversation.
    context.record(threadId, {
      role: "assistant",
      // There is no message kind for "REX did this" — the deck path puts its
      // operation list in the preview instead, and that surface does not exist
      // here (§5.7 departure, recorded in the spec). The conversation is where
      // a reviewer reads what happened, so the list goes there, named.
      kind: "text",
      content: [
        `REX performed this plan on ${basename(documentPath)}:`,
        ...edited.outcomes.map((outcome) => `- ${outcome.op}: ${outcome.summary}`),
        ...edited.outcomes.flatMap((outcome) => outcome.flags.map((flag) => `  ⚠ ${flag}`)),
      ].join("\n"),
      toolName: null,
      toolInput: null,
      isError: false,
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
    });
  }

  for (const [root, files] of groups) {
    if (stopped) break;
    // §3 — the copy exists before anything runs. `base` is the reviewer's
    // bytes, and it is on disk before the agent's first tool call. Spec 34
    // §3.3 — a copy that already exists is kept, or synced from the file when
    // nothing is pending.
    //
    // Spec 22 §12.1 — a pending working copy this workspace already holds for
    // another file in this repository is on the list too. Without it a second
    // ACT run on an adopted file reads the file on disk — the reviewer's bytes
    // — and its edit silently drops everything the previous run wrote, leaving
    // it only as a revision nobody is looking at.
    const editable: Editable[] = [
      ...files.map((original) => {
        const documentId = documentIds.get(original) as string;
        const meta = ensureWorkingCopy(documentId, original);
        return { documentId, original, copy: currentPath(meta), meta };
      }),
      ...pendingCopiesIn(root, workspaceRoot, files).map((meta) => ({
        documentId: meta.documentId,
        original: meta.path,
        copy: currentPath(meta),
        meta,
      })),
    ];
    const hashesBefore = new Map(editable.map((file) => [file.copy, currentHash(file.meta)]));
    const allowed = new Set(editable.map((file) => file.copy));
    const beforeSet = beforeSetFor(root, files);

    // §4.3 — the primary source for what this run touched. Exact, and it needs
    // no git: every write tool call carries the path it is about to write.
    const wrote = new Set<string>();

    // Spec 17 §2.5 — a write run is the one a reviewer most wants to be able to
    // end, and the one whose book-keeping must survive being ended. Spec 34
    // §5.1 — it holds every document on its list, so nobody replaces a copy
    // under it.
    const controller = beginRun(
      threadId,
      editable.map((file) => file.documentId),
    );
    let result: Awaited<ReturnType<typeof runAgent>>;
    try {
      result = await runAgent({
        cwd: root,
        profile: "write",
        prompt: writePrompt({
          db,
          thread,
          root,
          workspaceRoot,
          files: editable,
          instruction,
          transcript,
          addedWith,
        }),
        // One session per repository: two turns sharing a session id would resume
        // the first one's transcript in the second one's working directory.
        sessionId: sessionIdFor(`${run.id}:${root}`),
        resume: false,
        model,
        style,
        signal: controller.signal,
        onMessage: (message) => context.record(threadId, message),
        onWrote: (path) => wrote.add(path),
      });
    } finally {
      endRun(threadId, controller);
    }

    // §4.3 — put back anything written outside the working copies, whichever
    // source found it, and keep what it created (spec 21 §2). Done before the
    // error check, because a failed run can have written just as much as a
    // successful one.
    const stray = putBack({
      applyRunId: run.id,
      threadId,
      root,
      workspaceRoot,
      beforeSet,
      wrote,
      allowed,
      documentIdFor: (path) => documentIdFor(db, path),
    });
    restored.push(...stray.restored);
    created.push(...stray.created);
    misplaced.push(...stray.misplaced);

    // Spec 22 §3 step 5 — an adopted file is reported the way an anchored one
    // is: in `working`, so the panes and the list draw it, and in `changed`, so
    // the notice names it. Before the error check for the same reason the
    // put-back is: the copy exists whether or not the run ended well.
    for (const meta of stray.adopted) {
      // Back to the reviewer's own bytes — a second run undoing the first.
      // Nothing to review; `thread:apply` sweeps the copy on return.
      if (matchesBase(meta)) continue;
      const view = viewOf(meta, root);
      working.push(view);
      touched.push(meta.path);
      regions.push(...view.added);
      diffs.push(view.patch);
      changed.push(relative(root, meta.path));
    }

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
      // Moved, but back to the reviewer's own bytes: a revision and no
      // difference. Not reported, and removed by `thread:apply` on return.
      if (!next || matchesBase(next)) continue;

      const view = viewOf(next, root);
      working.push(view);
      touched.push(file.original);
      regions.push(...view.added);
      diffs.push(view.patch);
      // Spec 22 §5.1 — a pending copy is a file the comment is not about, so
      // the notice names it as it would name an adoption.
      if (!files.includes(file.original)) changed.push(relative(root, file.original));
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
    restoredDir: restored.length > 0 ? restoredDir(run.id) : null,
    created,
    changed,
    misplaced,
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

/**
 * Spec 22 §3 step 2 — the document row for a file the run adopted, made only
 * if REX has never seen the file. `upsertDocument` would overwrite the title of
 * one it has, and the disk holds the reviewer's bytes again by the time this
 * is called, so the hash stored is the file's and not the agent's.
 */
function documentIdFor(db: Db, path: string): string {
  const ref = { kind: "file" as const, value: path };
  const existing = findDocument(db, ref);
  if (existing) return existing.id;
  return upsertDocument(db, ref, null, sha256(readFileSync(path))).record.id;
}

/**
 * Spec 22 §12.1 — the pending working copies held for text documents in this
 * repository and this workspace, other than the ones the comment is anchored
 * to. By path containment rather than `git`, because the copy's file can be
 * gone from disk and a process per copy is a cost for a list that is seldom
 * more than a handful. Spec 34 §4 — pending, not present: a copy that equals
 * its file has nothing a second run could drop.
 */
function pendingCopiesIn(
  root: string,
  workspaceRoot: string | null,
  anchored: readonly string[],
): WorkingMeta[] {
  if (workspaceRoot === null) return [];
  return pendingCopies().filter(
    (meta) =>
      !anchored.includes(meta.path) &&
      isTextDocumentPath(meta.path) &&
      isInsideWorkspace(workspaceRoot, meta.path) &&
      isInsideWorkspace(root, meta.path),
  );
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
    // Spec 34 §5.2 — the same words main refuses with, so the greyed button
    // and the refusal cannot disagree.
    held: isHeld(meta.documentId) ? HELD_REASON : null,
  };
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
