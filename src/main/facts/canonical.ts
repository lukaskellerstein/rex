// Spec 07 §4.4 — stage 3. WORKER (§10.2).
//
// The stage that decides whether the feature works. Extraction is easy now;
// making "TypeScript", "TS" and "Typescript 5.4" line up is not. In the
// literature this is **entity resolution**, and the standard method is embedding
// plus approximate nearest neighbour — `sqlite-vec` scans instead of indexing,
// which at this size is noise (§6.2).
//
// It is also the stage that made the build a separate process. 60,000 claims,
// each needing two synchronous `sqlite-vec` scans, is roughly an hour of
// 30-millisecond blocks — which on the thread that draws the window is not a
// freeze but an hour of stutter, and that looks like a bug (§10.1).

import type { Anchor, ExtractedClaim } from "../../shared/types.ts";
import type { Db } from "../db/database.ts";
import type { Gateway } from "./gateway.ts";
import {
  addCoOccurrence,
  insertClaim,
  insertEvidence,
  insertSubject,
  nearestClaim,
  nearestSubject,
} from "./store.ts";

/**
 * §4.4 step 2 — cosine similarity at or above this reuses the existing subject.
 *
 * **Measured, not guessed.** §4.4 states 0.90 and says so itself: "both defaults
 * are guesses… they must be tuned against a real folder". Against
 * `text-embedding-nomic-embed-text-v1.5` on 2026-08-21, over subject phrases of
 * the kind §3.2 asks the extractor for, the two populations separate cleanly:
 *
 *   should merge      0.686 … 0.913   ("build tool" ~ "build system" 0.705,
 *                                      "agent permissions" ~ "agent tool
 *                                      permissions" 0.913)
 *   should not merge  0.345 … 0.495   ("build tool" vs "agent permissions"
 *                                      0.449)
 *
 * 0.90 sits *inside* the should-merge band and would have rejected four of the
 * seven true pairs — nothing merges, every document invents its own vocabulary,
 * and the graph is fog. 0.62 sits in the empty gap with margin on both sides.
 *
 * The failure modes are not symmetric, which is why the margin below matters
 * more than the margin above: a subject merged wrongly manufactures
 * contradictions between claims that were never about the same thing, while a
 * subject split wrongly only means a contradiction goes unnoticed.
 */
export const SUBJECT_THRESHOLD = Number(process.env.REX_SUBJECT_THRESHOLD ?? 0.62);

/**
 * §4.4 step 3 — inside a subject, at or above this it is the same claim.
 *
 * Kept at the spec's 0.93, and the measurement is why rather than inertia. The
 * claim populations **overlap** and no threshold separates them:
 *
 *   same claim       0.517 … 1.000   ("TypeScript" ~ "TS" is 0.517)
 *   different claim  0.385 … 0.703   ("TypeScript" vs "TypeScript 5.4, strict
 *                                     mode" is 0.703)
 *
 * So this number cannot be chosen to be right; it can only be chosen to fail in
 * the recoverable direction. A false **merge** is permanent and silent: two
 * claims become one, no pair is ever formed, and the contradiction can never be
 * reported by anything downstream. A false **split** costs one judge call, and
 * §4.5's `same` label exists precisely to undo it — which is how "TypeScript"
 * and "TS" are reunited despite scoring 0.517.
 *
 * The overlapping pair is not even an error: "TypeScript" versus "TypeScript
 * 5.4, strict mode" is §3.3's `REFINES`, which is the judge's answer to give.
 *
 * So: high, deliberately, and asymmetric on purpose.
 */
export const CLAIM_THRESHOLD = Number(process.env.REX_CLAIM_THRESHOLD ?? 0.93);

/** One extracted claim, with the evidence that will hang off it. */
export interface PendingClaim {
  claim: ExtractedClaim;
  anchor: Anchor;
  documentPath: string;
  chunkIndex: number;
}

export interface CanonicalCounts {
  subjectsCreated: number;
  subjectsMerged: number;
  claimsCreated: number;
  claimsMerged: number;
}

/**
 * Folds one chunk's claims into the graph.
 *
 * Per chunk rather than per document or per corpus, for two reasons that both
 * matter: the co-occurrence rows of §4.4 are defined as "subjects appearing in
 * the same chunk", and embedding is batched, so a chunk is the natural unit that
 * keeps the batch full without holding a whole corpus of claims in memory.
 */
export async function canonicalizeChunk(
  db: Db,
  gateway: Gateway,
  root: string,
  pending: PendingClaim[],
  embedAlias: string,
): Promise<CanonicalCounts> {
  const counts: CanonicalCounts = {
    subjectsCreated: 0,
    subjectsMerged: 0,
    claimsCreated: 0,
    claimsMerged: 0,
  };
  if (pending.length === 0) return counts;

  // One round trip for every subject and value in the chunk. §5.6 — the batch
  // matters more than the concurrency for embeddings.
  const subjectVectors = await gateway.embed(
    pending.map((entry) => entry.claim.subject),
    embedAlias,
  );
  const valueVectors = await gateway.embed(
    pending.map((entry) => entry.claim.value),
    embedAlias,
  );

  /** Subjects touched by this chunk, for the co-occurrence rows below. */
  const touched = new Set<string>();

  for (const [index, entry] of pending.entries()) {
    // §4.4 step 2 — the nearest existing subject, or a new one.
    const nearSubject = nearestSubject(db, root, subjectVectors[index]);
    let subjectId: string;
    if (nearSubject && nearSubject.similarity >= SUBJECT_THRESHOLD) {
      subjectId = nearSubject.id;
      counts.subjectsMerged++;
    } else {
      subjectId = insertSubject(db, root, entry.claim.subject, subjectVectors[index]);
      counts.subjectsCreated++;
    }
    touched.add(subjectId);

    // §4.4 step 3 — inside that subject, the nearest existing claim.
    //
    // Scoped to the subject, which is §7.2's blocking step doing its real work:
    // it turns one global pairwise problem into many tiny local ones, and it is
    // the whole reason the three-level model of §3.1 exists.
    const nearClaim = nearestClaim(db, subjectId, valueVectors[index]);
    let claimId: string;
    if (nearClaim && nearClaim.similarity >= CLAIM_THRESHOLD) {
      claimId = nearClaim.id;
      counts.claimsMerged++;
    } else {
      claimId = insertClaim(db, {
        subjectId,
        value: entry.claim.value,
        modality: entry.claim.modality,
        statedAt: entry.claim.statedAt,
        embedding: valueVectors[index],
      });
      counts.claimsCreated++;
    }

    // §3.1 — "the same fact in five documents" is one claim with five evidence
    // nodes. This line is where that happens.
    insertEvidence(db, {
      claimId,
      documentPath: entry.documentPath,
      chunkIndex: entry.chunkIndex,
      quote: entry.claim.quote,
      anchor: entry.anchor,
    });
  }

  // §4.4 — a row for every pair of subjects in this chunk. Stage 5 needs it, and
  // nothing else does; the claim graph is nearly edgeless and Louvain over an
  // edgeless graph returns noise (§4.6).
  const subjects = [...touched];
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      addCoOccurrence(db, subjects[i], subjects[j]);
    }
  }

  return counts;
}
