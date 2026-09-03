// Spec 29 §5.5 — the part map: which SVG element each part of a drawn
// Mermaid diagram became, worked out on demand from the ids Mermaid derives
// from the source. Stored nowhere: not on the elements (spec 10 §2.2 — an added
// attribute changes `outerHTML` and orphans every region on the drawing), not
// in a cache. Spec 27 §4.5 redraws the diagram when the paper changes, and a
// map computed at the moment it is asked for is a map that is right.
//
// The shapes below were measured against mermaid 11.17.0 on 2026-09-01. A
// version that moves them makes this file return fewer entries and nothing
// else breaks: `resolveDiagram` falls back to the `<pre>`, the place resolves,
// and the outline is the whole diagram until the lookup is taught the new
// shape. `test/diagram.spec.ts` pins them so the change is found by a test.
//
// Pure DOM on purpose. It runs inside the document frame, and it holds nothing
// React, IPC or database shaped.

import {
  type DiagramParts,
  edgeOf,
  fenceText,
  isFlowchart,
  partKey,
  scanDiagram,
} from "../../shared/diagram.ts";
import type { DiagramPart } from "../../shared/types.ts";

/** A diagram REX drew. A `pre.rex-mermaid` without `data-rendered` is still its own source text. */
export const DRAWN_DIAGRAM = "pre.rex-mermaid[data-rendered]";

/** How close to an edge's stroke the pointer has to be, in CSS pixels (§4.1). */
const EDGE_TOLERANCE = 6;

/** How many points along a path are measured against the pointer. */
const EDGE_SAMPLES = 40;

/** The drawn diagram an element sits in, or null. The `<pre>` itself counts. */
export function diagramOf(el: Element | null): HTMLElement | null {
  return (el?.closest(DRAWN_DIAGRAM) as HTMLElement | null) ?? null;
}

/** The fence's text — kept on the block since spec 27 §4.5; the block's own text before it drew. */
export function sourceOf(block: HTMLElement): string {
  return fenceText(block.dataset.source ?? block.textContent ?? "");
}

/** The line the fence opens on, from the stamp the Markdown renderer left (spec 03 §5.3). */
export function fenceLineOf(block: Element): number | null {
  const line = Number.parseInt(block.getAttribute("data-src-line") ?? "", 10);
  return Number.isFinite(line) && line > 0 ? line : null;
}

/**
 * The scan of a block's source. Scanning is a few hundred microseconds and
 * the source changes only when the block is redrawn from a new fence, so the
 * result is kept per block **keyed by the source string** — a different fence
 * is a different scan, and nothing here is DOM state.
 */
const scans = new WeakMap<Element, { source: string; parts: DiagramParts }>();

export function partsOf(block: HTMLElement): DiagramParts {
  const source = sourceOf(block);
  const held = scans.get(block);
  if (held && held.source === source) return held.parts;
  const parts = scanDiagram(source);
  scans.set(block, { source, parts });
  return parts;
}

/** The drawing itself. `querySelector("svg")` is already typed as the SVG root. */
function svgOf(block: Element): SVGSVGElement | null {
  return block.querySelector("svg");
}

/** `<svgId>-flowchart-<nodeId>-<n>` — the remainder after the known prefix must be digits. */
function endsInCounter(id: string, prefix: string): boolean {
  return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length));
}

/**
 * The edge paths between two nodes, in DOM order — which is source order.
 *
 * Mermaid's own suffix is **not** an ordinal: two edges `my-node --> B` drew as
 * `L_my-node_B_0` and `L_my-node_B_2` (measured 2026-09-01). The scanner's
 * ordinal is matched to DOM order instead.
 */
function edgePaths(svg: SVGSVGElement, from: string, to: string): Element[] {
  const prefix = `L_${from}_${to}_`;
  return [...svg.querySelectorAll("path[data-edge]")].filter((path) =>
    endsInCounter(path.getAttribute("data-id") ?? "", prefix),
  );
}

/**
 * §5.5 — every part that has an element in this drawing, keyed by `partKey`.
 *
 * Only flowchart parts are looked up in this version (§4.3); every other kind
 * returns an empty map, and the whole diagram is what a pointer finds there.
 */
export function partElements(svg: SVGSVGElement, parts: DiagramParts): Map<string, Element> {
  const map = new Map<string, Element>();
  if (!isFlowchart(parts.type)) return map;
  const svgId = svg.id;

  const nodes = [...svg.querySelectorAll("g.node[id]")];
  for (const id of parts.nodes.keys()) {
    const prefix = `${svgId}-flowchart-${id}-`;
    const found = nodes.find((g) => endsInCounter(g.id, prefix));
    if (found) map.set(partKey({ kind: "node", id }), found);
  }

  for (const edge of parts.edges) {
    const paths = edgePaths(svg, edge.from, edge.to);
    const found = paths[Math.min(edge.ordinal, paths.length - 1)];
    if (found) {
      map.set(
        partKey({ kind: "edge", from: edge.from, to: edge.to, ordinal: edge.ordinal }),
        found,
      );
    }
  }

  for (const subgraph of parts.subgraphs) {
    const cluster = [...svg.querySelectorAll("g.cluster[id]")].find(
      (g) => g.id === `${svgId}-${subgraph.id}`,
    );
    if (cluster) map.set(partKey({ kind: "subgraph", id: subgraph.id }), cluster);
  }

  return map;
}

/** The element a part became in this block's drawing, or null when the map has none for it. */
export function elementForPart(block: HTMLElement, part: DiagramPart): Element | null {
  const svg = svgOf(block);
  if (!svg) return null;
  return partElements(svg, partsOf(block)).get(partKey(part)) ?? null;
}

/** The edge an edge-label's `data-id` names, matched against the scanner's edges — never parsed. */
function edgeFromDataId(parts: DiagramParts, dataId: string): DiagramPart | null {
  // The longest `L_<from>_<to>_` prefix wins, so `L_my_node_B_0` with a node
  // `my_node` beats a coincidental `my` → `node_B`.
  let best: { from: string; to: string; length: number } | null = null;
  const seen = new Set<string>();
  for (const edge of parts.edges) {
    const pair = `${edge.from} ${edge.to}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const prefix = `L_${edge.from}_${edge.to}_`;
    if (endsInCounter(dataId, prefix) && (!best || prefix.length > best.length)) {
      best = { from: edge.from, to: edge.to, length: prefix.length };
    }
  }
  return best ? { kind: "edge", from: best.from, to: best.to, ordinal: 0 } : null;
}

/**
 * The part an element inside the drawing belongs to, by walking up to the
 * node, cluster or edge label it is drawn in. Null on the diagram's ground.
 */
export function partFromElement(block: HTMLElement, el: Element | null): DiagramPart | null {
  const svg = svgOf(block);
  if (!svg || !el || !block.contains(el)) return null;
  return partOfElement(svg, partsOf(block), el);
}

/**
 * The same walk over any drawing of the source — the copy the lightbox holds
 * as much as the block in the document (spec 29 §4.2).
 */
export function partOfElement(
  svg: SVGSVGElement,
  parts: DiagramParts,
  el: Element | null,
): DiagramPart | null {
  if (!el || !svg.contains(el) || !isFlowchart(parts.type)) return null;
  const map = partElements(svg, parts);
  const byElement = new Map<Element, string>();
  for (const [key, element] of map) byElement.set(element, key);

  const nodeOrCluster = el.closest("g.node, g.cluster, path[data-edge]");
  if (nodeOrCluster) {
    const key = byElement.get(nodeOrCluster);
    if (key) return partFromKey(parts, key);
  }
  const label = el.closest("g.label[data-id], g.edgeLabel[data-id]");
  if (label) {
    const found = edgeFromDataId(parts, label.getAttribute("data-id") ?? "");
    if (found?.kind === "edge") return withOrdinalOf(svg, parts, label, found);
  }
  return null;
}

/** Which of several same-pair edges a label belongs to: the one whose `data-id` it shares. */
function withOrdinalOf(
  svg: SVGSVGElement,
  parts: DiagramParts,
  label: Element,
  edge: DiagramPart & { kind: "edge" },
): DiagramPart {
  const paths = edgePaths(svg, edge.from, edge.to);
  const at = paths.findIndex(
    (path) => path.getAttribute("data-id") === label.getAttribute("data-id"),
  );
  const ordinal = at >= 0 ? at : 0;
  const known = edgeOf(parts, { ...edge, ordinal });
  return { kind: "edge", from: edge.from, to: edge.to, ordinal: known?.ordinal ?? ordinal };
}

function partFromKey(parts: DiagramParts, key: string): DiagramPart | null {
  const [kind, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "node") return { kind: "node", id: rest };
  if (kind === "subgraph") return { kind: "subgraph", id: rest };
  if (kind === "edge") {
    const hash = rest.lastIndexOf("#");
    const arrow = rest.lastIndexOf(">", hash);
    const from = rest.slice(0, arrow);
    const to = rest.slice(arrow + 1, hash);
    const ordinal = Number.parseInt(rest.slice(hash + 1), 10);
    const found = parts.edges.find((e) => e.from === from && e.to === to && e.ordinal === ordinal);
    return found ? { kind: "edge", from, to, ordinal } : null;
  }
  return null;
}

/**
 * The nearest edge stroke to a viewport point, within `EDGE_TOLERANCE`.
 *
 * `elementFromPoint` finds a two-pixel path about never (spec 29 §1.1), so
 * each edge is asked how far the pointer is from it: the nearest of a few dozen
 * points along the path, in the frame's own viewport coordinates.
 */
function nearestEdge(
  svg: SVGSVGElement,
  parts: DiagramParts,
  map: Map<string, Element>,
  x: number,
  y: number,
): { part: DiagramPart; element: Element } | null {
  let best: { part: DiagramPart; element: Element; distance: number } | null = null;
  for (const edge of parts.edges) {
    const part: DiagramPart = { kind: "edge", from: edge.from, to: edge.to, ordinal: edge.ordinal };
    const element = map.get(partKey(part));
    if (!(element instanceof svg.ownerDocument.defaultView!.SVGPathElement)) continue;
    const ctm = element.getScreenCTM();
    if (!ctm) continue;
    const total = element.getTotalLength();
    if (!(total > 0)) continue;
    for (let k = 0; k <= EDGE_SAMPLES; k++) {
      const at = element.getPointAtLength((total * k) / EDGE_SAMPLES);
      const point = svg.createSVGPoint();
      point.x = at.x;
      point.y = at.y;
      const screen = point.matrixTransform(ctm);
      const distance = Math.hypot(screen.x - x, screen.y - y);
      if (distance <= EDGE_TOLERANCE && (!best || distance < best.distance)) {
        best = { part, element, distance };
      }
    }
  }
  return best ? { part: best.part, element: best.element } : null;
}

/**
 * §4.1 — the part under a viewport point in this block's drawing, and the
 * element it is drawn as. Null on the diagram's ground, which the chain then
 * offers as the whole diagram.
 *
 * A label always wins over a stroke — a label has a box and a box is what the
 * reviewer aimed at — so the walk-up runs before the proximity test.
 */
export function partAt(
  block: HTMLElement,
  x: number,
  y: number,
): { part: DiagramPart; element: Element } | null {
  const svg = svgOf(block);
  if (!svg) return null;
  return partUnderPointer(svg, partsOf(block), block.ownerDocument.elementFromPoint(x, y), x, y);
}

/**
 * The same question over any drawing of the source, with the hit element
 * supplied — the lightbox lives in a shadow root and has to ask its own root
 * what is under the pointer (spec 29 §4.2).
 */
export function partUnderPointer(
  svg: SVGSVGElement,
  parts: DiagramParts,
  hit: Element | null,
  x: number,
  y: number,
): { part: DiagramPart; element: Element } | null {
  if (!isFlowchart(parts.type)) return null;
  const map = partElements(svg, parts);

  const part = partOfElement(svg, parts, hit);
  if (part) {
    // A cluster's box covers its nodes' ground, so a stroke near the pointer
    // still wins over the subgraph it is drawn inside.
    if (part.kind === "subgraph") {
      const edge = nearestEdge(svg, parts, map, x, y);
      if (edge) return edge;
    }
    const element = map.get(partKey(part));
    return element ? { part, element } : null;
  }
  return nearestEdge(svg, parts, map, x, y);
}
