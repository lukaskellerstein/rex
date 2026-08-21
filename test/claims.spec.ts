// Spec 07 §12 milestone 0 — THE GATE.
//
// A standalone script. No Electron, no database, no UI. It asks one question:
// can the local model return the claim schema reliably? If it cannot, nothing
// after it works, and that is a two-day answer rather than a two-month one.
//
// Run: npm run test:claims
//
// It costs real minutes — `local-31b` measured ~80 s for a three-sentence
// passage on 2026-08-21 — so it is not part of any watch loop and `nvim-tools`
// never runs it. Every chunk is simply launched: the Gateway's own per-alias
// limiter is what decides how many actually run at once (§5.6), which is the
// point of putting that number in one place.
//
// What it prints under "measurements" is what §5.3 and §12 ask to be written
// back into the spec. What it prints under "acceptance" is §12's own checklist,
// and the three checks that can be judged mechanically are also assertions.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chunkDocument } from "../src/main/facts/chunk.ts";
import { extractChunk } from "../src/main/facts/extract.ts";
import { EMBEDDING_DIMENSIONS, Gateway } from "../src/main/facts/gateway.ts";
import { htmlToText } from "../src/main/facts/text.ts";
import { renderMarkdown } from "../src/main/render/markdown.ts";
import type { ExtractedClaim } from "../src/shared/types.ts";

/** §12 — 1,063 lines, and part of the corpus anchoring was developed against. */
const DOCUMENT = join(homedir(), "Projects/Github/redhat/ProtoBot/docs/architecture/components.md");

/** §12 — "extract claims from 10 chunks". */
const CHUNKS_TO_TEST = 10;

/** §5.4 — the terminal alias: no fallback chain, so the documents cannot leave. */
const ALIAS = process.env.REX_FACTS_ALIAS ?? "local-31b";

const REQUIRED_ALIASES = ["local", "local-31b", "embed"] as const;

/** §12 — "subjects are noun phrases, not sentences, by inspection of 30 of them". */
const SUBJECTS_TO_INSPECT = 30;

/**
 * A subject that is really a sentence.
 *
 * §3.2 rule 1 decides whether anything ever merges, and it fails in a way no
 * schema can catch: "the project uses TypeScript" is a perfectly valid string.
 * These are the giveaways — a finite verb, a full stop, or simply being longer
 * than an index entry could be. It is a screen, not a judge: §12 asks for
 * inspection, so the script prints the subjects and this only decides which of
 * them are worth looking at first.
 */
const SENTENCE_VERB =
  /\b(is|are|was|were|be|has|have|will|shall|must|should|can|may|does|do|uses|runs|needs|provides|requires|supports|stores)\b/i;

function looksLikeSentence(subject: string): boolean {
  return SENTENCE_VERB.test(subject) || subject.includes(".") || subject.split(/\s+/).length > 6;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

interface Outcome {
  index: number;
  error: string | null;
  claims: ExtractedClaim[];
  dropped: number;
  durationMs: number;
  model: string | null;
  completionTokens: number | null;
  attempts: number;
}

async function main(): Promise<void> {
  const gateway = new Gateway();

  // ── §12 check 1 — preflight (§5.1) ─────────────────────────
  const preflight = await gateway.preflight(REQUIRED_ALIASES);
  console.log(`gateway healthy:  ${preflight.healthy}`);
  console.log(
    `aliases missing:  ${preflight.missing.length === 0 ? "none" : preflight.missing.join(", ")}`,
  );
  assert.equal(preflight.healthy, true, "GET /health/readiness did not answer healthy");
  assert.deepEqual(preflight.missing, [], "the gateway does not list every required alias");

  // ── §12 check 5 — `embed` returns 768-dimension vectors ────
  const embedStarted = Date.now();
  const vectors = await gateway.embed(["implementation language", "comment storage"]);
  const embedMs = Date.now() - embedStarted;
  console.log(
    `embed:            ${vectors.length} vectors of ${vectors[0]?.length} dims in ${embedMs} ms`,
  );
  assert.equal(vectors.length, 2, "embed returned the wrong number of vectors");
  for (const vector of vectors) assert.equal(vector.length, EMBEDDING_DIMENSIONS);

  // ── Stages 0 and 1 — plain code, and free ──────────────────
  const source = readFileSync(DOCUMENT, "utf8");
  const document = htmlToText(renderMarkdown(source));
  const chunks = chunkDocument(document);
  console.log(
    `\n${DOCUMENT}\n  ${source.length} bytes of Markdown -> ${document.text.length} chars of` +
      ` normalised text in ${document.blocks.length} blocks -> ${chunks.length} chunks`,
  );
  assert.ok(chunks.length >= CHUNKS_TO_TEST, `only ${chunks.length} chunks to test with`);

  // Free, and it catches a `text.ts` regression before a single model call is
  // paid for: a chunk whose span is not inside the document text would produce
  // anchors that could only ever orphan.
  for (const chunk of chunks) {
    assert.ok(chunk.start < chunk.end, `chunk ${chunk.index} is empty`);
    assert.ok(chunk.end <= document.text.length, `chunk ${chunk.index} runs past the document`);
  }

  // ── §12 checks 2, 3, 4 and 6 — extraction ──────────────────
  const selected = chunks.slice(0, CHUNKS_TO_TEST);
  console.log(`\nextracting ${selected.length} chunks on \`${ALIAS}\`…\n`);

  const started = Date.now();
  const outcomes: Outcome[] = await Promise.all(
    selected.map(async (chunk): Promise<Outcome> => {
      try {
        const result = await extractChunk(gateway, ALIAS, document, chunk);
        const outcome: Outcome = {
          index: chunk.index,
          error: null,
          claims: result.claims.map((entry) => entry.claim),
          dropped: result.droppedQuotes,
          durationMs: result.stats.durationMs,
          model: result.stats.model,
          completionTokens: result.stats.completionTokens,
          attempts: result.stats.attempts,
        };
        console.log(
          `  chunk ${String(chunk.index).padStart(2)}: ${String(outcome.claims.length).padStart(2)}` +
            ` kept, ${outcome.dropped} dropped, ${seconds(outcome.durationMs)},` +
            ` ${outcome.completionTokens ?? "?"} out, attempt ${outcome.attempts}`,
        );
        return outcome;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(
          `  chunk ${String(chunk.index).padStart(2)}: FAILED — ${message.slice(0, 160)}`,
        );
        return {
          index: chunk.index,
          error: message,
          claims: [],
          dropped: 0,
          durationMs: 0,
          model: null,
          completionTokens: null,
          attempts: 2,
        };
      }
    }),
  );
  const wallMs = Date.now() - started;

  const good = outcomes.filter((outcome) => outcome.error === null);
  const kept = good.flatMap((outcome) => outcome.claims);
  const dropped = good.reduce((total, outcome) => total + outcome.dropped, 0);
  const returned = kept.length + dropped;
  const durations = good.map((outcome) => outcome.durationMs).sort((a, b) => a - b);
  const median = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;

  // ── The measurements §5.3 and §12 want written into the spec ──
  console.log("\n── measurements (§5.3, §12) ──");
  console.log(
    `  chunk size:   ${Math.round(selected.reduce((n, c) => n + c.text.length, 0) / selected.length)} chars average`,
  );
  console.log(
    `  per call:     median ${seconds(median)}, min ${seconds(durations[0] ?? 0)}, max ${seconds(durations.at(-1) ?? 0)}`,
  );
  console.log(
    `  wall clock:   ${seconds(wallMs)} for ${selected.length} chunks (concurrency from gateway.ts)`,
  );
  console.log(`  answered by:  ${[...new Set(good.map((o) => o.model))].join(", ") || "nothing"}`);
  console.log(
    `  output:       median ${durations.length > 0 ? good.map((o) => o.completionTokens ?? 0).sort((a, b) => a - b)[Math.floor(good.length / 2)] : 0} completion tokens`,
  );
  console.log(
    `  claims:       ${returned} returned, ${kept.length} kept, ${dropped} dropped for a non-verbatim quote`,
  );
  console.log(
    `  retries:      ${good.filter((o) => o.attempts > 1).length} of ${good.length} chunks needed a second attempt`,
  );

  // ── §12 check 4 — subjects, by inspection ──────────────────
  const subjects = kept.map((claim) => claim.subject);
  const sample = subjects.slice(0, SUBJECTS_TO_INSPECT);
  const sentences = sample.filter(looksLikeSentence);
  console.log(`\n── subjects, first ${sample.length} of ${subjects.length} (§12 check 4) ──`);
  for (const subject of sample) {
    console.log(`  ${looksLikeSentence(subject) ? "!" : " "} ${subject}`);
  }
  console.log(
    `  ${sentences.length} of ${sample.length} look like sentences rather than noun phrases`,
  );

  const byModality = new Map<string, number>();
  for (const claim of kept)
    byModality.set(claim.modality, (byModality.get(claim.modality) ?? 0) + 1);
  console.log(`\n  modality: ${[...byModality].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);

  console.log("\n── a sample of what was extracted ──");
  for (const claim of kept.slice(0, 8)) {
    console.log(`  ${claim.subject}  =  ${claim.value}  [${claim.modality}]`);
    console.log(`      "${claim.quote.slice(0, 110)}${claim.quote.length > 110 ? "…" : ""}"`);
  }

  // ── §12's checklist ────────────────────────────────────────
  const verbatim = returned === 0 ? 0 : kept.length / returned;
  const nounPhrases = sample.length === 0 ? 0 : 1 - sentences.length / sample.length;

  console.log("\n── §12 milestone 0 acceptance ──");
  const check = (pass: boolean, label: string): void =>
    console.log(`  [${pass ? "x" : " "}] ${label}`);
  check(
    preflight.healthy && preflight.missing.length === 0,
    "readiness healthy, all three aliases listed",
  );
  check(good.length >= 9, `valid ExtractedClaim JSON for ${good.length} of 10 chunks (need 9)`);
  check(verbatim >= 0.9, `${percent(kept.length, returned)} of quotes verbatim (need 90%)`);
  check(
    nounPhrases >= 0.9,
    `${(nounPhrases * 100).toFixed(0)}% of ${sample.length} subjects are noun phrases`,
  );
  check(
    vectors.every((v) => v.length === EMBEDDING_DIMENSIONS),
    "embed returns 768-dimension vectors",
  );
  check(durations.length > 0, `per-call time measured: median ${seconds(median)}`);

  // §12: "If the quote check or the noun-phrase check fails, stop." These are
  // the gate, so they are assertions and not just a printed cross.
  assert.ok(good.length >= 9, `only ${good.length}/10 chunks returned valid schema`);
  assert.ok(verbatim >= 0.9, `only ${percent(kept.length, returned)} of quotes were verbatim`);
  assert.ok(
    nounPhrases >= 0.9,
    `only ${(nounPhrases * 100).toFixed(0)}% of subjects are noun phrases — fix the prompt before building anything else`,
  );

  console.log("\nMilestone 0 passed.");
}

await main();
