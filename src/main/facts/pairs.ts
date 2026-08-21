// Spec 07 §4.5 — stage 4, the half that costs nothing. WORKER (§10.2).
//
// **Do not ask a model to find contradictions.** The ALICE study measured an LLM
// asked to find contradictions in requirement documents at 97% accuracy, 0%
// precision and 0% recall — it answered "no contradiction" nearly every time and
// scored well because contradictions are rare. The same study's hybrid method,
// which hands the model one candidate pair at a time, reached 94% precision and
// 60% recall.
//
// So the search is code — this file — and the judging is the model (`judge.ts`).

import type { Db } from "../db/database.ts";
import { type CandidateClaim, candidateSubjects, claimsOfSubject } from "./store.ts";

/**
 * The most claims one subject may be paired exhaustively.
 *
 * Pairing is quadratic in the claims of a single subject (§7.1), and §7.2's
 * three filters normally leave two or three distinct values — but a subject that
 * over-merged can hold dozens, and 60 claims is 1,770 pairs, which at one judge
 * batch per 20 pairs is 89 calls for one subject on a model that takes a minute
 * each.
 *
 * When the cap bites, the claims with the most evidence are kept: a claim three
 * documents state is more worth judging than one that appears once. §7.4 forbids
 * this being silent, so `capped` is reported and reaches the build summary.
 */
export const MAX_CLAIMS_PER_SUBJECT = 20;

export interface Pair {
  a: CandidateClaim;
  b: CandidateClaim;
}

export interface Candidates {
  pairs: Pair[];
  /** §7.4 — subjects whose claim count exceeded the cap, and were trimmed. */
  capped: Array<{ subjectLabel: string; claims: number }>;
}

/**
 * Every pair worth asking about, from the `GROUP BY … HAVING` of §4.5.
 *
 * The expensive filters have already run in SQL — `valid_to IS NULL` drops
 * superseded claims, and the modality filter stops a rejected option
 * contradicting a decision. What is left here is turning each surviving group
 * into pairs.
 */
export function findCandidates(db: Db, root: string): Candidates {
  const pairs: Pair[] = [];
  const capped: Candidates["capped"] = [];

  for (const subjectId of candidateSubjects(db, root)) {
    let claims = claimsOfSubject(db, subjectId);
    if (claims.length < 2) continue;

    if (claims.length > MAX_CLAIMS_PER_SUBJECT) {
      capped.push({ subjectLabel: claims[0].subjectLabel, claims: claims.length });
      claims = claims.slice(0, MAX_CLAIMS_PER_SUBJECT);
    }

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        // Deliberately **not** filtered to pairs from different documents. That
        // filter is tempting — §1 asks "do these documents agree with each
        // other" — and it would throw away the case §1's own citation is about:
        // humans miss contradictions separated across *long text*, which is one
        // document disagreeing with itself twenty pages later. §4.5's SQL does
        // not filter by document either.
        pairs.push({ a: claims[i], b: claims[j] });
      }
    }
  }

  return { pairs, capped };
}
