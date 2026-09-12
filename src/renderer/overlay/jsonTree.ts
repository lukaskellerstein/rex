// Spec 51 §5.4 — one message's JSON, as a fold tree.
//
// Data and not a component, for the reason `trace.ts` is: `node --test` can
// check that every node folds and that a folded node keeps its summary, with no
// DOM in the way. That is criterion A9, and it is a claim about this file.
//
// **The scope is what makes the density work**, not the type size. This tree is
// ONE message, so it is twenty lines and not two thousand. The first design put
// a whole exchange here and the reviewer's note was that it was a wall — the fix
// was not a smaller font, it was a smaller subject.
//
// A summary rides every foldable line — `3 keys`, `2 blocks`, `640 chars` — and
// stays there when the line is shut. A fold that hides a thing without saying
// how much it hid is a fold nobody dares open or leave.

/** What kind of value a line carries, which is the only thing colour means here. */
export type JsonKind = "string" | "number" | "atom" | "punct";

export interface JsonLine {
  /**
   * Where this line is in the tree, as a path. `root.content.0.input.file_path`.
   *
   * The fold state is a set of these, so folding survives a redraw and two
   * different keys spelled the same at different depths cannot collide.
   */
  path: string;
  /** Every ancestor's path, so hiding a folded node's descendants is one test. */
  ancestors: string[];
  depth: number;
  /** The key, quoted, or empty for an array element and for a closing brace. */
  key: string;
  /** What is drawn after the key. An opener for a node, a value for a leaf. */
  value: string;
  kind: JsonKind;
  /** True when this line opens an object or an array, and so can be folded. */
  node: boolean;
  /** What the line shows instead of its children when it is shut. */
  shut: string;
  /**
   * The summary, kept whether the line is open or shut.
   *
   * It is the answer to "is it worth opening": `3 keys`, `2 blocks`, and for a
   * long string the length, because a string cut at forty characters says
   * nothing about whether it is a sentence or a page.
   */
  tail: string;
  /**
   * The WHOLE string, when the line only had room for the start of it.
   *
   * Null on every other line. Reported 2026-09-09: *"when there is a text field
   * I am not able to see all the text which is inside the text property. You
   * are showing just part of it and then 1,229 chars more but I need to see the
   * whole text."* A count of what is hidden is not a way to read it — this is.
   */
  full: string | null;
  /**
   * The same value as valid JSON, for when the line is opened.
   *
   * `full` is the raw text — what a copy button should put on the clipboard.
   * This is that text QUOTED and comma'd, so an opened line still reads as
   * JSON in place. Reported 2026-09-09: the first version drew the raw text in
   * a panel below the line, which is a widget where a reader asked for a value.
   */
  whole: string;
}

/**
 * Spec 51 §3.1 rule 4 — what a base64 payload became on its way to the log.
 *
 * Mirrors `BLOB_PREFIX` in `rex_trace.py` and in `gateway/traffic.ts`. Drawn as
 * what it is rather than as a forty-character stub of a reference: an image is
 * the one value here that a reader will never want to read.
 */
export const BLOB_PREFIX = "rex-blob:";

/** How much of a string is drawn before it is cut. A line is one line. */
const STRING_MAX = 48;

function quote(text: string): string {
  return JSON.stringify(text);
}

function preview(text: string): string {
  if (text.startsWith(BLOB_PREFIX)) return `"an image, stored beside the log"`;
  if (text.length <= STRING_MAX) return quote(text);
  return `${quote(text.slice(0, STRING_MAX - 1)).slice(0, -1)}…"`;
}

function tailOf(text: string): string {
  if (text.startsWith(BLOB_PREFIX)) return text.slice(BLOB_PREFIX.length);
  return text.length > STRING_MAX ? `${text.length} chars` : "";
}

/**
 * What a folded block is, said in its own words rather than as `3 keys`.
 *
 * An SDK's content block carries a `type`, and that word is the whole reason
 * somebody is scrolling: `thinking`, `tool_use`, `text`. A tool call adds its
 * name. Anything with no `type` falls back to counting, which is honest and
 * never wrong.
 */
function labelOf(value: Record<string, unknown>): string | null {
  const type = value.type;
  if (typeof type !== "string") return null;
  const name = value.name;
  return typeof name === "string" ? `${type} · ${name}` : type;
}

function countLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  return `${keys.length} key${keys.length === 1 ? "" : "s"}`;
}

/**
 * Every line of one value, flat, with the tree recorded as paths.
 *
 * Flat because that is what a gutter and a virtualised list want, and because
 * folding is then a filter rather than a walk. `ancestors` carries the tree.
 */
export function jsonLines(value: unknown): JsonLine[] {
  const lines: JsonLine[] = [];

  const walk = (
    key: string,
    item: unknown,
    depth: number,
    path: string,
    ancestors: string[],
    comma: boolean,
  ): void => {
    const tail = comma ? "," : "";

    if (item !== null && typeof item === "object") {
      const array = Array.isArray(item);
      const entries: Array<[string, unknown]> = array
        ? (item as unknown[]).map((child, index) => [String(index), child])
        : Object.entries(item as Record<string, unknown>);
      const open = array ? "[" : "{";
      const close = array ? "]" : "}";
      const label = array ? null : labelOf(item as Record<string, unknown>);

      lines.push({
        path,
        ancestors,
        depth,
        key,
        value: open,
        kind: "punct",
        node: true,
        shut: `${open} … ${close}${tail}`,
        tail: label ?? countLabel(item),
        full: null,
        whole: open,
      });

      const inner = [...ancestors, path];
      entries.forEach(([childKey, child], index) => {
        walk(
          array ? "" : quote(childKey),
          child,
          depth + 1,
          `${path}.${childKey}`,
          inner,
          index < entries.length - 1,
        );
      });

      // The closing brace is a child of the node, so folding the node hides it
      // — which is what makes `{ … }` sit on one line instead of two.
      lines.push({
        path: `${path}/close`,
        ancestors: inner,
        depth,
        key: "",
        value: `${close}${tail}`,
        kind: "punct",
        node: false,
        shut: "",
        tail: "",
        full: null,
        whole: `${close}${tail}`,
      });
      return;
    }

    const text =
      typeof item === "string"
        ? preview(item)
        : item === null
          ? "null"
          : typeof item === "number" || typeof item === "boolean"
            ? String(item)
            : String(item);

    lines.push({
      path,
      ancestors,
      depth,
      key,
      value: `${text}${tail}`,
      kind:
        typeof item === "string"
          ? "string"
          : typeof item === "number"
            ? "number"
            : item === null || typeof item === "boolean"
              ? "atom"
              : "punct",
      node: false,
      shut: "",
      tail: typeof item === "string" ? tailOf(item) : "",
      // Only when there is more of it than the line shows. A short string is
      // already whole, and offering to "expand" it would be a control that
      // does nothing.
      full:
        typeof item === "string" && item.length > STRING_MAX && !item.startsWith(BLOB_PREFIX)
          ? item
          : null,
      // Quoted and comma'd, so the opened line is still JSON where it sits.
      whole: typeof item === "string" ? `${quote(item)}${tail}` : `${text}${tail}`,
    });
  };

  walk("", value, 0, "root", [], false);
  return lines;
}

/**
 * The lines that are actually drawn, given which paths are shut.
 *
 * A line is hidden when any ancestor is shut. The shut node itself stays — with
 * its `shut` text and, crucially, its summary — which is criterion A9's second
 * half: **a folded node still says how much it is hiding.**
 */
export function visibleLines(lines: readonly JsonLine[], shut: ReadonlySet<string>): JsonLine[] {
  if (shut.size === 0) return [...lines];
  return lines.filter((line) => !line.ancestors.some((ancestor) => shut.has(ancestor)));
}

/** Every path that can be folded — what `Collapse all` sets. */
export function foldablePaths(lines: readonly JsonLine[]): string[] {
  return lines.filter((line) => line.node).map((line) => line.path);
}

/**
 * The value one of `jsonLines`' paths points at.
 *
 * What the pane beside the tree needs: the tree draws a path, the reader picks
 * one, and the pane has to turn that string back into the thing it came from.
 * Here rather than in the component for this file's own reason — a path is a
 * decision about the tree, and `node --test` can check every shape of it.
 *
 * `undefined` when the path names nothing, which is not an error: a message can
 * be paged away from under a selection made on the one before it.
 */
export function valueAt(root: unknown, path: string): unknown {
  // A closing brace belongs to the node it closes, so it resolves to that node
  // rather than to nothing.
  const clean = path.endsWith("/close") ? path.slice(0, -"/close".length) : path;
  if (clean === "root") return root;
  if (!clean.startsWith("root.")) return undefined;

  let at: unknown = root;
  for (const step of clean.slice("root.".length).split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = Array.isArray(at)
      ? (at as unknown[])[Number(step)]
      : (at as Record<string, unknown>)[step];
  }
  return at;
}

/**
 * A path as a person would write it — `content[0].text`.
 *
 * The stored form is `root.content.0.text`, which is a key and reads like one.
 * An index in brackets is how the same address is spoken, and the pane's head
 * is the one place it is read rather than compared.
 *
 * Empty for the root, because "the whole message" is the caller's word for it
 * and not this file's.
 */
export function pathLabel(path: string): string {
  const clean = path.endsWith("/close") ? path.slice(0, -"/close".length) : path;
  if (clean === "root" || !clean.startsWith("root.")) return "";
  return clean
    .slice("root.".length)
    .split(".")
    .reduce((text, step) => {
      if (/^\d+$/.test(step)) return `${text}[${step}]`;
      return text === "" ? step : `${text}.${step}`;
    }, "");
}

/**
 * A picked value as text to read.
 *
 * A string is its own text, with its real line breaks — which is the whole
 * point of the pane, because the tree can only ever show it escaped on one
 * line. Anything else is JSON again, indented, because there is no more
 * readable form of an object than the object.
 */
export function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The messages inside one recorded request, for depth 4's pager.
 *
 * A request body is the whole request since §3, so the messages are one field of
 * it. A body recorded before that spec IS the array, and one recorded with
 * capture off is nothing — all three are answered here rather than in three
 * components.
 */
export function messagesOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body === null || typeof body !== "object") return [];
  const messages = (body as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages : [];
}

/**
 * The body LiteLLM RECEIVED, which is not the top level of what was recorded.
 *
 * `rex_trace.py` records the callback's `kwargs`, and by then LiteLLM has
 * already translated the request into the shape it calls the model with. The
 * request as it arrived survives inside it, at
 * `litellm_params.proxy_server_request.body`, and that is the only copy that
 * still has the fields the client actually sent.
 */
function arrivedBody(body: unknown): unknown {
  if (body === null || typeof body !== "object") return null;
  const params = (body as { litellm_params?: unknown }).litellm_params;
  if (params === null || typeof params !== "object") return null;
  const request = (params as { proxy_server_request?: unknown }).proxy_server_request;
  if (request === null || typeof request !== "object") return null;
  return (request as { body?: unknown }).body ?? null;
}

/**
 * The system prompt of one recorded request, which is NOT one of its messages.
 *
 * Two of spec 46 §4.5's three doors carry it as a field beside the conversation:
 *
 * | Door | Where its system prompt is | What it is |
 * |:--|:--|:--|
 * | Anthropic `/v1/messages` | `system`, beside `messages` | a string, or a list of text blocks |
 * | OpenAI `/v1/responses` | `instructions`, beside `input` | a string |
 * | OpenAI `/v1/chat/completions` | `messages[0]` | already in the list, so nothing to find |
 *
 * The first two hid theirs completely until this was written — recorded in
 * every body and reachable from no screen. Measured on the reviewer's own log:
 * 8 138 characters of Claude Code's prompt, and 20 751 of Codex's.
 *
 * **A `system` ROLE inside `messages` is a different thing and is left alone.**
 * Claude Code sends those too — its SessionStart hook output, its `# Environment`
 * block, and its reminders — and LiteLLM keeps each where it is. They are
 * messages, they appear more than once, and they are already drawn as messages.
 */
export function systemPromptOf(body: unknown): unknown {
  for (const source of [arrivedBody(body), body]) {
    if (source === null || typeof source !== "object") continue;
    const fields = source as { system?: unknown; instructions?: unknown };
    const value = fields.system ?? fields.instructions;
    if (typeof value === "string" && value !== "") return value;
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return undefined;
}

/** The role of one recorded message, for the pager's chip. `?` when it has none. */
export function roleOf(message: unknown): string {
  if (message === null || typeof message !== "object") return "?";
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role : "?";
}
