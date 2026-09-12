// Spec 51 §5.3 — one message, read out of whichever API shape it arrived in.
//
// Its own module, and not a helper inside the screen, for the reason `trace.ts`
// is one: `node --test` can check every shape with no DOM. **That is not a
// nicety here.** A Codex turn drew a column of `?` for a whole round because
// the Responses API's items have no `role` at all, and nothing could have
// caught it — the screen was the only thing that knew, and the screen needs a
// browser. `test/wire.spec.ts` is what knows now.
//
// Spec 46 §4.5 gives one `model_name` three doors, and all three describe the
// same conversation differently:
//
// | | Anthropic `/v1/messages` | OpenAI `/v1/chat/completions` | OpenAI `/v1/responses` |
// |:--|:--|:--|:--|
// | a tool CALL | a `tool_use` block | an entry in `tool_calls` | a `function_call` ITEM |
// | its ARGUMENTS | `input`, an object | `function.arguments`, a string | `arguments`, a string |
// | its RESULT | a `tool_result` block in a **user** message | a **tool** message | a `function_call_output` item |
// | thinking | a `thinking` block | `reasoning_content` | `summary[].text` |
// | the ROLE | on the message | on the message | **absent — there is a `type`** |
//
// All three are read into the same four words, so a Claude turn and a Codex
// turn read alike. **Nothing here changes the record**: depth 4 shows the raw
// JSON, and the screen says which door it came through.
//
// One more row than there are messages, since 2026-09-11: the SYSTEM PROMPT.
// Two of the three doors keep it in a field of its own rather than in the
// conversation, so a turn's `messages` array does not contain it and both
// depths showed a turn whose instructions were invisible. `wireEntries` below
// puts it first and `jsonTree.ts`'s `systemPromptOf` is what finds it.

import { messagesOf, roleOf, systemPromptOf } from "./jsonTree.ts";

/** What one recorded message is, flattened out of whatever shape it arrived in. */
export interface WireMessage {
  /** What to CALL it: `user`, `system`, `tool`, or the tool it called. */
  role: string;
  /** Which of REX's role colours it wears. `prompt` is the system prompt's. */
  kind: "user" | "assistant" | "tool" | "system" | "other" | "prompt";
  /** The tools it calls or answers, when it does. */
  tools: string[];
  text: string;
  image: boolean;
  size: string;
  thinking: boolean;
}

function sizeOf(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (!text) return "—";
    return text.length > 1024 ? `${(text.length / 1024).toFixed(1)} KB` : `${text.length} B`;
  } catch {
    return "—";
  }
}

/**
 * One message, as this screen says it — from EITHER API shape.
 *
 * Spec 46 §4.5 gives one model three doors, and the two that matter here
 * describe the same conversation differently:
 *
 * | | Anthropic (`/v1/messages`) | OpenAI (`/v1/chat/completions`) |
 * |:--|:--|:--|
 * | a tool CALL | a `tool_use` block in `content` | an entry in `tool_calls` |
 * | its ARGUMENTS | `input`, an object | `function.arguments`, a JSON string |
 * | its RESULT | a `tool_result` block in a **user** message | a **tool** message |
 * | thinking | a `thinking` block | `reasoning_content`, a field |
 *
 * Both are read here into one shape, so a Claude turn and a Codex turn read the
 * same way down this list. **Nothing below changes the record** — depth 4 shows
 * the raw JSON and the head says which door it came through, so a reader always
 * knows which of the two they are looking at.
 */
export function readWire(raw: unknown): WireMessage {
  const size = sizeOf(raw);
  const wire = roleOf(raw);
  const plain = (kind: WireMessage["kind"], text: string): WireMessage => ({
    role: wire,
    kind,
    tools: [],
    text,
    image: false,
    size,
    thinking: false,
  });

  if (raw === null || typeof raw !== "object") return plain("other", String(raw));
  const message = raw as Record<string, unknown>;

  /*
    OpenAI's RESPONSES API — a third shape, and the one Codex uses.

    Its items have no `role` at all. They have a `type`, and until this was
    handled every Codex turn drew a column of `?` — reported 2026-09-09, against
    a real turn of 55 items. Measured from that turn's own body:

      {type: "message",              role, content}
      {type: "reasoning",            summary: [{type: "summary_text", text}]}
      {type: "function_call",        name, arguments, call_id}
      {type: "function_call_output", call_id, output}

    Read into the same four words the other two shapes use, so a Codex turn and
    a Claude turn read alike — which is the whole point of this function.
  */
  const type = typeof message.type === "string" ? message.type : "";
  if (type === "reasoning") {
    // Named `thinking`, because on this API it is an ITEM of its own — where
    // Anthropic's thinking rides inside the assistant message that also calls
    // the tool, and takes that tool's name. With no name it drew a row with a
    // number, a size and nothing that said what it was.
    return {
      role: "thinking",
      kind: "assistant",
      tools: [],
      text: summaryIn(message.summary),
      image: false,
      size,
      thinking: true,
    };
  }
  if (type === "function_call") {
    const name = typeof message.name === "string" ? message.name : "tool";
    const args = typeof message.arguments === "string" ? message.arguments : "";
    return {
      role: "",
      kind: "assistant",
      tools: [name],
      text: args,
      image: false,
      size,
      thinking: false,
    };
  }
  if (type === "function_call_output") {
    const output = message.output;
    return {
      role: "tool",
      kind: "tool",
      tools: [],
      text: typeof output === "string" ? output : JSON.stringify(output ?? ""),
      image: false,
      size,
      thinking: false,
    };
  }

  // OpenAI — the result of a call arrives with a role of its own, already.
  if (wire === "tool") {
    return {
      role: "tool",
      kind: "tool",
      tools: [],
      text: textIn(message.content),
      image: false,
      size,
      thinking: false,
    };
  }

  // OpenAI — the CALL is a field beside the content, not a block inside it.
  const calls = openAiCalls(message.tool_calls);
  if (calls.length > 0) {
    // The reasoning first, because that is what the Anthropic side of this
    // shows for the same message: a `thinking` block sits beside the `tool_use`
    // in one array, so an OpenAI row that led with its arguments while the
    // Anthropic row led with its reasoning would put the two out of step down
    // the one thing this screen exists to compare.
    const reasoning = message.reasoning_content;
    const thought = typeof reasoning === "string" ? reasoning : "";
    return {
      role: "",
      kind: "assistant",
      tools: calls.map((one) => one.name),
      text: thought || textIn(message.content) || calls[0]?.arguments || "",
      image: false,
      size,
      thinking: thought !== "",
    };
  }

  const content = message.content;
  if (typeof content !== "object" || content === null) {
    // OpenAI keeps its thinking in a field of its own rather than a block.
    const reasoning = message.reasoning_content;
    if (typeof reasoning === "string" && reasoning && !content) {
      return {
        role: wire,
        kind: kindOf(wire),
        tools: [],
        text: reasoning,
        image: false,
        size,
        thinking: true,
      };
    }
    return plain(kindOf(wire), typeof content === "string" ? content : "");
  }
  if (!Array.isArray(content)) return plain("other", "");

  // Anthropic's blocks, and OpenAI's list-of-parts content, share this walk.
  const named: string[] = [];
  let results = 0;
  let text = "";
  let image = false;
  let thinking = false;
  let prose = false;

  for (const item of content) {
    if (item === null || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";
    if (type === "tool_use" && typeof block.name === "string") named.push(block.name);
    if (type === "tool_result") results += 1;
    if (type === "image" || type === "image_url") image = true;

    if (!text) {
      if (typeof block.text === "string") {
        text = block.text;
        prose = true;
      } else if (typeof block.thinking === "string") {
        text = block.thinking;
        thinking = true;
      } else if (typeof block.content === "string") {
        text = block.content;
      } else if (block.input !== null && typeof block.input === "object") {
        // A tool call carries no prose of its own, and its input is the only
        // thing that says what it asked for.
        text = JSON.stringify(block.input);
      }
    }
  }

  // Anthropic has no `tool` role: a result is a `tool_result` block inside a
  // USER message. That is the field, and `user` is not what a reader needs.
  if (wire === "user" && results > 0 && !prose) {
    return { role: "tool", kind: "tool", tools: [], text, image, size, thinking };
  }
  // An assistant turn that only calls tools is named by the tools it called —
  // "assistant" beside `Bash` says nothing the `Bash` did not.
  if (wire === "assistant" && named.length > 0) {
    return { role: "", kind: "assistant", tools: named, text, image, size, thinking };
  }
  return { role: wire, kind: kindOf(wire), tools: [], text, image, size, thinking };
}

/**
 * One row of a turn: the request's system prompt, or one of its messages.
 *
 * **Both depths build their list from this one function**, and that is the
 * whole reason it exists. Depth 3 draws the rows and depth 4 pages through the
 * same things by index — two lists built separately would agree until one of
 * them gained a row, and then every `Open` on depth 3 would land one message
 * off on depth 4. Nothing would fail; the reader would simply be shown the
 * wrong message, which is the failure this screen can least afford.
 */
export interface WireEntry {
  /** The raw JSON it was read from. Depth 4 shows exactly this and nothing else. */
  value: unknown;
  /** What depth 3 draws on the row. */
  seen: WireMessage;
  /** Its place in the request's `messages`, or null for the system prompt. */
  at: number | null;
}

/** The system prompt first, when the request carried one, then every message. */
export function wireEntries(request: unknown): WireEntry[] {
  const entries: WireEntry[] = [];
  const prompt = systemPromptOf(request);
  // First, because it is what the model reads first. On the Anthropic door the
  // request's own `messages` array does NOT start with it — LiteLLM inserts it
  // at index 0 of the list it calls the model with, and that list is not the
  // one recorded under `messages`.
  if (prompt !== undefined) entries.push({ value: prompt, seen: readPrompt(prompt), at: null });
  messagesOf(request).forEach((message, at) => {
    entries.push({ value: message, seen: readWire(message), at });
  });
  return entries;
}

/**
 * The system prompt as one row.
 *
 * Not `readWire`: a prompt is not a message and has no role of its own. It is
 * named `system prompt` in full, because `system` is already the word on the
 * in-sequence system messages beside it and the two are different things.
 */
export function readPrompt(value: unknown): WireMessage {
  return {
    role: "system prompt",
    kind: "prompt",
    tools: [],
    text: promptText(value),
    image: false,
    size: sizeOf(value),
    thinking: false,
  };
}

/**
 * The words of a system prompt, whichever door it came through.
 *
 * Anthropic's is a list of text blocks and OpenAI's is one string. The blocks
 * are joined rather than reduced to the first, because the first is often not
 * the prose: Claude Code's block 0 is a billing header of 73 characters, and a
 * preview of that says nothing about the prompt underneath it.
 */
function promptText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") parts.push(item);
    else if (item !== null && typeof item === "object") {
      const text = (item as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n\n");
}

/** Which of the role colours a wire role wears. */
function kindOf(role: string): WireMessage["kind"] {
  if (role === "system" || role === "developer") return "system";
  if (role === "user") return "user";
  if (role === "tool") return "tool";
  if (role === "assistant") return "assistant";
  return "other";
}

/**
 * OpenAI's `tool_calls`.
 *
 * Its arguments are a JSON **string**, where Anthropic's `input` is an object —
 * so the two cannot share a reader, and this is the one that knows about the
 * string.
 */
function openAiCalls(value: unknown): Array<{ name: string; arguments: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name: string; arguments: string }> = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const call = (item as { function?: unknown }).function;
    if (call === null || typeof call !== "object") continue;
    const fn = call as { name?: unknown; arguments?: unknown };
    if (typeof fn.name === "string") {
      out.push({ name: fn.name, arguments: typeof fn.arguments === "string" ? fn.arguments : "" });
    }
  }
  return out;
}

/**
 * The Responses API's reasoning, which is a `summary` of `summary_text` parts.
 *
 * A third place the same idea lives: Anthropic has a `thinking` block, OpenAI
 * chat has `reasoning_content`, and this has a list. All three read out to the
 * same italic line.
 */
function summaryIn(value: unknown): string {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    if (item !== null && typeof item === "object") {
      const text = (item as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return "";
}

/** The words out of a `content` that may be a string or a list of parts. */
function textIn(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const item of content) {
    if (item !== null && typeof item === "object") {
      const text = (item as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return "";
}
