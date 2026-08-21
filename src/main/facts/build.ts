// Spec 07 §4 and §4.7 — the stage order, the cursor, cancellation. WORKER
// (§10.2).
//
// A build is resumable, incremental and cancellable, and all three come from one
// place: the `fact_run` row's stage and cursor (§6.4). A build killed at chunk
// 812 of 4,000 restarts at 812; a second build over an unchanged folder finishes
// in seconds because stage 0 skips every document whose hash did not move.
//
// ── One divergence from the spec, stated rather than hidden ──────────────
//
// §4.3 step 3 says stage 2 writes an evidence row whose "claim it points at is
// not known yet — that is stage 3", and §5.6 says a build never runs two stages
// at once. Those two cannot both hold against §6.3's schema, where
// `fact_evidence.claim_id` is `NOT NULL`: there is nowhere to put an evidence
// row that has no claim.
//
// So stages 2 and 3 run **per chunk**: a chunk is extracted, its claims are
// canonicalized, its evidence is written, and only then does the cursor advance.
// Nothing is held between stages and no third table is invented.
//
// This is not the overlap §5.6 warns against. That warning's stated reason is
// that overlapping "would make the cursor of §4.7 meaningless and the build
// unresumable" — and per-chunk atomicity is what makes the cursor *mean*
// something: every chunk below it is fully stored, every chunk above it is
// untouched. Canonicalization is incremental by construction anyway (§4.4
// matches each claim against what is already in the store), so it has no barrier
// to wait for. Stages 4 and 5 do have one, and they keep it.

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { FactStage } from "../../shared/types.ts";
import type { Db } from "../db/database.ts";
import { renderDocx } from "../render/docx.ts";
import { isDocxPath, isHtmlPath, isMarkdownPath, isPdfPath } from "../render/formats.ts";
import { loadHtmlFile, sha256 } from "../render/html.ts";
import { renderMarkdown } from "../render/markdown.ts";
import { canonicalizeChunk, type PendingClaim } from "./canonical.ts";
import { chunkDocument } from "./chunk.ts";
import { extractChunk } from "./extract.ts";
import type { Gateway } from "./gateway.ts";
import { judgePairs } from "./judge.ts";
import { findCandidates } from "./pairs.ts";
import {
  addRunCounts,
  createVectorTables,
  documentHashes,
  finishRun,
  forgetDocument,
  recordDocument,
  setDocumentProgress,
  setRunProgress,
} from "./store.ts";
import { type DocumentText, htmlToText } from "./text.ts";
import { assignTopics } from "./topics.ts";

export interface BuildAliases {
  extract: string;
  judge: string;
  embed: string;
}

export interface BuildInput {
  db: Db;
  gateway: Gateway;
  runId: string;
  root: string;
  documents: string[];
  aliases: BuildAliases;
  /**
   * §4.7 — there is no resume point to pass in.
   *
   * Where a build restarts is a property of the documents, not of the caller:
   * stage 0 reads `fact_document.chunks_done` and hands each document its own
   * offset. A run-level cursor was tried and is wrong — see the note on
   * `chunks_done` in `schema.sql`.
   */
  onProgress: (stage: FactStage, done: number, total: number, message: string) => void;
  cancelled: () => boolean;
}

export interface BuildReport {
  /** §7.4 — everything the build did not cover. */
  droppedQuotes: number;
  failedChunks: number;
  failedPairs: number;
  skippedDocuments: Array<{ path: string; reason: string }>;
  cappedSubjects: Array<{ subjectLabel: string; claims: number }>;
  contradictions: number;
  supersedes: number;
  topics: number;
  cancelled: boolean;
}

/**
 * One document as text, or why it could not be read.
 *
 * The hash is of the **rendered text**, not the file bytes (§4.1) — a PDF
 * re-saved with no content change must not force a re-run, and a DOCX is a zip
 * whose bytes move when nothing in it did.
 */
function loadDocument(path: string): { text: DocumentText; hash: string } | { reason: string } {
  try {
    if (isMarkdownPath(path)) {
      const text = htmlToText(renderMarkdown(readFileSync(path, "utf8")));
      return { text, hash: sha256(Buffer.from(text.text)) };
    }
    if (isHtmlPath(path)) {
      const text = htmlToText(loadHtmlFile(path).source);
      return { text, hash: sha256(Buffer.from(text.text)) };
    }
    if (isPdfPath(path)) {
      // Spec 03 §7.1 — main never reads a PDF's text; PDF.js draws it in the
      // renderer, on a canvas, and there is no canvas in a utilityProcess.
      // Extracting nothing is the honest answer, and §7.4 makes it visible.
      return { reason: "PDF text is extracted in the renderer, which a build cannot reach" };
    }
    return { reason: "not a format the fact pipeline reads" };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

/** DOCX needs mammoth, which is async — so the dispatch above gets an async twin. */
async function loadDocumentAsync(
  path: string,
): Promise<{ text: DocumentText; hash: string } | { reason: string }> {
  if (!isDocxPath(path)) return loadDocument(path);
  try {
    const rendered = await renderDocx(path);
    const text = htmlToText(rendered.html);
    return { text, hash: sha256(Buffer.from(text.text)) };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

/** §3.4 — a document's own modification time, for ordering two claims. */
function modifiedAt(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export async function runBuild(input: BuildInput): Promise<BuildReport> {
  const { db, gateway, runId, root, aliases } = input;
  createVectorTables(db);

  // §5.1 — the preflight, before every build and not once at startup.
  //
  // "A build that starts against a half-configured gateway wastes hours before
  // it fails", and on a local model that is not a figure of speech: the first
  // extract call of this corpus was measured at over eleven minutes. Two seconds
  // of checking buys back an overnight run that would have died at the end.
  const preflight = await gateway.preflight([...new Set(Object.values(aliases))]);
  if (!preflight.healthy) {
    throw new Error(
      `The gateway at localhost:24000 is not healthy, so nothing can be read. Start it before building.`,
    );
  }
  if (preflight.missing.length > 0) {
    throw new Error(
      `The gateway does not serve ${preflight.missing.join(", ")}. A build needs every alias it was configured with.`,
    );
  }

  const report: BuildReport = {
    droppedQuotes: 0,
    failedChunks: 0,
    failedPairs: 0,
    skippedDocuments: [],
    cappedSubjects: [],
    contradictions: 0,
    supersedes: 0,
    topics: 0,
    cancelled: false,
  };

  // ── Stage 0 — scan and hash (§4.1) ────────────────────────
  input.onProgress("scan", 0, input.documents.length, "Reading documents");
  const known = documentHashes(db, root);
  const present = new Set(input.documents);

  // A document that is gone takes its evidence with it, and any claim whose last
  // evidence went with it (§4.1).
  for (const path of known.keys()) {
    if (!present.has(path)) forgetDocument(db, root, path);
  }

  interface Work {
    path: string;
    text: DocumentText;
    hash: string;
    /** §4.7 — chunks already stored, so a resumed build restarts inside it. */
    resumeFrom: number;
  }
  const work: Work[] = [];

  for (const [index, path] of input.documents.entries()) {
    if (input.cancelled()) {
      report.cancelled = true;
      return report;
    }
    const loaded = await loadDocumentAsync(path);
    if ("reason" in loaded) {
      report.skippedDocuments.push({ path, reason: loaded.reason });
      continue;
    }

    const seen = known.get(path);
    // §4.1 — hash unchanged AND finished means skip the document entirely. This
    // is the whole incremental story, and the reason extraction is per-document.
    // The second half of that test is what makes resume work: a document whose
    // text has not moved but whose chunks are only half stored is not "done", it
    // is where the last build stopped.
    const unchanged = seen?.contentHash === loaded.hash;
    if (unchanged && seen.chunksDone >= seen.chunkCount) continue;

    if (unchanged) {
      // Resuming inside it: its stored chunks stay, and extraction picks up
      // after them.
      work.push({ path, text: loaded.text, hash: loaded.hash, resumeFrom: seen.chunksDone });
    } else {
      // Changed, or new. A changed document's old evidence goes before the new
      // is written, or the document would state every claim twice.
      if (seen) forgetDocument(db, root, path);
      work.push({ path, text: loaded.text, hash: loaded.hash, resumeFrom: 0 });
    }
    input.onProgress("scan", index + 1, input.documents.length, "Reading documents");
  }

  // ── Stage 1 — chunk (§4.2) ────────────────────────────────
  const chunked = work.map((entry) => ({ ...entry, chunks: chunkDocument(entry.text) }));
  const totalChunks = chunked.reduce((total, entry) => total + entry.chunks.length, 0);
  input.onProgress("chunk", totalChunks, totalChunks, "Splitting documents");

  // ── Stages 2 and 3, per chunk (see the header) ────────────
  let cursor = 0;

  for (const entry of chunked) {
    // The row has to exist before the first chunk of it is stored, because
    // that chunk's completion is recorded against it.
    recordDocument(db, root, {
      path: entry.path,
      contentHash: entry.hash,
      chunkCount: entry.chunks.length,
      chunksDone: entry.resumeFrom,
    });

    for (const chunk of entry.chunks) {
      if (input.cancelled()) {
        report.cancelled = true;
        setRunProgress(db, runId, "extract", cursor, totalChunks);
        return report;
      }

      cursor++;
      // §4.7 — resume inside the document this build stopped in. Counted against
      // the document rather than the run, because the run's own cursor spans
      // every document and stage 0 has already dropped the finished ones.
      if (chunk.index < entry.resumeFrom) continue;

      try {
        const extracted = await extractChunk(gateway, aliases.extract, entry.text, chunk);
        report.droppedQuotes += extracted.droppedQuotes;
        addRunCounts(db, runId, { droppedQuotes: extracted.droppedQuotes });

        const pending: PendingClaim[] = extracted.claims.map((found) => ({
          claim: found.claim,
          anchor: found.anchor,
          documentPath: entry.path,
          chunkIndex: chunk.index,
        }));

        const counts = await canonicalizeChunk(db, gateway, root, pending, aliases.embed);
        addRunCounts(db, runId, {
          subjectsMerged: counts.subjectsMerged,
          claimsMerged: counts.claimsMerged,
        });
      } catch (error) {
        // §4.3 — a chunk whose call fails after two retries is recorded as
        // failed and the build continues. A build that ends with failures says
        // so (§7.4).
        report.failedChunks++;
        addRunCounts(db, runId, { failedChunks: 1 });
        console.warn(`[rex] chunk ${chunk.index} of ${basename(entry.path)} failed:`, error);
      }

      // Recorded per chunk, so an interrupted build resumes inside the document
      // rather than paying for all of it again. `chunk.index + 1` and not
      // `cursor`: the cursor counts the whole run.
      setDocumentProgress(db, root, entry.path, chunk.index + 1);
      setRunProgress(db, runId, "extract", cursor, totalChunks);
      input.onProgress("extract", cursor, totalChunks, "Extracting claims");
    }
  }

  // ── Stage 4 — pair and judge (§4.5) ───────────────────────
  //
  // §4.7 — stages 4 and 5 always re-run in full over the affected subjects. They
  // are the cheap end of the pipeline and a stale topic assignment is worse than
  // a re-computed one.
  if (input.cancelled()) {
    report.cancelled = true;
    return report;
  }

  input.onProgress("judge", 0, 1, "Comparing claims");
  const candidates = findCandidates(db, root);
  report.cappedSubjects = candidates.capped;

  const judged = await judgePairs(
    db,
    gateway,
    aliases.judge,
    candidates.pairs,
    modifiedAt,
    (done, total) => {
      setRunProgress(db, runId, "judge", done, total);
      input.onProgress("judge", done, total, "Comparing claims");
    },
    input.cancelled,
  );
  report.contradictions = judged.contradicts;
  report.supersedes = judged.supersedes;
  report.failedPairs = judged.failedPairs;

  // ── Stage 5 — topics (§4.6) ───────────────────────────────
  if (input.cancelled()) {
    report.cancelled = true;
    return report;
  }

  const topics = await assignTopics(
    db,
    gateway,
    root,
    aliases.judge,
    (done, total) => {
      setRunProgress(db, runId, "topics", done, total);
      input.onProgress("topics", done, total, "Naming topics");
    },
    input.cancelled,
  );
  report.topics = topics.communities;

  finishRun(db, runId, input.cancelled() ? "cancelled" : "done");
  return report;
}
