// Spec 29 §5.3 — the parts of a Mermaid diagram, read off its source.
//
// A line-based scanner, not a Mermaid grammar. Every statement Mermaid accepts
// is on one line, and the scanner asks one line one question: what does this
// line declare or mention? Where Mermaid's grammar is wider than this scanner,
// REX offers `lines` — a node the scanner cannot name is still a line the
// reviewer can click.
//
// Pure strings on purpose. The renderer scans the fence it drew; main scans the
// fence in the working copy to tell the agent where a part is; `node --test`
// scans the fixtures. All three import this and nothing else.

import { fnv1a } from "./hash.ts";
import type { DiagramPart, DiagramRef } from "./types.ts";

export interface DiagramNode {
  id: string;
  label: string | null;
  /** The line that first gives it a label; failing that, its first mention. */
  declared: number;
  /** Every line that names it, the declaring one included. */
  mentions: number[];
}

export interface DiagramEdge {
  from: string;
  to: string;
  /** Position among the edges from the same `from` to the same `to`, in source order, from 0. */
  ordinal: number;
  label: string | null;
  line: number;
}

export interface DiagramSubgraph {
  id: string;
  title: string | null;
  from: number;
  to: number;
}

export interface LineSpan {
  from: number;
  to: number;
}

export interface DiagramParts {
  /** The first word of the source — `flowchart`, `graph`, `sequenceDiagram`, … */
  type: string;
  /** The source, one entry per line, each trimmed. `text[0]` is line 1. */
  text: string[];
  nodes: Map<string, DiagramNode>;
  edges: DiagramEdge[];
  /** In order of opening. */
  subgraphs: DiagramSubgraph[];
  /** Line → the parts it states, in the order they appear on it. */
  byLine: Map<number, DiagramPart[]>;
}

/**
 * A fence's text as the source pane and the scanner count it.
 *
 * markdown-it hands a fence's content over with its closing newline, so the
 * `<pre>` REX draws holds `…\nend\n` and a naive split counts an empty eighth
 * line on a seven-line diagram — measured live on 2026-09-01, the gutter read
 * `6–13` for lines 6–12. `mermaidFences` joins the file's lines without one,
 * so the two halves agreed on every number except that one; this is where they
 * are made to agree on it too.
 */
export function fenceText(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** The kinds §4.3 names parts for. Everything else gets `lines` and the diagram. */
export function isFlowchart(type: string): boolean {
  return type === "flowchart" || type === "graph" || type === "flowchart-elk";
}

/** A Mermaid node id: letters, digits, `_`, with `-` allowed only between them. */
const ID_START = /[\p{L}\p{N}_]/u;
const ID_CHAR = /[\p{L}\p{N}_]/u;

/** Statement openers that declare nothing a reviewer points at. */
const SILENT =
  /^(?:flowchart|graph|direction|classDef|class|style|linkStyle|click|accTitle|accDescr|title)\b/;

/**
 * A link between two node groups, with its text if it carries one.
 *
 * Anchored at the start of what is left of the statement. The three text forms
 * come first so that `-- yes -->` is read as one labelled arrow and not as `--`
 * followed by a node called `yes`. The bare forms cover every stroke Mermaid
 * draws: `-->`, `---`, `-.->`, `==>`, `~~~`, and their `o`, `x` and `<` ends.
 */
const ARROW =
  /^\s*[<ox]?(?:--\s+(?<t1>.+?)\s+--+|-\.\s+(?<t2>.+?)\s+\.-+|==\s+(?<t3>.+?)\s+==+|--+|-\.+-|==+|~~~+)[>ox]?(?:\s*\|(?<pipe>[^|]*)\|)?\s*/u;

/** The first word of the first line that is not front matter, a comment or blank. */
export function diagramKind(source: string): string {
  for (const raw of withoutFrontMatter(source.split("\n"))) {
    const line = stripComment(raw).trim();
    if (line.length === 0) continue;
    return line.split(/[\s;]/)[0] ?? "";
  }
  return "";
}

/**
 * Mermaid's `---` front matter, blanked rather than removed, so every line
 * keeps its number.
 */
function withoutFrontMatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== "---") return lines;
  const close = lines.findIndex((line, at) => at > 0 && line.trim() === "---");
  if (close === -1) return lines;
  return lines.map((line, at) => (at <= close ? "" : line));
}

/** Everything from `%%` on is a comment, unless the `%%` is inside quotes. */
function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i + 1 < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (!quoted && line[i] === "%" && line[i + 1] === "%") return line.slice(0, i);
  }
  return line;
}

/** `A --> B; B --> C` is two statements. A `;` inside brackets or quotes is not a split. */
function splitStatements(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === "[" || c === "(" || c === "{") depth++;
    else if (c === "]" || c === ")" || c === "}") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      out.push(line.slice(start, i));
      start = i + 1;
    }
  }
  out.push(line.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Reads an id at `at`, or null. `A-->B` stops at `A`: a `-` must be followed by an id character. */
function readId(text: string, at: number): string | null {
  if (at >= text.length || !ID_START.test(text[at])) return null;
  let i = at;
  while (i < text.length) {
    if (ID_CHAR.test(text[i])) i++;
    else if (text[i] === "-" && i + 1 < text.length && ID_CHAR.test(text[i + 1])) i++;
    else break;
  }
  return text.slice(at, i);
}

const CLOSER: Record<string, string> = { "[": "]", "(": ")", "{": "}", ">": "]" };

/**
 * The bracketed label opening at `at`, and where it ends.
 *
 * The outer bracket is matched by depth, skipping over quoted text, and the
 * shape decorations Mermaid spells with more brackets — `[(`, `((`, `{{`,
 * `[/`, `[\` — come off both ends of what is inside. So `[(rex.db)]`, `((x))`
 * and `[/x/]` all read as their words.
 */
function readShape(text: string, at: number): { label: string; end: number } | null {
  const open = text[at];
  const close = CLOSER[open];
  if (!close) return null;
  let depth = 0;
  let quoted = false;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if (c === open && open !== ">") depth++;
    else if (c === close) {
      depth--;
      if (depth <= 0) {
        const inner = text.slice(at + 1, i);
        return { label: cleanLabel(inner), end: i + 1 };
      }
    }
  }
  return null;
}

/** `A@{ shape: rect, label: "x" }` — the newer shape syntax. Only the label matters here. */
function readShapeObject(text: string, at: number): { label: string | null; end: number } | null {
  if (!text.startsWith("@{", at)) return null;
  const close = text.indexOf("}", at);
  if (close === -1) return null;
  const body = text.slice(at + 2, close);
  const label = /label\s*:\s*("([^"]*)"|'([^']*)'|([^,}]+))/.exec(body);
  const found = label ? (label[2] ?? label[3] ?? label[4] ?? "").trim() : null;
  return { label: found && found.length > 0 ? found : null, end: close + 1 };
}

function cleanLabel(inner: string): string {
  let s = inner.trim();
  // Shape decorations, from both ends, however many.
  while (s.length > 0 && "[({/\\".includes(s[0])) s = s.slice(1);
  while (s.length > 0 && "])}/\\".includes(s[s.length - 1])) s = s.slice(0, -1);
  s = s.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s.trim();
}

interface NodeToken {
  id: string;
  label: string | null;
}

/**
 * One statement — `A[Start] & B --> C -->|yes| D` — as node groups joined by
 * arrows. `groups.length === arrows.length + 1` when the statement is whole; a
 * trailing arrow with nothing after it is dropped.
 */
function readStatement(text: string): { groups: NodeToken[][]; arrows: Array<string | null> } {
  const groups: NodeToken[][] = [];
  const arrows: Array<string | null> = [];
  let i = 0;

  const skipSpace = (): void => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };

  while (i < text.length) {
    const group: NodeToken[] = [];
    // A node group: `A & B & C`, each with an optional shape and `:::class`.
    for (;;) {
      skipSpace();
      const id = readId(text, i);
      if (!id) break;
      i += id.length;
      let label: string | null = null;
      const shape = readShape(text, i);
      if (shape) {
        label = shape.label.length > 0 ? shape.label : null;
        i = shape.end;
      } else {
        const object = readShapeObject(text, i);
        if (object) {
          label = object.label;
          i = object.end;
        }
      }
      if (text.startsWith(":::", i)) {
        i += 3;
        const cls = readId(text, i);
        if (cls) i += cls.length;
      }
      group.push({ id, label });
      skipSpace();
      if (text[i] === "&") {
        i++;
        continue;
      }
      break;
    }
    if (group.length === 0) break;
    groups.push(group);

    const arrow = ARROW.exec(text.slice(i));
    if (!arrow || arrow[0].length === 0) break;
    i += arrow[0].length;
    const named = arrow.groups ?? {};
    const label = cleanLabel(named.pipe ?? named.t1 ?? named.t2 ?? named.t3 ?? "");
    arrows.push(label.length > 0 ? label : null);
  }

  while (arrows.length >= groups.length && arrows.length > 0) arrows.pop();
  return { groups, arrows };
}

const SUBGRAPH = /^subgraph\s+(.*)$/;
const SUBGRAPH_ID = /^([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)\s*(?:\[(.*)\]|\((.*)\)|\{(.*)\})?\s*$/u;

/**
 * §5.3 — the parts of a flowchart. Any other kind comes back with its type,
 * its lines and nothing named: §4.3's `lines` and `diagram` are what it has.
 */
export function scanDiagram(source: string): DiagramParts {
  const rawLines = source.split("\n");
  const parts: DiagramParts = {
    type: diagramKind(source),
    text: rawLines.map((line) => line.trim()),
    nodes: new Map(),
    edges: [],
    subgraphs: [],
    byLine: new Map(),
  };
  if (!isFlowchart(parts.type)) return parts;

  const lines = withoutFrontMatter(rawLines);
  const open: DiagramSubgraph[] = [];
  let unnamed = 0;
  const pairCount = new Map<string, number>();

  const state = (line: number, part: DiagramPart): void => {
    const list = parts.byLine.get(line) ?? [];
    list.push(part);
    parts.byLine.set(line, list);
  };

  const mention = (token: NodeToken, line: number): void => {
    const found = parts.nodes.get(token.id);
    if (!found) {
      parts.nodes.set(token.id, {
        id: token.id,
        label: token.label,
        declared: line,
        mentions: [line],
      });
      if (token.label) state(line, { kind: "node", id: token.id });
      return;
    }
    if (!found.mentions.includes(line)) found.mentions.push(line);
    // The first line that gives it a label is where it is declared; a bare
    // mention before that was only a mention.
    if (found.label === null && token.label) {
      found.label = token.label;
      found.declared = line;
      state(line, { kind: "node", id: token.id });
    }
  };

  lines.forEach((raw, at) => {
    const line = at + 1;
    for (const statement of splitStatements(stripComment(raw))) {
      const subgraph = SUBGRAPH.exec(statement);
      if (subgraph) {
        const rest = subgraph[1].trim();
        const named = SUBGRAPH_ID.exec(rest);
        const id = named ? named[1] : `subGraph${unnamed++}`;
        const bracket = named ? (named[2] ?? named[3] ?? named[4] ?? null) : null;
        const title = named ? (bracket !== null ? cleanLabel(bracket) : id) : cleanLabel(rest);
        const entry: DiagramSubgraph = { id, title, from: line, to: lines.length };
        parts.subgraphs.push(entry);
        open.push(entry);
        state(line, { kind: "subgraph", id });
        continue;
      }
      if (/^end\b/.test(statement)) {
        const closed = open.pop();
        if (closed) closed.to = line;
        continue;
      }
      if (SILENT.test(statement)) continue;

      const { groups, arrows } = readStatement(statement);
      for (const group of groups) for (const token of group) mention(token, line);
      arrows.forEach((label, k) => {
        for (const from of groups[k]) {
          for (const to of groups[k + 1]) {
            const key = `${from.id} ${to.id}`;
            const ordinal = pairCount.get(key) ?? 0;
            pairCount.set(key, ordinal + 1);
            parts.edges.push({ from: from.id, to: to.id, ordinal, label, line });
            state(line, { kind: "edge", from: from.id, to: to.id, ordinal });
          }
        }
      });
    }
  });

  return parts;
}

/** §4.3 — what one line states: nodes it labels, edges on it, a subgraph it opens. */
export function partsOnLine(parts: DiagramParts, line: number): DiagramPart[] {
  return parts.byLine.get(line) ?? [];
}

/** The lines a part is stated on, or null when the diagram has no such part. */
export function linesOf(parts: DiagramParts, part: DiagramPart): LineSpan | null {
  switch (part.kind) {
    case "node": {
      const node = parts.nodes.get(part.id);
      return node ? { from: node.declared, to: node.declared } : null;
    }
    case "edge": {
      const edge = edgeOf(parts, part);
      return edge ? { from: edge.line, to: edge.line } : null;
    }
    case "subgraph": {
      const found = parts.subgraphs.find((s) => s.id === part.id);
      return found ? { from: found.from, to: found.to } : null;
    }
    case "lines":
      return { from: part.from, to: part.to };
  }
}

/**
 * The edge a part names: the one at `ordinal` among the edges between its two
 * ends, or the last of them when the diagram has fewer now than it had.
 */
export function edgeOf(parts: DiagramParts, part: DiagramPart): DiagramEdge | null {
  if (part.kind !== "edge") return null;
  const same = parts.edges.filter((e) => e.from === part.from && e.to === part.to);
  if (same.length === 0) return null;
  return same[Math.min(part.ordinal, same.length - 1)];
}

/** The subgraphs a line sits inside, innermost first. A subgraph opening on `line` is not its own container. */
export function subgraphsEnclosing(parts: DiagramParts, line: number): DiagramSubgraph[] {
  return parts.subgraphs
    .filter((s) => s.from < line && line <= s.to)
    .sort((a, b) => b.from - a.from);
}

/** The lines of a span, each trimmed, joined with `\n` — `DiagramRef.text`. */
export function textOfLines(source: string, span: LineSpan): string {
  return source
    .split("\n")
    .slice(span.from - 1, span.to)
    .map((line) => line.trim())
    .join("\n");
}

/**
 * §5.3 — FNV-1a over the source with whitespace runs collapsed, every line
 * trimmed and blank lines dropped. A fence re-indented by a formatter keeps
 * its fingerprint; a fence with one label changed does not.
 */
export function fingerprintSource(source: string): string {
  const normalised = source
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line.length > 0)
    .join("\n");
  return fnv1a(normalised);
}

/**
 * §5.4 — the first run of lines equal to `text`, at or after `preferFrom`;
 * failing that, the first anywhere. Never a line number alone.
 */
function matchLines(lines: string[], text: string, preferFrom: number): number | null {
  const wanted = text.split("\n").map((l) => l.trim());
  if (wanted.length === 0 || wanted.every((l) => l.length === 0)) return null;
  const fits = (at: number): boolean => wanted.every((l, k) => lines[at + k] === l);
  for (let at = Math.max(0, preferFrom - 1); at + wanted.length <= lines.length; at++) {
    if (fits(at)) return at + 1;
  }
  for (let at = 0; at + wanted.length <= lines.length; at++) if (fits(at)) return at + 1;
  return null;
}

/** §5.7 — one string per part, so two parts of one diagram are never duplicates of each other. */
export function partKey(part: DiagramPart): string {
  switch (part.kind) {
    case "node":
      return `node:${part.id}`;
    case "edge":
      return `edge:${part.from}>${part.to}#${part.ordinal}`;
    case "subgraph":
      return `subgraph:${part.id}`;
    case "lines":
      return `lines:${part.from}-${part.to}`;
  }
}

/** `partKey` for an anchor's ref, or null when the anchor is not a diagram part. */
export function refKey(ref: DiagramRef | null | undefined): string | null {
  return ref ? `${ref.type}|${partKey(ref.part)}` : null;
}

/** The label a part shows — a node's or edge's text, a subgraph's title. Null for lines. */
export function partLabel(parts: DiagramParts, part: DiagramPart): string | null {
  switch (part.kind) {
    case "node":
      return parts.nodes.get(part.id)?.label ?? null;
    case "edge":
      return edgeOf(parts, part)?.label ?? null;
    case "subgraph":
      return parts.subgraphs.find((s) => s.id === part.id)?.title ?? null;
    case "lines":
      return null;
  }
}

export interface PartWords {
  /** The scope word — `node`, `edge`, `subgraph`, `lines`. */
  word: string;
  /** The chip and crumb — `node “Has comment?”`, `edge B → C “yes”`, `lines 157–159`. */
  chip: string;
  /** The card heading — `Node B · “Has comment?”`. */
  title: string;
  /** What is stored, in words — `node B`, `edge B → C (1st)`. */
  identity: string;
}

/**
 * §4.1 — the words a part is offered in, wherever it is offered. One place
 * decides them, so the badge, the crumb, the chip and the card cannot drift.
 *
 * `fenceLine` turns a `lines` part's fence-relative numbers into file lines,
 * which is what a reviewer says to the agent.
 */
export function partWords(
  parts: DiagramParts,
  part: DiagramPart,
  fenceLine: number | null = null,
): PartWords {
  const quoted = (text: string | null): string => (text ? ` “${text}”` : "");
  switch (part.kind) {
    case "node": {
      const label = partLabel(parts, part);
      return {
        word: "node",
        chip: label ? `node “${label}”` : `node ${part.id}`,
        title: label && label !== part.id ? `Node ${part.id} · “${label}”` : `Node ${part.id}`,
        identity: `node ${part.id}`,
      };
    }
    case "edge": {
      const label = partLabel(parts, part);
      const arrow = `${part.from} → ${part.to}`;
      return {
        word: "edge",
        chip: `edge ${arrow}${quoted(label)}`,
        title: `Edge ${arrow}${label ? ` · “${label}”` : ""}`,
        identity: `edge ${arrow}${part.ordinal > 0 ? ` (${part.ordinal + 1}.)` : ""}`,
      };
    }
    case "subgraph": {
      const title = partLabel(parts, part);
      return {
        word: "subgraph",
        chip: `subgraph “${title ?? part.id}”`,
        title:
          title && title !== part.id ? `Subgraph ${part.id} · “${title}”` : `Subgraph ${part.id}`,
        identity: `subgraph ${part.id}`,
      };
    }
    case "lines": {
      const offset = fenceLine ?? 0;
      const from = part.from + offset;
      const to = part.to + offset;
      const range = from === to ? `line ${from}` : `lines ${from}–${to}`;
      return {
        word: "lines",
        chip: range,
        title: `${range.charAt(0).toUpperCase()}${range.slice(1)} of the diagram`,
        identity: range,
      };
    }
  }
}

/**
 * The words for a stored ref, with no live diagram to read.
 *
 * The ref carries the lines that state the part, so scanning them under the
 * diagram's own header gives the node its label and the edge its text — enough
 * for a card whose document is not open, and for the agent's prompt.
 * `fenceLine` is the fence's opening line when the caller knows it.
 */
export function describeRef(ref: DiagramRef, fenceLine: number | null = null): PartWords {
  // A part is named by an id or two ends, which the one-fence scan sees the
  // same way; a `lines` part carries its own numbers and reads none.
  return partWords(scanDiagram(`${ref.type}\n${ref.text}`), ref.part, fenceLine);
}

/** `Diagram · flowchart · 5 nodes, 4 edges` — the card title for the whole diagram. */
export function diagramTitle(parts: DiagramParts): string {
  const kind = parts.type.length > 0 ? parts.type : "mermaid";
  if (!isFlowchart(parts.type)) return `Diagram · ${kind}`;
  const nodes = parts.nodes.size;
  const edges = parts.edges.length;
  return `Diagram · ${kind} · ${nodes} node${nodes === 1 ? "" : "s"}, ${edges} edge${edges === 1 ? "" : "s"}`;
}

/**
 * §5.4 step 2 — the part a ref names, in a diagram that has been found.
 *
 * A node by its id, an edge by its ends, a subgraph by its id, lines by their
 * text. Null is the answer when the part is gone, and never a guess: a line
 * number always resolves to *something*, and that is the wrong-place failure
 * the whole anchor design exists to prevent.
 */
export function findPart(
  parts: DiagramParts,
  ref: DiagramRef,
): { part: DiagramPart; lines: LineSpan } | null {
  const part = ref.part;
  if (part.kind === "lines") {
    const from = matchLines(parts.text, ref.text, ref.lines.from);
    if (from === null) return null;
    const to = from + (ref.lines.to - ref.lines.from);
    return { part: { kind: "lines", from, to }, lines: { from, to } };
  }
  if (part.kind === "edge") {
    const edge = edgeOf(parts, part);
    if (!edge) return null;
    return {
      part: { kind: "edge", from: edge.from, to: edge.to, ordinal: edge.ordinal },
      lines: { from: edge.line, to: edge.line },
    };
  }
  const lines = linesOf(parts, part);
  return lines ? { part, lines } : null;
}

/** §5.2 — the ref for a part of this source, or null when the source has no such part. */
export function makeDiagramRef(source: string, part: DiagramPart): DiagramRef | null {
  const parts = scanDiagram(source);
  const lines = linesOf(parts, part);
  if (!lines) return null;
  return {
    type: parts.type,
    part,
    lines,
    text: textOfLines(source, lines),
    fingerprint: fingerprintSource(source),
  };
}

export interface MermaidFence {
  /** The line the opening ``` is on, 1-indexed — what `data-src-line` stamps. */
  fenceLine: number;
  source: string;
}

/** Every ```` ```mermaid ```` fence in a Markdown file, with the line its opener is on. */
export function mermaidFences(markdown: string): MermaidFence[] {
  const lines = markdown.split("\n");
  const fences: MermaidFence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s{0,3}(`{3,}|~{3,})\s*mermaid\b/.exec(lines[i]);
    if (!open) continue;
    const marker = open[1];
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(lines[j]);
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break;
      body.push(lines[j]);
    }
    fences.push({ fenceLine: i + 1, source: body.join("\n") });
    i = j;
  }
  return fences;
}

/**
 * §5.8 — the fence a ref is about, in a Markdown file as it is now: the one
 * with the same fingerprint, else the only one that still holds the part —
 * by its id or its ends, or for `lines` by its text (`findPart`). Null when
 * neither is true, and never a guess between two.
 */
export function locateFence(markdown: string, ref: DiagramRef): MermaidFence | null {
  const fences = mermaidFences(markdown);
  const same = fences.find((f) => fingerprintSource(f.source) === ref.fingerprint);
  if (same) return same;
  const holding = fences.filter((f) => findPart(scanDiagram(f.source), ref) !== null);
  return holding.length === 1 ? holding[0] : null;
}
