// Spec 19 §4.2 — ACT on a Word file, end to end.
//
//   comment + ACT → write agent reads the sidecar of the WORKING COPY
//                 → agent writes plan.json into REX's cache
//                 → REX validates the plan          (refused? nothing written)
//                 → REX performs it on the working copy's bytes
//                 → REX re-opens the result and compares it to the intent
//                 → the caller saves a revision, and the two panes show it
//
// It differs from the deck's flow (spec 11 §7.1) in one deliberate way: this
// returns **bytes**, and the caller puts them in the working copy spec 15 §3
// already forks for every run. A deck holds its own pending copy because a deck
// cannot be shown as text; a Word document can, so it needs no second store, and
// it gets iteration (spec 15 §5), approve, undo and discard for free.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResolvedRoute } from "../../shared/agent-protocol.ts";
import { runAgent } from "../agent/bridge.ts";
import { sessionIdFor } from "../agent/profiles.ts";
import { DOCX_WRITE_SYSTEM_PROMPT, writeInstructions } from "../agent/prompts.ts";
import type { MessageDraft } from "../db/queries.ts";
import { openPackage } from "../ooxml/package.ts";
import type { MediaResolver } from "../pptx/media.ts";
import { applyPlanToPackage, EditError, type Outcome } from "./edit.ts";
import { type EditPlan, PlanError, parsePlan } from "./plan.ts";
import { contentHashOf, docxCacheDir, ensureSidecar } from "./text.ts";
import { checkEdit } from "./validate.ts";

/** Where the agent is told to write its plan. Outside every repository (§4.4). */
function planPath(contentHash: string, runKey: string): string {
  return join(docxCacheDir(contentHash), `plan-${runKey}.json`);
}

export interface DocxApplyInput {
  /** Names this document's slot in the run, and is used to build file names. */
  runKey: string;
  /** The reviewer's own file. Its identity, and what the plan must name. */
  documentPath: string;
  /** The working copy REX reads and edits. Spec 15 §3. */
  workingPath: string;
  /** Spec 12 §4.2 — what the reviewer typed in ACT mode. The order itself. */
  instruction: string;
  transcript: string;
  passages: string[];
  model: string | null;
  /** Spec 31 §2.3 — the output style the plan is written in. */
  style: string | null;
  /**
   * Spec 43 §11 — where this plan run's inference is served from.
   *
   * Absent means `Original`. §10.1 — the deterministic editor below is REX's
   * own code and does not change with the gateway; only the PLAN is a model's
   * work, and this is what decides which model writes it.
   */
  route?: ResolvedRoute;
  /** §5.4 — the renderer's diagram drawer, passed down from the IPC layer. */
  resolver: MediaResolver;
  /** Spec 17 §2.6 — the reviewer's Stop, handed on to the agent. */
  signal?: AbortSignal;
  onMessage: (draft: MessageDraft) => void;
}

export interface DocxApplyResult {
  outcomes: Outcome[];
  /** The edited working copy. Nothing is on disk yet. */
  bytes: Buffer;
}

function buildPrompt(input: {
  documentPath: string;
  sidecarPath: string;
  planPath: string;
  passages: string[];
  instruction: string;
  transcript: string;
}): string {
  return [
    `Document: ${input.documentPath}`,
    `Its text, to read: ${input.sidecarPath}`,
    `Write your plan to: ${input.planPath}`,
    "",
    ...input.passages,
    // The same tail the prose path uses, so a Word file and a Markdown file are
    // told what to do the same way.
    ...writeInstructions(input.transcript, input.instruction),
  ].join("\n");
}

/**
 * §4.2 — run the write agent, then do everything it proposed, on the copy.
 *
 * Every refusal throws, and a throw means nothing was written: the working copy
 * still holds what it held before, so there is no revision to undo and nothing
 * partial for the reviewer to reason about (§4.4 rule 4).
 *
 * Spec 17 §2.6 — `null` is the reviewer stopping it. A stopped run is the clean
 * case here for the same reason it is on a deck: the agent writes a plan and REX
 * performs it afterwards, so a run stopped before the plan is finished has
 * touched nothing.
 */
export async function runDocxApply(input: DocxApplyInput): Promise<DocxApplyResult | null> {
  const source = readFileSync(input.workingPath);
  const contentHash = contentHashOf(source);

  // Built from the **working copy**, so a second ACT run reads what the first
  // one left rather than the reviewer's original (spec 15 §5).
  const sidecarPath = await ensureSidecar(input.documentPath, source);
  if (!sidecarPath) {
    throw new Error(
      `REX could not read ${input.documentPath} as a Word document, so it will not offer to edit it.`,
    );
  }

  const plans = planPath(contentHash, input.runKey);
  // A stale plan from an interrupted run would be read as this run's answer.
  rmSync(plans, { force: true });

  const result = await runAgent({
    cwd: dirname(input.documentPath),
    profile: "write",
    systemPrompt: DOCX_WRITE_SYSTEM_PROMPT,
    prompt: buildPrompt({
      documentPath: input.documentPath,
      sidecarPath,
      planPath: plans,
      passages: input.passages,
      instruction: input.instruction,
      transcript: input.transcript,
    }),
    sessionId: sessionIdFor(input.runKey),
    resume: false,
    // Spec 43 §5.5 — a run-scoped id, and its session is never stored.
    route: input.route,
    // Spec 44 §9.3 — a Word run writes exactly one thing: its plan, in REX's
    // own cache. The document itself is edited by REX afterwards from that
    // plan, so the agent needs no write access to it at all — which makes this
    // the tightest boundary of the three write callers.
    writable: [docxCacheDir(contentHash)],
    model: input.model,
    style: input.style,
    documentPath: input.documentPath,
    signal: input.signal,
    onMessage: input.onMessage,
  });

  if (result.stopped) return null;
  if (result.error) throw new Error(result.error);

  if (!existsSync(plans)) {
    throw new Error(
      "The agent wrote no plan, so there is nothing to apply. The document was not touched.",
    );
  }

  let plan: EditPlan;
  try {
    plan = parsePlan(readFileSync(plans, "utf8"));
  } catch (error) {
    if (error instanceof PlanError) {
      throw new Error(`The plan was refused: ${error.message} The document was not touched.`);
    }
    throw error;
  }

  let edited: DocxApplyResult;
  try {
    const performed = await applyPlanToPackage(await openPackage(source), plan, input.resolver);
    edited = { outcomes: performed.outcomes, bytes: performed.bytes };
  } catch (error) {
    if (error instanceof EditError) {
      throw new Error(`${error.message} The document was not touched.`);
    }
    throw error;
  }

  // §5.6 — both halves. REX cannot promise the document is valid, because
  // plenty of real ones are not; it can prove it broke nothing that worked and
  // changed nothing it did not name.
  const problems = await checkEdit(
    await openPackage(source),
    await openPackage(edited.bytes),
    plan,
  );
  if (problems.length > 0) {
    throw new Error(
      `The edited copy does not match the plan, so it was discarded: ${problems
        .map((problem) => problem.message)
        .join(" ")}`,
    );
  }

  return edited;
}
