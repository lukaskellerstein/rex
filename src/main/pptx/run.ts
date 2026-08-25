// Spec 11 §7.1 — Apply on a deck, end to end.
//
// The flow, and why it is this way round:
//
//   comment + Apply → write agent reads the text sidecar
//                   → agent writes plan.json into REX's cache
//                   → REX validates the plan            (refused? nothing written)
//                   → REX performs it ON A COPY
//                   → REX re-parses the copy and compares it to the intent
//                   → preview: every affected slide, before and after
//                   → accept: the copy replaces the deck
//                   → reject: the copy is discarded
//
// The reviewer's guarantee here is **stronger** than on Markdown, not weaker.
// The prose path edits the file and reverts it with `git checkout` if the
// reviewer says no, so there is a window in which a rejected Apply has already
// changed the file. There is no such window here: the original is not modified
// at any point before acceptance, and it needs no git repository for that to be
// true — which matters, because a deck often lives in a folder that is not one.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DeckPreview, DeckSlidePreview } from "../../shared/channels.ts";
import { sessionIdFor } from "../agent/profiles.ts";
import {
  DECK_WRITE_SYSTEM_PROMPT,
  NO_GENERATION_NOTE,
  writeInstructions,
} from "../agent/prompts.ts";
import { runAgent } from "../agent/runner.ts";
import type { MessageDraft } from "../db/queries.ts";
import { ensureSidecar, renderSlidePage } from "../render/pptx.ts";
import { deckCacheDir } from "../render/pptxText.ts";
import { readDeckMap } from "./deck.ts";
import { applyPlanToPackage } from "./edit.ts";
import { generationAvailable, type MediaResolver, setMediaOutputDir } from "./media.ts";
import { openPackage } from "./package.ts";
import { type EditPlan, PlanError, parsePlan } from "./plan.ts";
import { affectedSlides, intentProblems, newProblems, videoProblems } from "./validate.ts";

function hashOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Where the edited copy waits between the preview and the reviewer's answer.
 *
 * Derived from the deck's own path and its **current** content hash rather than
 * stored, so `confirmApply` can find it again without a second piece of state
 * to keep in step. The original cannot have changed in between — REX has not
 * touched it, and if something else did, the hash no longer matches and the
 * pending copy is correctly not found.
 */
export function pendingCopyPath(deckPath: string, contentHash: string, runKey: string): string {
  return join(deckCacheDir(contentHash), `pending-${runKey}-${basename(deckPath)}`);
}

/** Where the agent is told to write its plan. Outside every repository (§7.2). */
function planPath(contentHash: string, runKey: string): string {
  return join(deckCacheDir(contentHash), `plan-${runKey}.json`);
}

export interface DeckApplyInput {
  /**
   * Names this deck's slot in the run, and is used to build file names.
   *
   * It must be filesystem-safe: an earlier version put the deck's own path in
   * here and `plan-${key}.json` became a nested directory, because a path is
   * full of separators. The caller derives it from the run id and the deck's
   * position in the run instead.
   */
  runKey: string;
  deckPath: string;
  /** Spec 12 §4.2 — what the reviewer typed in ACT mode. The order itself. */
  instruction: string;
  /** The discussion, rendered the way the prose path renders it. */
  transcript: string;
  /** What the reviewer highlighted, already described. */
  passages: string[];
  model: string | null;
  /** §7.4.2 — the renderer's diagram drawer, passed down from the IPC layer. */
  resolver: MediaResolver;
  onMessage: (draft: MessageDraft) => void;
}

export interface DeckApplyResult {
  preview: DeckPreview;
  /** The edited copy, written and waiting for the reviewer's answer. */
  pendingPath: string;
}

function buildPrompt(input: {
  deckPath: string;
  sidecarPath: string;
  planPath: string;
  passages: string[];
  instruction: string;
  transcript: string;
}): string {
  return [
    `Deck: ${input.deckPath}`,
    `Its text, to read: ${input.sidecarPath}`,
    `Write your plan to: ${input.planPath}`,
    "",
    ...input.passages,
    // Spec 12 §4.2 — the same tail the prose path uses, so a deck and a
    // Markdown file are told what to do the same way.
    ...writeInstructions(input.transcript, input.instruction),
  ].join("\n");
}

/**
 * §7.1 — run the write agent, then do everything it proposed, on a copy.
 *
 * Every refusal below throws, and a throw means nothing was written anywhere
 * near the reviewer's deck. There is no partial application (§7.2.2 rule 5), so
 * the reviewer never has to reason about a deck that is half edited.
 */
export async function runDeckApply(input: DeckApplyInput): Promise<DeckApplyResult> {
  const source = readFileSync(input.deckPath);
  const contentHash = hashOf(source);

  const sidecarPath = await ensureSidecar(input.deckPath);
  if (!sidecarPath) {
    throw new Error(
      `REX could not read ${basename(input.deckPath)}, so it will not offer to edit it.`,
    );
  }

  // §6.4.3 — without this the media server returns what it makes as base64 in
  // the tool response, which for a video means a multi-megabyte blob in the
  // transcript, in SQLite, replayed on every thread open.
  setMediaOutputDir(deckCacheDir(contentHash));

  const plans = planPath(contentHash, input.runKey);
  // A stale plan from an interrupted run would be read as this run's answer.
  rmSync(plans, { force: true });

  const result = await runAgent({
    cwd: dirname(input.deckPath),
    profile: "write",
    systemPrompt: generationAvailable()
      ? DECK_WRITE_SYSTEM_PROMPT
      : `${DECK_WRITE_SYSTEM_PROMPT}\n\n${NO_GENERATION_NOTE}`,
    prompt: buildPrompt({
      deckPath: input.deckPath,
      sidecarPath,
      planPath: plans,
      passages: input.passages,
      instruction: input.instruction,
      transcript: input.transcript,
    }),
    // §8.1 — one turn, one session, and the id has to be a UUID the SDK will
    // accept. The run key is what makes it unique across the decks in one run.
    sessionId: sessionIdFor(input.runKey),
    resume: false,
    model: input.model,
    // §6.4.2 — a `.pptx` is a marker: the two design plugins load only here.
    documentPath: input.deckPath,
    onMessage: input.onMessage,
  });
  if (result.error) throw new Error(result.error);

  if (!existsSync(plans)) {
    throw new Error(
      "The agent wrote no plan, so there is nothing to apply. The deck was not touched.",
    );
  }

  let plan: EditPlan;
  try {
    plan = parsePlan(readFileSync(plans, "utf8"));
  } catch (error) {
    if (error instanceof PlanError) {
      throw new Error(`The plan was refused: ${error.message} The deck was not touched.`);
    }
    throw error;
  }

  const original = await openPackage(source);
  const { outcomes, bytes } = await applyPlanToPackage(
    await openPackage(source),
    plan,
    input.resolver,
  );

  // §7.8 — REX cannot promise the deck is valid, because many real decks are
  // not. It can prove it broke nothing that was working.
  const problems = await newProblems(original, await openPackage(bytes));
  if (problems.length > 0) {
    throw new Error(
      `The edited copy is broken in ways the original was not, so it was discarded: ${problems
        .map((problem) => problem.message)
        .join(" ")}`,
    );
  }

  // §7.8 — and the half that matters: nothing the plan did not name changed.
  const intent = await intentProblems(source, bytes, plan);

  // §7.4.5 step 5 fails silently, so it is looked for by name rather than
  // inferred from the deck opening.
  const editedPackage = await openPackage(bytes);
  const editedMap = await readDeckMap(editedPackage);
  for (const operation of plan.operations) {
    if (operation.op !== "insertVideo") continue;
    intent.push(
      ...(await videoProblems(editedPackage, editedMap.slides[operation.slide - 1] ?? "")),
    );
  }
  if (intent.length > 0) {
    throw new Error(
      `The edited copy does not match the plan, so it was discarded: ${intent
        .map((problem) => problem.message)
        .join(" ")}`,
    );
  }

  const pendingPath = pendingCopyPath(input.deckPath, contentHash, input.runKey);
  writeFileSync(pendingPath, bytes);

  const map = await readDeckMap(original);
  const editedHash = hashOf(bytes);
  const slides: DeckSlidePreview[] = [];
  for (const slide of affectedSlides(plan, map)) {
    const before = await renderSlidePage(source, contentHash, slide);
    const after = await renderSlidePage(bytes, editedHash, slide);
    slides.push({
      slide,
      before: before?.html ?? null,
      after: after?.html ?? null,
      widthPt: after?.widthPt ?? before?.widthPt ?? 720,
      heightPt: after?.heightPt ?? before?.heightPt ?? 405,
    });
  }

  return {
    preview: {
      deck: input.deckPath,
      operations: outcomes.map((outcome) => ({
        op: outcome.op,
        summary: outcome.summary,
        flags: outcome.flags,
      })),
      slides,
      problems: [],
    },
    pendingPath,
  };
}

/** §7.1 — accept: the copy replaces the deck. The original was never touched. */
export function acceptDeckApply(deckPath: string, runKey: string): boolean {
  const source = readFileSync(deckPath);
  const pending = pendingCopyPath(deckPath, hashOf(source), runKey);
  if (!existsSync(pending)) return false;
  writeFileSync(deckPath, readFileSync(pending));
  rmSync(pending, { force: true });
  return true;
}

/** §7.1 — reject: the copy is discarded and there is nothing to undo. */
export function discardDeckApply(deckPath: string, runKey: string): void {
  try {
    const source = readFileSync(deckPath);
    rmSync(pendingCopyPath(deckPath, hashOf(source), runKey), { force: true });
  } catch {
    // The deck is gone or unreadable. There is nothing left to discard.
  }
}
