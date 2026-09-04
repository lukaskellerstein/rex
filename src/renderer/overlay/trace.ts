// Spec 08 §6.5 — the trace's own view of a thread's messages.
//
// The card keeps `conversation()`, which filters to `text` and `error`; that
// filter is not a bug to fix but the rule that makes the answer outrank the
// machinery in the one column where it matters most. This is the second
// selector beside it, and it throws nothing away.
//
// `thinking`, `diff` and `completed` have been written to the database since
// spec 01 and drawn nowhere. Thinking is drawn HERE and nowhere else.
//
// Spec 38 §3 — a block is a head and rows. What a row shows shut (its preview
// and its count) and open (its fields, its diff, its output) is decided here,
// as data, so `node --test` can check it without a DOM.

import type { Message, SendMode, ThreadWithMessages } from "../../shared/types.ts";
import { agentText } from "./aside.ts";
import { type Mode, modeOf } from "./mode.ts";

export type TraceKind =
  | "you"
  | "thinking"
  | "tool"
  | "denied"
  /** The call ran and did not succeed. The gate had nothing to do with it. */
  | "failed"
  | "answer"
  /** Spec 08 §5.3 — the agent spoke, worked, and spoke again. `aside.ts`. */
  | "aside"
  | "note"
  /** A change REX drew that found no call to attach to (spec 38 §3.4). */
  | "diff"
  | "error"
  /** Spec 17 §3.2 — the reviewer ended the run here. */
  | "stopped";

/** One field of a tool's input, as the `INPUT` row prints it. */
export type TraceField = [key: string, value: string];

export interface TraceEntry {
  id: string;
  kind: TraceKind;
  /** The word in the block's corner: YOU, BASH, READ, ANSWER. */
  label: string;
  /**
   * What became of the call, beside the tool that made it — `READ · FAILED`.
   *
   * The label stays the TOOL, and that is the whole point of this field. A
   * refused or failed step used to overwrite it with its own state, so a block
   * said FAILED and never said what had failed: the mono line under it is a
   * path or a command, and neither names the tool that was given it. Reported
   * on 2026-09-02 against a run of four failed `Read` calls that read as four
   * anonymous red boxes.
   */
  status: "denied" | "failed" | null;
  /**
   * The prose — or, for a tool, the one argument worth showing, which is the
   * `INPUT` row's preview (spec 38 §3.3). For a lone diff, its path.
   */
  body: string;
  /**
   * REX's own sentence about this step, above the mono line rather than
   * folded into it. Only a refusal has one: the gate's reason is prose, it is
   * the whole safety story of the read profile in one line, and it has to be
   * readable without unfolding anything.
   */
  reason: string | null;
  /**
   * Spec 12 §7.3 — the mode the refusal happened in, set on a `denied` block
   * and nowhere else.
   *
   * `ASK MODE` beside `DENIED` is what turns a red block from "something
   * broke" into "the promise on the card head is being kept". A refusal that
   * does not say which promise produced it is just a failure.
   *
   * Taken from the thread's stored profile, which is the only honest source:
   * REX records one profile per thread and does not record a mode per message.
   */
  mode: Mode | null;
  /**
   * Spec 38 §3.2 — the mode the reviewer sent this in, from `message.mode`.
   * Null on everything that is not a reviewer's send, and on a send written
   * before the mode was recorded — which draws no pill, as on the card.
   */
  sent: SendMode | null;
  /** Spec 38 §3.5 — the model and the style, drawn in an answer's foot. */
  model: string | null;
  style: string | null;
  /**
   * Spec 43 §5.3 — and the gateway that produced it, with the URL it used.
   *
   * The sheet drew neither until 2026-09-04, so an answer here could not say
   * where it came from while the card beside it could. The reviewer's report:
   * *"In the trace view I'm missing, in the answer, information about what
   * gateway it came from."* Both feet are one component now.
   */
  gatewayName: string | null;
  baseUrl: string | null;
  /**
   * Spec 38 §3.3 — the agent's own one-line account of a call, when the input
   * carries one: `Bash` sends a `description` beside every command. It is the
   * head's text, and nothing else from the input reaches the head.
   */
  what: string | null;
  /**
   * Spec 38 §3.3 — the input, as key and value, in the order the tool gave
   * them. A field the `CHANGE` row draws is not repeated here (§3.4). Empty for
   * anything that is not a call.
   */
  fields: TraceField[];
  /**
   * Spec 38 §3.4 — the diff REX drew for this change, without its path line.
   * `-` and `+` lines, as `diffStep` and `writeStep` write them.
   */
  change: string | null;
  /** A tool's own output. Collapsed until the answer looks wrong. */
  result: string | null;
  /** When it happened — the block's right corner, on every block. */
  at: string;
}

/**
 * The argument that matters for this tool: the command for Bash, the path for
 * Read, the pattern for Grep. Falling back to the whole input is deliberate —
 * a tool REX has never seen still shows what it was given.
 */
export function argumentOf(message: Message): string {
  const input = (message.toolInput ?? {}) as Record<string, unknown>;
  for (const key of ["command", "file_path", "pattern", "path", "url", "prompt", "query"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return Object.keys(input).length > 0 ? JSON.stringify(input) : "";
}

/**
 * What a tool DOES — spec 08 §5.4's rule, with spec 36 §3.1's pencil.
 * `Bash`/`Read`/`Edit` is a vocabulary the reviewer never chose to learn; a
 * read, a change and a command are three acts anyone can tell apart.
 *
 * Here rather than in `toolRows.ts`, which re-exports it, because the trace
 * needs it to pair a diff with its change (§3.4) and `toolRows.ts` already
 * imports from this file — the other way round would be a cycle.
 */
export type ToolGlyph = "read" | "change" | "command" | "diff" | "failed" | "denied";

/**
 * The glyph for a call. State first: a call that failed or was refused is
 * drawn as that, whatever tool it was, because the state is the thing worth
 * seeing at a glance — the same rule the step bars apply (spec 08 §5.4).
 */
export function glyphOf(name: string, denied: boolean, failed: boolean): ToolGlyph {
  if (denied) return "denied";
  if (failed) return "failed";
  const upper = name.toUpperCase();
  if (/READ|GLOB|GREP|SEARCH|FETCH/.test(upper)) return "read";
  if (/EDIT|WRITE/.test(upper)) return "change";
  return "command";
}

/**
 * How much a folded section is hiding. Counted, never summarised.
 *
 * Lines, until there is only one — and then characters, because `1 line` is
 * what a 400-character Bash command and a ten-character path both say, and the
 * count exists to tell the reviewer whether opening it is worth the height.
 */
export function foldSize(text: string): string {
  const lines = text.split("\n").length;
  return lines > 1 ? `${lines} lines` : `${text.length} chars`;
}

/**
 * How much of a row is shown before it is opened.
 *
 * 96 characters is about a full-width line of the sheet's 11.5px mono at the
 * widths the splitter allows. Past it the line is cut with an ellipsis rather
 * than scrolled sideways: a horizontal scrollbar per block is thirty of them
 * down a run, and none of them can be read without dragging.
 */
export const PREVIEW_MAX = 96;

/**
 * Spec 38 §3.3 — a row's preview: its first line with words in it, cut.
 *
 * The first NON-EMPTY line, because a tool's output often opens with a blank
 * one, and a preview that is a blank line says the row holds nothing.
 */
export function previewOf(text: string): string {
  const first = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  return first.length > PREVIEW_MAX ? `${first.slice(0, PREVIEW_MAX - 1)}…` : first;
}

/**
 * Spec 38 §3.3 — the input as the `INPUT` row lists it. A string is printed
 * as it is; anything else is printed as JSON, so `false` and `495` and a list
 * of paths all read as what they are. The order is the tool's own.
 */
export function fieldsOf(input: unknown, hide: ReadonlySet<string> = NO_FIELDS): TraceField[] {
  if (input === null || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([key]) => !hide.has(key))
    .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]);
}

const NO_FIELDS: ReadonlySet<string> = new Set();

/**
 * Spec 38 §3.4 — the fields the `CHANGE` row draws. Listed again as raw text
 * they would say one change twice, once unreadably. Hidden only once a change
 * has actually attached: a refused `Edit` whose diff never came keeps them,
 * because then `INPUT` is the only place the refused change can be read.
 */
export const CHANGE_FIELDS: ReadonlySet<string> = new Set(["old_string", "new_string", "content"]);

/** Spec 38 §3.3 — the `CHANGE` row's preview: how many lines went and came. */
export function changeCounts(change: string): { removed: number; added: number } {
  let removed = 0;
  let added = 0;
  for (const line of change.split("\n")) {
    if (line.startsWith("- ")) removed += 1;
    else if (line.startsWith("+ ")) added += 1;
  }
  return { removed, added };
}

/**
 * The blocks that are a call, and so are drawn as a head and folded rows.
 *
 * `TraceSheet` reads this to decide whether to draw rows at all, and `textOf`
 * reads it to decide which of the two copy rules a block follows. It is not
 * `CALL_KINDS` below: that one is about pairing a diff with the change it
 * describes, and a lone `diff` block has no call to pair with.
 */
export const HAS_ROWS: ReadonlySet<TraceKind> = new Set(["tool", "denied", "failed", "diff"]);

/**
 * Spec 41 §3 — what this block puts on the clipboard.
 *
 * Here rather than in `TraceSheet` because it is the same split spec 38 §3
 * made for what a row shows: the sheet draws, this file decides, and
 * `node --test` can check the decision without a DOM.
 */
export function textOf(entry: TraceEntry): string {
  // §3.1 — a spoken block is its words and nothing else: no label, no clock,
  // no mode pill, no place list. A question pasted into an issue should read
  // as the question.
  if (!HAS_ROWS.has(entry.kind)) return entry.body;

  // §3.2 — a call's parts are folded separately and are meaningless run
  // together: a command with its output stuck to it, and no word saying which
  // is which. So each part is copied under the word the row draws.
  const head = entry.status ? `${entry.label} · ${entry.status.toUpperCase()}` : entry.label;
  // The agent's own account of the call — and, for a lone diff, the path,
  // which is the only line that says what the change is to. Both answer the
  // same question, so both sit in the same place.
  const about = entry.what ?? (entry.kind === "diff" ? entry.body : null);
  const sections = [about ? `${head}\n${about}` : head];
  // The gate's sentence, above the rows as the sheet draws it. It is the whole
  // block on a refusal, so it is never folded into `INPUT`.
  if (entry.reason) sections.push(entry.reason);
  // `body` is deliberately not copied for a tool: it is the one argument the
  // INPUT row previews, and INPUT lists it in full a few lines down.
  if (entry.fields.length > 0) {
    sections.push(`INPUT\n${entry.fields.map(([key, value]) => `${key}: ${value}`).join("\n")}`);
  }
  if (entry.change) sections.push(`CHANGE\n${entry.change}`);
  if (entry.result) sections.push(`OUTPUT\n${entry.result}`);
  return sections.join("\n\n");
}

/** The four voices a `text` row can carry. */
type TextKind = Extract<TraceKind, "you" | "note" | "aside" | "answer">;

/** The word in the corner of a `text` block, per voice. */
const TEXT_LABEL: Record<TextKind, string> = {
  you: "YOU",
  note: "NOTE",
  aside: "ASIDE",
  answer: "ANSWER",
};

function entry(message: Message, kind: TraceKind, label: string, body: string): TraceEntry {
  return {
    id: message.id,
    kind,
    label,
    status: null,
    body,
    reason: null,
    mode: null,
    sent: message.mode,
    model: message.model,
    style: message.style,
    gatewayName: message.gatewayName,
    baseUrl: message.baseUrl,
    what: null,
    fields: [],
    change: null,
    result: null,
    at: message.createdAt,
  };
}

/** The blocks a call can be: the tool as it ran, or as it ended. */
const CALL_KINDS: ReadonlySet<TraceKind> = new Set(["tool", "denied", "failed"]);

/**
 * Every message, in `seq` order, as blocks.
 *
 * A tool RESULT is never a block of its own — it belongs to the call above it,
 * the same rule the card's step strip follows. Two rows for one call is how the
 * strip came to draw one more bar than there were calls.
 *
 * Spec 38 §3.4 — a DIFF is not one either, when it can be paired: `runner.ts`
 * writes it right after the `Edit` or `Write` it describes, so it attaches to
 * the most recent change that has none yet and becomes that block's `CHANGE`
 * row. One that cannot be paired stays a block, as it always was.
 */
export function traceOf(thread: ThreadWithMessages): TraceEntry[] {
  const entries: TraceEntry[] = [];
  const messages = [...thread.messages].sort((a, b) => a.seq - b.seq);
  // The same rule the card runs, from the same function — the sheet is the
  // card's audit, so a block the card calls an aside cannot be an ANSWER here.
  const { asides } = agentText(messages);

  for (const message of messages) {
    switch (message.kind) {
      case "text": {
        if (!message.content) break;
        const kind: TextKind =
          message.role === "user"
            ? "you"
            : message.role === "system"
              ? "note"
              : asides.has(message.id)
                ? "aside"
                : "answer";
        entries.push(entry(message, kind, TEXT_LABEL[kind], message.content));
        break;
      }

      case "thinking":
        if (message.content) entries.push(entry(message, "thinking", "THINKING", message.content));
        break;

      case "tool_call": {
        const call = entry(
          message,
          "tool",
          (message.toolName ?? "tool").toUpperCase(),
          argumentOf(message),
        );
        const input = (message.toolInput ?? {}) as Record<string, unknown>;
        call.what = typeof input.description === "string" ? input.description : null;
        call.fields = fieldsOf(message.toolInput);
        entries.push(call);
        break;
      }

      case "tool_result": {
        // The call it answers is the most recent one still waiting. Matching on
        // `toolName` would be wrong: a result does not always carry one.
        const call = entries.findLast(
          (candidate) => candidate.kind === "tool" && candidate.result === null,
        );
        if (!call) break;
        if (message.denied) {
          call.kind = "denied";
          call.status = "denied";
          call.mode = modeOf(thread.profile);
          // The gate's own words, promoted out of the collapsed result: a
          // refusal nobody unfolds is a refusal nobody reads, and the block
          // opens itself for the same reason.
          call.reason = message.content;
        } else if (message.isError) {
          // A tool that ran and failed. Its output stays where a tool's output
          // belongs — but opened, because it is the only place the reason is
          // written and REX has nothing of its own to say about somebody else's
          // error. `(eval):1: == not found` explains the step; a sentence REX
          // invented over the top of it would not.
          call.kind = "failed";
          call.status = "failed";
          call.result = message.content;
        } else {
          call.result = message.content;
        }
        break;
      }

      case "diff": {
        if (!message.content) break;
        const [path, ...rest] = message.content.split("\n");
        const change = rest.join("\n");
        const call = entries.findLast(
          (candidate) =>
            CALL_KINDS.has(candidate.kind) &&
            candidate.change === null &&
            glyphOf(candidate.label, false, false) === "change",
        );
        if (call && change) {
          call.change = change;
          call.fields = call.fields.filter(([key]) => !CHANGE_FIELDS.has(key));
          break;
        }
        const lone = entry(message, "diff", "DIFF", path);
        lone.change = change || null;
        entries.push(lone);
        break;
      }

      case "error":
        if (message.content) entries.push(entry(message, "error", "ERROR", message.content));
        break;

      // Spec 17 §3.2 — in `seq` order, so the sheet shows exactly where the
      // run was when it ended. A trace that stops after a tool call with no
      // block saying why reads as a crash.
      case "stopped":
        if (message.content) entries.push(entry(message, "stopped", "STOPPED", message.content));
        break;

      // A lifecycle marker carrying a word, not a step. Its totals are already
      // in the sheet's head and in the card's meta strip.
      case "completed":
        break;

      // Spec 34 §6 — the reviewer's approve, discard or undo. The card draws it
      // as a notice; the sheet is the agent's machinery, and this is not that.
      case "event":
        break;
    }
  }
  return entries;
}
