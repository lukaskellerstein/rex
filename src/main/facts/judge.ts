// Spec 07 §4.5 — stage 4, the half that costs. WORKER (§10.2).
//
// The model sees one candidate pair at a time and labels it. It is never asked
// to *find* anything: `pairs.ts` did that in SQL, for the reason recorded there.

import type { Db } from "../db/database.ts";
import type { Gateway } from "./gateway.ts";
import type { Pair } from "./pairs.ts";
import { addEdge, type CandidateClaim, closeClaim, mergeClaims } from "./store.ts";

/**
 * §4.5 — "batched, one call per batch of 20 pairs".
 *
 * Batching is what makes a slow local model usable here: 130 judge batches at
 * the §7.3 ceiling instead of 2,600 individual calls, on a model measured at
 * tens of seconds per call whatever the input size.
 */
export const JUDGE_BATCH = 20;

export type Label = "same" | "refines" | "contradicts" | "unrelated";

const LABELS: readonly Label[] = ["same", "refines", "contradicts", "unrelated"];

const JUDGE_SYSTEM_PROMPT = `You compare pairs of claims taken from technical documents.

Each pair is about the same subject. For each one, return exactly one label:

- same: the two say the same thing in different words. A paraphrase.
- refines: one is a more specific form of the other. "TypeScript" and
  "TypeScript 5.4, strict mode" refine; they do not disagree.
- contradicts: both are asserted as true and they cannot both hold.
- unrelated: they are not actually about the same subject. The grouping was
  wrong.

Rules:
- Judge only what the quotes say. Do not use outside knowledge about the
  project, and do not guess at what the author probably meant.
- Different is not contradictory. Two components can each be written in a
  different language; a service and a library can both exist.
- If one claim is about a plan and the other about what exists today, that is
  not a contradiction unless they describe the same moment.
- When you are unsure, answer "unrelated" rather than "contradicts". A wrong red
  line costs the reader more than a missed one.

Return one entry per pair, in the order given, using the id supplied with each
pair.`;

const VERDICTS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: { type: "integer" },
          label: { type: "string", enum: LABELS },
        },
      },
    },
  },
};

interface Verdict {
  id: number;
  label: Label;
}

function parseVerdicts(value: unknown): Verdict[] {
  if (typeof value !== "object" || value === null) throw new Error("reply was not an object");
  const verdicts = (value as { verdicts?: unknown }).verdicts;
  if (!Array.isArray(verdicts)) throw new Error("`verdicts` was missing or not an array");

  return verdicts.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`verdicts[${index}] was not an object`);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "number" || !Number.isInteger(row.id)) {
      throw new Error(`verdicts[${index}].id must be the integer id given with the pair`);
    }
    if (!LABELS.includes(row.label as Label)) {
      throw new Error(`verdicts[${index}].label must be one of ${LABELS.join(", ")}`);
    }
    return { id: row.id, label: row.label as Label };
  });
}

function describe(pair: Pair, id: number): string {
  return [
    `PAIR ${id}`,
    `subject: ${pair.a.subjectLabel}`,
    `A (${pair.a.documentPath}): ${pair.a.value}`,
    `   "${pair.a.quote}"`,
    `B (${pair.b.documentPath}): ${pair.b.value}`,
    `   "${pair.b.quote}"`,
  ].join("\n");
}

/**
 * Labels one batch, retried once whole and then split in half.
 *
 * §4.5: "A batch that returns the wrong number of labels is retried once, then
 * split in half." Splitting rather than failing matters because one confusing
 * pair in a batch of twenty would otherwise cost the other nineteen their
 * verdict — and on this model that is a wasted minute per lost batch.
 */
async function labelBatch(
  gateway: Gateway,
  alias: string,
  batch: Pair[],
  offset: number,
): Promise<Map<number, Label>> {
  const body = batch.map((pair, index) => describe(pair, offset + index)).join("\n\n");

  try {
    const { value } = await gateway.chat({
      alias,
      system: JUDGE_SYSTEM_PROMPT,
      user: body,
      schema: VERDICTS_SCHEMA,
      schemaName: "verdicts",
      // Room for the reasoning a dense model emits before its JSON, plus the
      // JSON itself. A batch of 20 is ~400 tokens of answer; the rest is slack
      // so a truncated reply never costs the batch.
      maxTokens: 4096,
      parse: (parsed) => {
        const verdicts = parseVerdicts(parsed);
        if (verdicts.length !== batch.length) {
          throw new Error(`asked about ${batch.length} pairs and got ${verdicts.length} labels`);
        }
        return verdicts;
      },
    });
    return new Map(value.map((verdict) => [verdict.id, verdict.label]));
  } catch (error) {
    if (batch.length === 1) throw error;
    const half = Math.floor(batch.length / 2);
    const [left, right] = await Promise.all([
      labelBatch(gateway, alias, batch.slice(0, half), offset),
      labelBatch(gateway, alias, batch.slice(half), offset + half),
    ]);
    return new Map([...left, ...right]);
  }
}

export interface JudgeCounts {
  contradicts: number;
  supersedes: number;
  refines: number;
  merged: number;
  unrelated: number;
  /** §7.4 — batches that failed even after being split down to single pairs. */
  failedPairs: number;
}

/**
 * §3.4 — which of two claims is older, from a date the *text* carries or the
 * document's own modification time. Never from the model's opinion about which
 * one sounds newer.
 */
function olderOf(
  a: CandidateClaim,
  b: CandidateClaim,
  modifiedAt: (path: string) => number | null,
): { older: CandidateClaim; newer: CandidateClaim } | null {
  if (a.statedAt && b.statedAt && a.statedAt !== b.statedAt) {
    return a.statedAt < b.statedAt ? { older: a, newer: b } : { older: b, newer: a };
  }
  const at = modifiedAt(a.documentPath);
  const bt = modifiedAt(b.documentPath);
  if (at !== null && bt !== null && at !== bt) {
    return at < bt ? { older: a, newer: b } : { older: b, newer: a };
  }
  // §3.4 — if neither date exists, the pair stays `CONTRADICTS`.
  return null;
}

/**
 * Judges every candidate pair and writes the edges.
 *
 * `onProgress` is called after each batch: a build is measured in hours (§5.3)
 * and §8.5's bar has to show something moving.
 */
export async function judgePairs(
  db: Db,
  gateway: Gateway,
  alias: string,
  pairs: Pair[],
  modifiedAt: (path: string) => number | null,
  onProgress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<JudgeCounts> {
  const counts: JudgeCounts = {
    contradicts: 0,
    supersedes: 0,
    refines: 0,
    merged: 0,
    unrelated: 0,
    failedPairs: 0,
  };

  for (let start = 0; start < pairs.length; start += JUDGE_BATCH) {
    if (cancelled()) break;
    const batch = pairs.slice(start, start + JUDGE_BATCH);

    let labels: Map<number, Label>;
    try {
      labels = await labelBatch(gateway, alias, batch, start);
    } catch {
      // §7.4 — a batch nobody could label is reported, not hidden.
      counts.failedPairs += batch.length;
      onProgress(Math.min(start + batch.length, pairs.length), pairs.length);
      continue;
    }

    for (const [index, pair] of batch.entries()) {
      const label = labels.get(start + index);
      if (!label) {
        counts.failedPairs++;
        continue;
      }

      if (label === "unrelated") {
        // §4.5 — "stage 3 grouped them wrongly. Split the subject." Splitting is
        // not done here: it would rewrite the subject two live claims already
        // point at, mid-stage, and §4.7 would then have no consistent cursor to
        // resume from. The pair simply produces no edge, which is what the user
        // sees either way, and the merge counts in the build report are what
        // says the threshold needs moving.
        counts.unrelated++;
        continue;
      }

      if (label === "same") {
        // Fold B into A — the evidence moves, so the claim the user sees is now
        // stated by both documents, which is exactly §3.1's picture.
        mergeClaims(db, pair.a.id, pair.b.id);
        counts.merged++;
        continue;
      }

      if (label === "refines") {
        // §3.3 draws this arrow general → specific ("TypeScript" → "TypeScript
        // 5.4, strict mode"), but the four labels of §4.5 say only *that* one
        // refines the other, never which way round.
        //
        // Rather than write an arbitrary direction and let the lens draw it as
        // if it meant something, the longer value is taken as the more specific
        // one. It is a heuristic and it is right for the spec's own example —
        // a refinement almost always adds words rather than removing them. It
        // affects nothing but which end of a grey line the arrow sits on: a
        // `refines` pair is deliberately not a finding (§8.1 lists only
        // `contradicts` and `supersedes`), which is why this is worth a comment
        // rather than a fifth label and another minute of judging per batch.
        const [general, specific] =
          pair.a.value.length <= pair.b.value.length ? [pair.a, pair.b] : [pair.b, pair.a];
        addEdge(db, general.id, specific.id, "refines");
        counts.refines++;
        continue;
      }

      // §3.4 — most apparent contradictions in a real document set are an old
      // decision and a new one. Paint those red and the third one teaches the
      // user to ignore red.
      const ordered = olderOf(pair.a, pair.b, modifiedAt);
      if (ordered) {
        closeClaim(db, ordered.older.id);
        addEdge(db, ordered.newer.id, ordered.older.id, "supersedes");
        counts.supersedes++;
      } else {
        addEdge(db, pair.a.id, pair.b.id, "contradicts");
        counts.contradicts++;
      }
    }

    onProgress(Math.min(start + batch.length, pairs.length), pairs.length);
  }

  return counts;
}
