// Spec 29 §7 milestone 0 — the scanner, the part map and the resolver.
//
// Two halves. The first runs on strings: `scanDiagram` names every part of the
// three fixtures with the right lines, labels and ordinals; the fingerprint
// ignores indentation and sees a changed label; `findPart` and `locateFence`
// find a part by what names it and refuse to guess. The second runs in a
// headless Chromium with mermaid 11.17.0 drawing the fixtures the way
// `mermaidPass` draws them: `partElements` finds an element for every part,
// and `resolveAnchor` on a diagram anchor gives `ok`, `moved` and `orphaned`
// for the edits §5.4 names — and never an element other than the part's.
//
// Run: npm run test:diagram

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { renderMarkdown } from "../src/main/render/markdown.ts";
import {
  describeRef,
  diagramTitle,
  edgeOf,
  findPart,
  fingerprintSource,
  linesOf,
  locateFence,
  makeDiagramRef,
  mermaidFences,
  partKey,
  partsOnLine,
  partWords,
  scanDiagram,
  subgraphsEnclosing,
} from "../src/shared/diagram.ts";
import type { Anchor, AnchorState, DiagramPart } from "../src/shared/types.ts";

const REPO = join(import.meta.dirname, "..");

/** Spec 29 §1 — the seven-line flowchart the spec was measured against. */
const FLOWCHART = `flowchart LR
  A[Reviewer] --> B{Has comment?}
  B -- yes --> C[Ask agent]
  B -- no --> D[Read on]
  subgraph engine [The engine]
    C --> E[(rex.db)]
  end`;

/** Spec 29 §5.5 — hyphenated ids, `&`, two same-pair edges, an id-less subgraph. */
const PROBE = `flowchart TD
  my-node[Hyphen id] --> B
  my-node --> B
  B --> C
  subgraph The engine
    C --> D
  end
  subgraph sg2 [Named]
    D --> E
  end
  A & B --> F`;

/** The real one: spec 01 §3's architecture diagram, read from the file. */
const SPEC_01 = mermaidFences(
  readFileSync(join(REPO, "docs/my-specs/01-initial/SPEC.md"), "utf8"),
)[0];

// ── The scanner ─────────────────────────────────────────────────

test("scanDiagram names every node, edge and subgraph of the §1 flowchart", () => {
  const parts = scanDiagram(FLOWCHART);
  assert.equal(parts.type, "flowchart");
  assert.deepEqual([...parts.nodes.keys()], ["A", "B", "C", "D", "E"]);
  assert.deepEqual(parts.nodes.get("B"), {
    id: "B",
    label: "Has comment?",
    declared: 2,
    mentions: [2, 3, 4],
  });
  assert.equal(parts.nodes.get("E")?.label, "rex.db");
  assert.deepEqual(
    parts.edges.map((e) => [e.from, e.to, e.ordinal, e.label, e.line]),
    [
      ["A", "B", 0, null, 2],
      ["B", "C", 0, "yes", 3],
      ["B", "D", 0, "no", 4],
      ["C", "E", 0, null, 6],
    ],
  );
  assert.deepEqual(parts.subgraphs, [{ id: "engine", title: "The engine", from: 5, to: 7 }]);
  assert.deepEqual(partsOnLine(parts, 2), [
    { kind: "node", id: "A" },
    { kind: "node", id: "B" },
    { kind: "edge", from: "A", to: "B", ordinal: 0 },
  ]);
  assert.deepEqual(partsOnLine(parts, 1), []);
  assert.deepEqual(partsOnLine(parts, 7), []);
  assert.equal(subgraphsEnclosing(parts, 6)[0]?.id, "engine");
  assert.deepEqual(subgraphsEnclosing(parts, 5), []);
  assert.equal(diagramTitle(parts), "Diagram · flowchart · 5 nodes, 4 edges");
});

test("scanDiagram handles hyphenated ids, `&`, same-pair ordinals and id-less subgraphs", () => {
  const parts = scanDiagram(PROBE);
  assert.equal(parts.nodes.get("my-node")?.label, "Hyphen id");
  const pair = parts.edges.filter((e) => e.from === "my-node" && e.to === "B");
  assert.deepEqual(
    pair.map((e) => [e.ordinal, e.line]),
    [
      [0, 2],
      [1, 3],
    ],
  );
  // `A & B --> F` is two edges on one line, A first — the order Mermaid draws.
  const fan = parts.edges.filter((e) => e.to === "F");
  assert.deepEqual(
    fan.map((e) => [e.from, e.ordinal, e.line]),
    [
      ["A", 0, 11],
      ["B", 0, 11],
    ],
  );
  assert.deepEqual(
    parts.subgraphs.map((s) => [s.id, s.title, s.from, s.to]),
    [
      ["subGraph0", "The engine", 5, 7],
      ["sg2", "Named", 8, 10],
    ],
  );
});

test("a chain is one edge per arrow, and silent statements declare nothing", () => {
  const parts = scanDiagram(`---
title: front matter
---
%% a comment
graph TD
  A --> B --> C %% trailing comment
  classDef red fill:#f00
  class A red
  style B fill:#fff
  linkStyle 0 stroke:red
  click A callback
  A -->|"quoted"| D; D -.-> E
  F@{ shape: rect, label: "Object label" } ==> G`);
  assert.equal(parts.type, "graph");
  assert.deepEqual(
    parts.edges.map((e) => [e.from, e.to, e.label, e.line]),
    [
      ["A", "B", null, 6],
      ["B", "C", null, 6],
      ["A", "D", "quoted", 12],
      ["D", "E", null, 12],
      ["F", "G", null, 13],
    ],
  );
  assert.equal(parts.nodes.get("F")?.label, "Object label");
  for (const line of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) {
    assert.deepEqual(partsOnLine(parts, line), [], `line ${line} declares nothing`);
  }
});

test("scanDiagram reads spec 01's architecture diagram", () => {
  const parts = scanDiagram(SPEC_01.source);
  assert.equal(parts.type, "graph");
  assert.deepEqual([...parts.nodes.keys()].sort(), [
    "AG",
    "AR",
    "DB",
    "DV",
    "OV",
    "RN",
    "Repo",
    "TS",
  ]);
  assert.equal(parts.nodes.get("DB")?.label, "SQLite<br/>~/.rex/rex.db");
  assert.equal(parts.nodes.get("Repo")?.label, "User's repositories");
  assert.deepEqual(
    parts.subgraphs.map((s) => [s.id, s.title]),
    [
      ["Renderer", "Renderer process (one per document window)"],
      ["Main", "Main process"],
    ],
  );
  const ipc = parts.edges.find((e) => e.from === "OV" && e.to === "TS");
  assert.equal(ipc?.label, "ipcRenderer.invoke");
  const both = parts.edges.filter((e) => e.from === "AG" && e.to === "Repo");
  assert.deepEqual(
    both.map((e) => [e.ordinal, e.label]),
    [
      [0, "read tools"],
      [1, "write tools (Apply only)"],
    ],
  );
  assert.ok(
    parts.edges.some((e) => e.from === "TS" && e.to === "DB"),
    "TS <--> DB is an edge",
  );
});

test("a diagram of another kind has its type, its lines and no named parts", () => {
  const parts = scanDiagram(`sequenceDiagram
  participant R as Reviewer
  R->>M: hello`);
  assert.equal(parts.type, "sequenceDiagram");
  assert.equal(parts.nodes.size, 0);
  assert.equal(parts.edges.length, 0);
  assert.equal(parts.text.length, 3);
  assert.equal(diagramTitle(parts), "Diagram · sequenceDiagram");
});

// ── The words ───────────────────────────────────────────────────

test("partWords are the same words everywhere", () => {
  const parts = scanDiagram(FLOWCHART);
  assert.deepEqual(partWords(parts, { kind: "node", id: "B" }), {
    word: "node",
    chip: "node “Has comment?”",
    title: "Node B · “Has comment?”",
    identity: "node B",
  });
  assert.equal(
    partWords(parts, { kind: "edge", from: "B", to: "C", ordinal: 0 }).chip,
    "edge B → C “yes”",
  );
  assert.equal(
    partWords(parts, { kind: "subgraph", id: "engine" }).title,
    "Subgraph engine · “The engine”",
  );
  assert.equal(partWords(parts, { kind: "lines", from: 5, to: 7 }, 155).chip, "lines 160–162");
  assert.equal(
    partWords(parts, { kind: "lines", from: 2, to: 2 }, 155).title,
    "Line 157 of the diagram",
  );
});

test("describeRef names a part from the stored ref alone", () => {
  const node = makeDiagramRef(FLOWCHART, { kind: "node", id: "B" });
  assert.ok(node);
  assert.equal(describeRef(node).title, "Node B · “Has comment?”");
  const edge = makeDiagramRef(FLOWCHART, { kind: "edge", from: "B", to: "D", ordinal: 0 });
  assert.ok(edge);
  assert.equal(describeRef(edge).chip, "edge B → D “no”");
  const sub = makeDiagramRef(FLOWCHART, { kind: "subgraph", id: "engine" });
  assert.ok(sub);
  assert.equal(describeRef(sub).title, "Subgraph engine · “The engine”");
  assert.equal(describeRef(sub, 155).title, "Subgraph engine · “The engine”");
});

// ── The fingerprint and the ref ─────────────────────────────────

test("fingerprintSource ignores indentation and blank lines, and sees a changed label", () => {
  const reindented = FLOWCHART.split("\n")
    .map((line) => `      ${line.trim()}`)
    .join("\n\n");
  assert.equal(fingerprintSource(reindented), fingerprintSource(FLOWCHART));
  assert.notEqual(
    fingerprintSource(FLOWCHART.replace("Has comment?", "Decision?")),
    fingerprintSource(FLOWCHART),
  );
});

test("makeDiagramRef records the lines and their text; a part the source lacks is null", () => {
  const ref = makeDiagramRef(FLOWCHART, { kind: "subgraph", id: "engine" });
  assert.deepEqual(ref?.lines, { from: 5, to: 7 });
  assert.equal(ref?.text, "subgraph engine [The engine]\nC --> E[(rex.db)]\nend");
  assert.equal(ref?.type, "flowchart");
  assert.equal(makeDiagramRef(FLOWCHART, { kind: "node", id: "Z" }), null);
  assert.equal(partKey({ kind: "edge", from: "B", to: "C", ordinal: 0 }), "edge:B>C#0");
});

// ── Finding a part again ────────────────────────────────────────

test("findPart finds by identity, clamps a missing ordinal, and refuses a renamed id", () => {
  const nodeB = makeDiagramRef(FLOWCHART, { kind: "node", id: "B" });
  const edgeBC = makeDiagramRef(FLOWCHART, { kind: "edge", from: "B", to: "C", ordinal: 0 });
  assert.ok(nodeB && edgeBC);

  // B's label edited: the same node, on the same line.
  const relabelled = scanDiagram(FLOWCHART.replace("Has comment?", "Decision?"));
  assert.deepEqual(findPart(relabelled, nodeB)?.lines, { from: 2, to: 2 });
  assert.deepEqual(findPart(relabelled, edgeBC)?.lines, { from: 3, to: 3 });

  // B renamed everywhere: a new node. Never the thing that took its place.
  const renamed = scanDiagram(FLOWCHART.replaceAll("B", "Decision"));
  assert.equal(findPart(renamed, nodeB), null);
  assert.equal(findPart(renamed, edgeBC), null);

  // The second of two same-pair edges, after the first was removed: the last one.
  const two = makeDiagramRef(PROBE, { kind: "edge", from: "my-node", to: "B", ordinal: 1 });
  assert.ok(two);
  const one = scanDiagram(PROBE.replace("  my-node[Hyphen id] --> B\n", "  my-node[Hyphen id]\n"));
  const found = findPart(one, two);
  assert.equal(found?.part.kind === "edge" && found.part.ordinal, 0);
  assert.equal(edgeOf(one, two.part)?.line, 3);
});

test("a `lines` part is found by its text — at its old place first, elsewhere second, never by number alone", () => {
  const lines = makeDiagramRef(FLOWCHART, { kind: "lines", from: 6, to: 6 });
  assert.ok(lines);
  assert.equal(lines.text, "C --> E[(rex.db)]");

  // Two lines inserted above: the text moved down and is found there.
  const shifted = scanDiagram(FLOWCHART.replace("  subgraph", "  X --> Y\n  Y --> Z\n  subgraph"));
  assert.deepEqual(findPart(shifted, lines)?.lines, { from: 8, to: 8 });

  // The line rewritten: nothing else is offered in its place.
  const gone = scanDiagram(FLOWCHART.replace("C --> E[(rex.db)]", "C --> E[(the store)]"));
  assert.equal(findPart(gone, lines), null);
  assert.equal(
    linesOf(gone, lines.part)?.from,
    6,
    "linesOf reports the stored span; findPart refuses it",
  );
});

test("locateFence finds the fence by fingerprint, then by the part, and never guesses between two", () => {
  const ref = makeDiagramRef(FLOWCHART, { kind: "node", id: "B" });
  assert.ok(ref);
  const page = (body: string): string =>
    `# Title\n\nProse.\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nMore.\n`;

  assert.equal(locateFence(page(FLOWCHART), ref)?.fenceLine, 5);
  // Moved down and relabelled: found by the node's id.
  const moved = `# Title\n\nOne.\n\nTwo.\n\n\`\`\`mermaid\n${FLOWCHART.replace("Has comment?", "Decision?")}\n\`\`\`\n`;
  assert.equal(locateFence(moved, ref)?.fenceLine, 7);
  // Two fences both holding a node B, neither with the fingerprint: no answer.
  const twice = `${page(FLOWCHART.replace("Has comment?", "One?"))}\n\`\`\`mermaid\n${FLOWCHART.replace("Has comment?", "Two?")}\n\`\`\`\n`;
  assert.equal(locateFence(twice, ref), null);
  // Renamed: gone.
  assert.equal(locateFence(page(FLOWCHART.replaceAll("B", "Decision")), ref), null);
});

// ── The browser half ────────────────────────────────────────────

interface Landed {
  layer: number | null;
  state: AnchorState;
  /** The tag and id of the element the anchor landed on, or null. */
  landedOn: string | null;
  /** The source line the resolver reported. */
  line: number | null;
}

/**
 * A page with one fence, drawn the way `mermaidPass` draws it, with the
 * resolver bundled in. Every scenario below is "create here, resolve there".
 */
async function withDrawnPage<T>(
  bundle: string,
  markdown: string,
  theme: "neutral" | "dark",
  fn: (page: import("playwright").Page) => Promise<T>,
): Promise<T> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{max-width:620px;margin:40px auto;font-family:sans-serif}
pre.rex-mermaid[data-rendered]{white-space:normal;font-family:inherit;text-align:center;background:none;padding:0}
pre.rex-mermaid[data-rendered] svg{max-width:100%;height:auto}
</style></head><body>${renderMarkdown(markdown)}</body></html>`;
  const file = join(
    tmpdir(),
    `rex-diagram-${process.pid}-${Math.random().toString(36).slice(2)}.html`,
  );
  writeFileSync(file, html);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on("pageerror", (error) => console.error("[page]", error.message));
    await page.goto(pathToFileURL(file).href);
    await page.addScriptTag({ path: join(REPO, "node_modules/mermaid/dist/mermaid.min.js") });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(async (theme) => {
      const w = window as any;
      w.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
      for (const block of document.querySelectorAll<HTMLElement>("pre.rex-mermaid")) {
        block.dataset.source ??= block.textContent ?? "";
        const { svg } = await w.mermaid.render(`${block.id}-svg`, block.dataset.source);
        block.innerHTML = svg;
        block.dataset.rendered = "true";
      }
    }, theme);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

function createInPage(parts: DiagramPart[]): Array<Anchor | null> {
  const rex = (window as any).__rexAnchor;
  const block = document.querySelector<HTMLElement>("pre.rex-mermaid")!;
  return parts.map((part) => rex.createDiagramAnchor(block, part, "/doc.md"));
}

function resolveInPage(anchors: Anchor[]): Landed[] {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);
  return anchors.map((anchor) => {
    const resolution = rex.resolveAnchor(index, anchor);
    const el = resolution?.kind === "element" ? (resolution.element as Element) : null;
    return {
      layer: resolution ? resolution.layer : null,
      state: rex.anchorStateFor(resolution, false),
      landedOn: el ? `${el.tagName.toLowerCase()}#${el.id}` : null,
      line: resolution?.line ?? null,
    };
  });
}

const MD = (fence: string, before = "Some prose before the diagram."): string =>
  `# A page\n\n${before}\n\n\`\`\`mermaid\n${fence}\n\`\`\`\n\nSome prose after.\n`;

test("in Chromium: the part map finds every part, and a diagram anchor resolves as §5.4 says", async () => {
  const built = await esbuild.build({
    entryPoints: [join(REPO, "src/renderer/anchor/index.ts")],
    bundle: true,
    format: "iife",
    globalName: "__rexAnchor",
    write: false,
    platform: "browser",
    target: "chrome120",
  });
  const bundle = built.outputFiles[0].text;

  // §5.5 — an element for every part of all three fixtures, after a draw and
  // after a redraw on the other theme.
  for (const fixture of [FLOWCHART, PROBE, SPEC_01.source]) {
    for (const theme of ["neutral", "dark"] as const) {
      const missing = await withDrawnPage(bundle, MD(fixture), theme, (page) =>
        page.evaluate(() => {
          const rex = (window as any).__rexAnchor;
          const block = document.querySelector<HTMLElement>("pre.rex-mermaid")!;
          const parts = rex.partsOf(block);
          const svg = block.querySelector("svg")!;
          const map: Map<string, Element> = rex.partElements(svg, parts);
          const wanted: string[] = [];
          for (const id of parts.nodes.keys()) wanted.push(`node:${id}`);
          for (const e of parts.edges) wanted.push(`edge:${e.from}>${e.to}#${e.ordinal}`);
          for (const s of parts.subgraphs) wanted.push(`subgraph:${s.id}`);
          const found = wanted.filter((key) => map.has(key));
          const distinct = new Set([...map.values()]).size;
          return { missing: wanted.filter((key) => !map.has(key)), found: found.length, distinct };
        }),
      );
      assert.deepEqual(missing.missing, [], `every part drawn on ${theme}`);
      assert.equal(missing.distinct, missing.found, "no two parts share an element");
    }
  }

  // The two `my-node --> B` edges map to two paths in source order.
  const pair = await withDrawnPage(bundle, MD(PROBE), "neutral", (page) =>
    page.evaluate(() => {
      const rex = (window as any).__rexAnchor;
      const block = document.querySelector<HTMLElement>("pre.rex-mermaid")!;
      const map: Map<string, Element> = rex.partElements(
        block.querySelector("svg"),
        rex.partsOf(block),
      );
      const first = map.get("edge:my-node>B#0");
      const second = map.get("edge:my-node>B#1");
      const all = [...document.querySelectorAll("path[data-edge]")];
      return {
        distinct: first !== second,
        order: first && second ? all.indexOf(first) < all.indexOf(second) : false,
        ids: [first?.getAttribute("data-id"), second?.getAttribute("data-id")],
      };
    }),
  );
  assert.equal(pair.distinct, true);
  assert.equal(pair.order, true);
  assert.deepEqual(
    pair.ids,
    ["L_my-node_B_0", "L_my-node_B_2"],
    "Mermaid's suffix is not an ordinal",
  );

  // §5.4 — anchors made on the original.
  const PARTS: DiagramPart[] = [
    { kind: "node", id: "A" },
    { kind: "node", id: "B" },
    { kind: "edge", from: "B", to: "C", ordinal: 0 },
    { kind: "subgraph", id: "engine" },
    { kind: "lines", from: 6, to: 6 },
  ];
  const anchors = await withDrawnPage(bundle, MD(FLOWCHART), "neutral", (page) =>
    page.evaluate(createInPage, PARTS),
  );
  assert.ok(anchors.every((a) => a !== null));
  const made = anchors as Anchor[];
  assert.equal(made[0].source?.line, 5 + 2, "node A is on line 7 of the file");
  assert.equal(made[4].source?.line, 5 + 6, "the lines part is on line 11");
  assert.equal(made[0].quote, null);
  assert.equal(made[0].element?.id, "mermaid-5");

  const resolveOn = (fence: string, before?: string, theme: "neutral" | "dark" = "neutral") =>
    withDrawnPage(bundle, MD(fence, before), theme, (page) => page.evaluate(resolveInPage, made));

  // Untouched, and redrawn dark: layer 1, ok, the part's own element.
  for (const theme of ["neutral", "dark"] as const) {
    const same = await resolveOn(FLOWCHART, undefined, theme);
    assert.deepEqual(
      same.map((r) => [r.layer, r.state]),
      PARTS.map(() => [1, "ok"]),
      `untouched on ${theme}`,
    );
    assert.equal(same[0].landedOn, "g#mermaid-5-svg-flowchart-A-0");
    assert.equal(same[1].landedOn, "g#mermaid-5-svg-flowchart-B-1");
    assert.equal(same[2].landedOn, "path#mermaid-5-svg-L_B_C_0");
    assert.equal(same[3].landedOn, "g#mermaid-5-svg-engine");
    assert.equal(same[4].landedOn, "pre#mermaid-5", "a lines part is outlined as the diagram");
    assert.deepEqual(
      same.map((r) => r.line),
      [7, 7, 8, 10, 11],
    );
  }

  // B's label edited on A's line: the fence changed, every named part is still there.
  const relabelled = await resolveOn(FLOWCHART.replace("Has comment?", "Decision?"));
  assert.deepEqual(
    relabelled.slice(0, 4).map((r) => [r.layer, r.state]),
    [
      [3, "ok"],
      [3, "ok"],
      [3, "ok"],
      [3, "ok"],
    ],
  );
  assert.equal(
    relabelled[1].landedOn,
    "g#mermaid-5-svg-flowchart-B-1",
    "the same node, relabelled",
  );
  assert.deepEqual(
    [relabelled[4].layer, relabelled[4].state],
    [2, "moved"],
    "lines in a changed fence",
  );

  // A paragraph inserted above AND a label changed: the <pre> id moved, found by search.
  const shifted = await resolveOn(
    FLOWCHART.replace("Has comment?", "Decision?"),
    "One paragraph.\n\nAnother paragraph.",
  );
  assert.deepEqual(
    shifted.map((r) => [r.layer, r.state]),
    PARTS.map(() => [2, "moved"]),
  );
  assert.equal(shifted[0].landedOn, "g#mermaid-7-svg-flowchart-A-0");
  assert.equal(shifted[0].line, 9, "the line moved with the fence");

  // A paragraph inserted above and nothing else: the fingerprint finds it. Still ok.
  const onlyShifted = await resolveOn(FLOWCHART, "One paragraph.\n\nAnother paragraph.");
  assert.deepEqual(
    onlyShifted.map((r) => [r.layer, r.state]),
    PARTS.map(() => [1, "ok"]),
  );

  // B renamed everywhere: a new node. B and B→C are orphaned; A is still A.
  const renamed = await resolveOn(FLOWCHART.replaceAll("B", "Decision"));
  assert.deepEqual([renamed[0].layer, renamed[0].state], [3, "ok"]);
  assert.deepEqual([renamed[1].layer, renamed[1].state], [null, "orphaned"]);
  assert.deepEqual([renamed[2].layer, renamed[2].state], [null, "orphaned"]);
  assert.equal(renamed[1].landedOn, null, "never the node that took B's place");

  // The lines part's text rewritten: orphaned, not the line that is there now.
  const rewritten = await resolveOn(FLOWCHART.replace("C --> E[(rex.db)]", "C --> E[(the store)]"));
  assert.deepEqual([rewritten[4].layer, rewritten[4].state], [null, "orphaned"]);

  // The fence deleted outright: everything orphaned.
  const deleted = await withDrawnPage(bundle, "# A page\n\nNo diagram here.\n", "neutral", (page) =>
    page.evaluate(resolveInPage, made),
  );
  assert.ok(deleted.every((r) => r.state === "orphaned"));
});

// ── The agent's sentence ────────────────────────────────────────

test("passageSection tells the agent the part in the words of the source, with the file's lines", async () => {
  const { passageSection } = await import("../src/main/agent/prompts.ts");
  const file = join(tmpdir(), `rex-diagram-prompt-${process.pid}.md`);
  writeFileSync(file, MD(FLOWCHART));
  const anchorFor = (part: DiagramPart): Anchor => {
    const diagram = makeDiagramRef(FLOWCHART, part);
    assert.ok(diagram);
    return {
      quote: null,
      position: null,
      element: { id: "mermaid-5", css: "#mermaid-5" },
      region: null,
      source: { file, line: 5 + diagram.lines.from },
      diagram,
    };
  };
  const targets = [
    { kind: "node", id: "B" },
    { kind: "edge", from: "B", to: "C", ordinal: 0 },
    { kind: "lines", from: 5, to: 7 },
  ] as DiagramPart[];
  const thread = {
    id: "t1",
    documentId: "d1",
    kind: "anchored",
    status: "open",
    targets: targets.map((part) => ({
      documentId: "d1",
      anchor: anchorFor(part),
      state: null,
      messageId: null,
    })),
    note: "why?",
    title: null,
    groupId: null,
    position: 0,
    isNote: false,
    sessionId: null,
    profile: "read",
    refThreadIds: [],
    createdAt: "",
    updatedAt: "",
    resolvedAt: null,
  } as const;
  const text = passageSection({
    thread: thread as never,
    documentPaths: new Map([["d1", file]]),
    repositoryRoot: tmpdir(),
    heading: "## Highlighted passages",
  }).join("\n");

  // The document is named once, at the head of the prompt or as a `###` heading
  // (spec 24 §6.1); the sentence names the fence's lines in it.
  assert.match(text, /1\. In the Mermaid diagram \(flowchart\) at lines 6–12:/);
  assert.match(
    text,
    /the node B, labelled "Has comment\?" — declared on line 7:\n {7}A\[Reviewer\] --> B\{Has comment\?\}/,
  );
  assert.match(text, /It is also mentioned on lines 8 and 9\./);
  assert.match(
    text,
    /the edge from B to C, labelled "yes" — line 8:\n {7}B -- yes --> C\[Ask agent\]/,
  );
  assert.match(
    text,
    /lines 10–12:\n {7}subgraph engine \[The engine\]\n {7}C --> E\[\(rex\.db\)\]\n {7}end/,
  );
  // §5.8 — no second `— line N` after a diagram part: its description carries its lines.
  assert.doesNotMatch(text, /end\n.*— line \d+/);

  // The file moved on: two lines above the fence, and B relabelled. The agent
  // reads the lines as they are now.
  writeFileSync(file, MD(FLOWCHART.replace("Has comment?", "Decision?"), "One.\n\nTwo."));
  const moved = passageSection({
    thread: thread as never,
    documentPaths: new Map([["d1", file]]),
    repositoryRoot: tmpdir(),
    heading: null,
  }).join("\n");
  assert.match(moved, /at lines 8–14:/);
  assert.match(moved, /the node B, labelled "Decision\?" — declared on line 9:/);
});
