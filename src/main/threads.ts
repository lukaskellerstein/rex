// Everything about a thread that is not a row.
//
// Spec 05 makes a comment span documents, and two questions follow that no
// single table answers: which documents is this comment about, and which of them
// can Apply edit? Both are asked by `thread:list` for every row and by
// `apply.ts` before it runs an agent, so they are answered once, here, rather
// than twice with a chance of disagreeing.

import { basename } from "node:path";
import type {
  DocumentRecord,
  SkippedDocument,
  Thread,
  ThreadWithMessages,
} from "../shared/types.ts";
import type { Db } from "./db/database.ts";
import { getDocument, listMessages } from "./db/queries.ts";
import { applyDisabledReason } from "./render/formats.ts";

/** What a row shows: the file name, or the host for a URL. Never a whole path. */
export function documentName(record: DocumentRecord): string {
  if (record.ref.kind === "file") return basename(record.ref.value);
  try {
    return new URL(record.ref.value).host;
  } catch {
    return record.ref.value;
  }
}

/**
 * The documents a comment is about, in target order and without repeats.
 *
 * A synthesis thread has no targets, so it falls back to the document it was
 * written on — it still belongs somewhere, and a row with no document name reads
 * as a bug.
 */
export function documentsOf(db: Db, thread: Thread): DocumentRecord[] {
  const ids = thread.targets.map((target) => target.documentId);
  const ordered = [...new Set(ids.length > 0 ? ids : [thread.documentId])];
  return ordered
    .map((id) => getDocument(db, id))
    .filter((record): record is DocumentRecord => record !== null);
}

export interface ApplyPlan {
  /** Absolute paths, in target order — what the write agent will be given. */
  editable: string[];
  /** Named in the UI before the button is pressed, and again in the result. */
  skipped: SkippedDocument[];
}

/**
 * Spec 05 §5.6 — which of a comment's documents Apply can edit.
 *
 * A URL, a PDF and a DOCX each fail spec 01 §5.2's test individually rather than
 * for the whole comment: a comment about a Markdown file and a PDF is a comment
 * whose Markdown half can still be applied.
 *
 * Being in a git repository is deliberately not checked here. It costs a
 * subprocess per document, this runs for every row of the comment list, and
 * `apply.ts` checks it anyway at the point where it matters.
 */
export function applyPlan(db: Db, thread: Thread): ApplyPlan {
  const editable: string[] = [];
  const skipped: SkippedDocument[] = [];

  for (const record of documentsOf(db, thread)) {
    if (record.ref.kind !== "file") {
      // The identifier, not the pretty name: `file` is what a reviewer would
      // paste back to find the thing, and the UI shortens it for display.
      skipped.push({
        file: record.ref.value,
        reason: "Apply needs a local source file; this document is a URL.",
      });
      continue;
    }
    const reason = applyDisabledReason(record.ref.value);
    if (reason) skipped.push({ file: record.ref.value, reason });
    else editable.push(record.ref.value);
  }

  return { editable, skipped };
}

/** The one sentence the card shows when Apply is offered on nothing. */
function whyNothingToApply(plan: ApplyPlan): string {
  if (plan.skipped.length === 1) return plan.skipped[0].reason;
  if (plan.skipped.length === 0) return "This comment has no document to edit.";
  return "None of the documents this comment is about can be edited.";
}

/** A thread as `thread:list` returns it — transcript and display facts attached. */
export function withDetail(db: Db, thread: Thread): ThreadWithMessages {
  const plan = applyPlan(db, thread);
  const names = new Map(documentsOf(db, thread).map((record) => [record.id, documentName(record)]));
  return {
    ...thread,
    messages: listMessages(db, thread.id),
    documentNames: [...names.values()],
    targetNames: thread.targets.map((target) => names.get(target.documentId) ?? "unknown"),
    applyEnabled: plan.editable.length > 0,
    applyDisabledReason: plan.editable.length > 0 ? null : whyNothingToApply(plan),
  };
}
