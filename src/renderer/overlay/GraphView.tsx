// Spec 02 §5.5 and §5.6, redrawn to design/screens/Graph.
//
// d3-force solves the layout and stays live: dragging a node reheats the
// simulation and its neighbours follow, which is the interaction d3-force
// exists for. Drawing is hand-written SVG and pan/zoom is a viewBox transform,
// so neither needs a second dependency.

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { GraphNode, ReferenceGraph } from "../../shared/types.ts";
import { Check } from "./Icons.tsx";
import { Splitter } from "./Splitter.tsx";

interface Props {
  graph: ReferenceGraph;
  /** The document currently selected anywhere in the app. */
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
}

interface LaidOutNode extends SimulationNodeDatum {
  id: string;
  /** Drawn under the node: the file name only. The full relative path is
   *  several times wider than the node and collides with its neighbours. */
  short: string;
  node: GraphNode;
  radius: number;
  /** Half the drawn label's width, so collision keeps labels apart too. */
  halfLabel: number;
}

type LaidOutLink = SimulationLinkDatum<LaidOutNode> & { count: number; fragments: string[] };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ticks run before the first paint, so the graph opens already framed. */
const WARMUP_TICKS = 300;
const PADDING = 60;
/** How hard a drag reheats the simulation. d3's own examples use 0.3. */
const DRAG_ALPHA = 0.3;
/** How many rows the ranked list shows before it stops being a ranking. */
const RANK_ROWS = 4;

/** §5.5 — radius carries where the unfinished discussion is. */
function radiusOf(node: GraphNode): number {
  return 7 + Math.min(15, (node.comments?.open ?? 0) * 3);
}

/** §5.5 — fill carries the state of that discussion, in the shared vocabulary. */
function fillOf(node: GraphNode): string {
  if (node.kind === "missing") return "none";
  if (node.kind === "external") return "#141d2b";
  if ((node.comments?.orphaned ?? 0) > 0) return "var(--lost)";
  if ((node.comments?.open ?? 0) > 0) return "var(--action)";
  return "var(--sunk)";
}

/**
 * §5.4 — an edge's weight is how many links it stands for, so a document cited
 * seven times from one place is visibly heavier than one cited once.
 */
function edgeWidth(count: number): number {
  return Math.min(8, 1.2 + (count - 1) * 1.2);
}

/** Every node one hop from `id`, plus `id` itself. */
function neighbourhood(graph: ReferenceGraph, id: string): Set<string> {
  const set = new Set<string>([id]);
  for (const edge of graph.edges) {
    if (edge.source === id) set.add(edge.target);
    if (edge.target === id) set.add(edge.source);
  }
  return set;
}

function build(
  graph: ReferenceGraph,
  isolated: string | null,
): { nodes: LaidOutNode[]; links: LaidOutLink[] } {
  const keep = isolated ? neighbourhood(graph, isolated) : null;

  const nodes: LaidOutNode[] = graph.nodes
    .filter((node) => !keep || keep.has(node.id))
    .map((node) => {
      const short = node.label.split("/").pop() ?? node.label;
      return {
        id: node.id,
        short,
        node,
        radius: radiusOf(node),
        // 10px type, roughly 0.52em per character.
        halfLabel: (short.length * 5.2) / 2,
      };
    });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links: LaidOutLink[] = graph.edges
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      count: edge.count,
      fragments: edge.fragments,
    }));

  return { nodes, links };
}

export function GraphView(props: Props): React.JSX.Element {
  const [hovered, setHovered] = useState<string | null>(null);
  const [sideWidth, setSideWidth] = useState(384);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  const svgRef = useRef<SVGSVGElement>(null);
  const simulation = useRef<Simulation<LaidOutNode, LaidOutLink> | null>(null);
  const dragNode = useRef<LaidOutNode | null>(null);
  const panFrom = useRef<{ x: number; y: number } | null>(null);

  // Rebuilt only when the graph or the isolation changes; selection never
  // re-lays it out.
  const { nodes, links } = useMemo(() => build(props.graph, isolated), [props.graph, isolated]);

  /**
   * The box that holds every node *right now*.
   *
   * Deliberately not memoised on `nodes`: that array keeps its identity for the
   * lifetime of the graph while d3 mutates the coordinates inside it, so a memo
   * would be computed once — from the zeroes the nodes hold before the
   * simulation has run — and never again.
   */
  const frameNodes = useCallback((): Box => {
    if (nodes.length === 0) return { x: -300, y: -200, width: 600, height: 400 };
    const xs = nodes.map((node) => node.x ?? 0);
    const ys = nodes.map((node) => node.y ?? 0);
    const minX = Math.min(...xs) - PADDING;
    const minY = Math.min(...ys) - PADDING;
    return {
      x: minX,
      y: minY,
      width: Math.max(200, Math.max(...xs) + PADDING - minX),
      height: Math.max(200, Math.max(...ys) + PADDING - minY),
    };
  }, [nodes]);

  const [framed, setFramed] = useState<Box>(frameNodes);
  // null means "showing the framed box"; a pan or zoom takes over from there.
  const [view, setView] = useState<Box | null>(null);
  const box = view ?? framed;

  const fit = useCallback(() => {
    setFramed(frameNodes());
    setView(null);
  }, [frameNodes]);

  useEffect(() => {
    const sim = forceSimulation(nodes)
      .force(
        "link",
        forceLink<LaidOutNode, LaidOutLink>(links)
          .id((node) => node.id)
          .distance(110)
          .strength(0.35),
      )
      .force("charge", forceManyBody().strength(-320))
      .force("center", forceCenter(0, 0))
      // Disconnected components repel each other with nothing pulling them
      // back, so a corpus in two clusters spreads until the drawing is mostly
      // empty space. A weak pull toward the origin keeps them apart without
      // letting them drift.
      .force("x", forceX(0).strength(0.06))
      .force("y", forceY(0).strength(0.06))
      .force(
        "collide",
        // Labels are wider than the nodes they sit under, so collision has to
        // clear the label or the drawing overlaps however well the graph solves.
        forceCollide<LaidOutNode>().radius((node) =>
          Math.max(node.radius + 26, node.halfLabel + 10),
        ),
      )
      .stop();

    // Settle before the first paint so the view opens framed and still, then
    // stay alive: a drag reheats it from here.
    sim.tick(WARMUP_TICKS);
    sim.on("tick", repaint);
    simulation.current = sim;
    // The warm-up has just moved every node, so the frame has to be taken now
    // rather than from the coordinates they held before it ran.
    setFramed(frameNodes());
    setView(null);
    repaint();

    return () => {
      sim.on("tick", null);
      sim.stop();
      simulation.current = null;
    };
  }, [nodes, links, frameNodes]);

  const boxRef = useRef(box);
  boxRef.current = box;

  // Attached by hand rather than through onWheel: React registers wheel
  // listeners as passive, so preventDefault() there is silently ignored.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
      const base = boxRef.current;
      setView({
        x: base.x + (base.width * (1 - factor)) / 2,
        y: base.y + (base.height * (1 - factor)) / 2,
        width: base.width * factor,
        height: base.height * factor,
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /** Screen coordinates → graph coordinates, letterboxing and zoom included. */
  const toGraph = (event: React.PointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const drag = (node: LaidOutNode, event: React.PointerEvent): void => {
    const point = toGraph(event);
    if (!point) return;
    // Pinning is what makes the rest of the graph respond, rather than the
    // node simply being teleported.
    node.fx = point.x;
    node.fy = point.y;
    // Moved directly as well as pinned: the simulation would otherwise only
    // catch up on its next tick, so the node would lag the cursor — and a tick
    // is a requestAnimationFrame, which does not run at all while the window is
    // hidden. Dragging still tracks the pointer either way.
    node.x = point.x;
    node.y = point.y;
    repaint();
    simulation.current?.alphaTarget(DRAG_ALPHA).restart();
  };

  const release = (): void => {
    const node = dragNode.current;
    if (!node) return;
    // Released back into the simulation rather than left pinned, so the graph
    // keeps one consistent layout.
    node.fx = null;
    node.fy = null;
    simulation.current?.alphaTarget(0);
    dragNode.current = null;
  };

  // ── Selection ───────────────────────────────────────────────

  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!props.selectedPath) return set;
    for (const edge of props.graph.edges) {
      if (edge.source === props.selectedPath) set.add(edge.target);
      if (edge.target === props.selectedPath) set.add(edge.source);
    }
    return set;
  }, [props.graph, props.selectedPath]);

  const hasSelection =
    props.selectedPath !== null && nodes.some((node) => node.id === props.selectedPath);

  const nodeClass = (node: LaidOutNode): string => {
    const classes = ["rex-graph-node", `rex-graph-${node.node.kind}`];
    if (!hasSelection) return classes.join(" ");
    if (node.id === props.selectedPath) classes.push("rex-graph-selected");
    else if (neighbours.has(node.id)) classes.push("rex-graph-neighbour");
    else classes.push("rex-graph-faded");
    return classes.join(" ");
  };

  const edgeClass = (source: string, target: string): string => {
    if (!hasSelection) return "rex-graph-edge";
    const touches = source === props.selectedPath || target === props.selectedPath;
    return `rex-graph-edge ${touches ? "rex-graph-edge-on" : "rex-graph-edge-faded"}`;
  };

  const selectedNode = props.graph.nodes.find((node) => node.id === props.selectedPath) ?? null;
  const hoveredNode = props.graph.nodes.find((node) => node.id === hovered) ?? null;
  const detail = hoveredNode ?? selectedNode;

  const documents = props.graph.nodes.filter((node) => node.kind === "document").length;
  const external = props.graph.nodes.filter((node) => node.kind === "external").length;

  const ranked = [...props.graph.nodes]
    .filter((node) => node.inLinks > 0)
    .sort((a, b) => b.inLinks - a.inLinks)
    .slice(0, RANK_ROWS);
  const busiest = ranked[0]?.inLinks ?? 1;

  const zoom = Math.round((framed.width / box.width) * 100);

  return (
    <div className="rex-graph">
      <div className="rex-graph-stage">
        <svg
          ref={svgRef}
          className="rex-graph-canvas"
          viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
          onPointerDown={(event) => {
            // Empty canvas pans; a node stops this from firing (see the node's
            // own onPointerDown).
            panFrom.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const node = dragNode.current;
            if (node) {
              drag(node, event);
              return;
            }
            const from = panFrom.current;
            if (!from) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const base = boxRef.current;
            setView({
              width: base.width,
              height: base.height,
              x: base.x - ((event.clientX - from.x) * base.width) / rect.width,
              y: base.y - ((event.clientY - from.y) * base.height) / rect.height,
            });
            panFrom.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={() => {
            release();
            panFrom.current = null;
          }}
          onPointerLeave={() => {
            panFrom.current = null;
          }}
          role="img"
          aria-label="Reference graph of the workspace"
        >
          <title>How the documents in this workspace reference each other</title>

          {links.map((link) => {
            const source = link.source as LaidOutNode;
            const target = link.target as LaidOutNode;
            return (
              <line
                key={`${source.id} ${target.id}`}
                className={edgeClass(source.id, target.id)}
                x1={source.x ?? 0}
                y1={source.y ?? 0}
                x2={target.x ?? 0}
                y2={target.y ?? 0}
                strokeWidth={edgeWidth(link.count)}
              >
                <title>
                  {`${link.count} link${link.count === 1 ? "" : "s"}: ${source.short} → ${target.short}`}
                  {link.fragments.length > 0 ? `\n#${link.fragments.join(", #")}` : ""}
                </title>
              </line>
            );
          })}

          {nodes.map((node) => (
            // The side panel's ranked list is the keyboard route to the same
            // selection, so the drawing itself stays pointer-only.
            <g
              key={node.id}
              className={nodeClass(node)}
              transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onPointerDown={(event) => {
                // Never let the canvas start a pan under a node drag.
                event.stopPropagation();
                dragNode.current = node;
                node.fx = node.x ?? 0;
                node.fy = node.y ?? 0;
              }}
              onPointerUp={release}
              onClick={() => props.onSelect(node.id)}
              onDoubleClick={() => {
                if (node.node.kind === "document") props.onOpen(node.id);
              }}
            >
              <circle r={node.radius} fill={fillOf(node.node)} />
              <text y={node.radius + 14} textAnchor="middle">
                {node.short}
              </text>
            </g>
          ))}
        </svg>

        <div className="rex-graph-legend">
          <span className="rex-legend-item">
            <span className="rex-legend-swatch" />
            document
          </span>
          <span className="rex-legend-item">
            <span className="rex-legend-swatch rex-legend-comments" />
            has comments
          </span>
          <span className="rex-legend-item">
            <span className="rex-legend-swatch rex-legend-missing" />
            missing target
          </span>
          <span className="rex-legend-item">
            <span className="rex-legend-edge" />
            drag to move · scroll to zoom
          </span>
        </div>

        <div className="rex-graph-zoom">
          <button type="button" onClick={fit}>
            Fit
          </button>
          <button type="button" onClick={fit} title="Reset the zoom">
            {Number.isFinite(zoom) ? zoom : 100}%
          </button>
        </div>
      </div>

      <Splitter
        width={sideWidth}
        min={240}
        max={620}
        direction={-1}
        label="the graph panel"
        onChange={setSideWidth}
      />

      <aside className="rex-graph-side" style={{ width: sideWidth }}>
        <header className="rex-side-head">
          <span className="rex-label">REFERENCE GRAPH</span>
          <span className="rex-spacer" />
          {isolated ? (
            <button type="button" className="rex-link" onClick={() => setIsolated(null)}>
              show all
            </button>
          ) : null}
        </header>

        <div className="rex-side-scroll">
          <div className="rex-stats">
            <div className="rex-stat">
              <span className="rex-stat-n">{documents}</span>
              <span className="rex-stat-label">DOCUMENTS</span>
            </div>
            <div className="rex-stat">
              <span className="rex-stat-n">{props.graph.edges.length}</span>
              <span className="rex-stat-label">EDGES</span>
            </div>
            <div
              className={
                props.graph.brokenLinks.length === 0
                  ? "rex-stat rex-stat-ok"
                  : "rex-stat rex-stat-lost"
              }
            >
              <span className="rex-stat-n">{props.graph.brokenLinks.length}</span>
              <span className="rex-stat-label">BROKEN</span>
            </div>
          </div>

          <p className="rex-meta">
            {external} external target{external === 1 ? "" : "s"} · {props.graph.externalUrlCount}{" "}
            URLs and {props.graph.assetLinkCount} assets not drawn
          </p>

          {detail ? (
            <div className="rex-node-card">
              <span className="rex-node-path">{detail.label}</span>
              <span className="rex-meta">
                {detail.inLinks} link{detail.inLinks === 1 ? "" : "s"} in from {detail.inDegree}{" "}
                document{detail.inDegree === 1 ? "" : "s"} · {detail.outDegree} out
                {detail.comments
                  ? ` · ${detail.comments.open} open, ${detail.comments.orphaned} orphaned`
                  : ""}
              </span>
              <div className="rex-row">
                <button
                  type="button"
                  className="rex-button rex-primary"
                  disabled={detail.kind !== "document"}
                  title={
                    detail.kind === "document"
                      ? "Open this document for review"
                      : "REX cannot open this target"
                  }
                  onClick={() => props.onOpen(detail.id)}
                >
                  Open document
                </button>
                <button
                  type="button"
                  className="rex-button"
                  onClick={() => setIsolated(isolated === detail.id ? null : detail.id)}
                >
                  {isolated === detail.id ? "Show all" : "Isolate"}
                </button>
              </div>
            </div>
          ) : (
            <p className="rex-meta">
              Click a node to select it and light up its links. Double-click a document to open it.
            </p>
          )}

          <div className="rex-ranks">
            <span className="rex-label">MOST REFERENCED</span>
            {/*
              Ranked by total incoming links, not in-degree. In a corpus where
              every document cites every other, in-degree saturates at "all of
              them" and hides the hub that link count makes obvious.
            */}
            {ranked.length === 0 ? (
              <p className="rex-meta">Nothing in this workspace links to anything else.</p>
            ) : (
              ranked.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={`rex-rank${node.id === props.selectedPath ? " rex-rank-on" : ""}`}
                  onClick={() => props.onSelect(node.id)}
                >
                  <span className="rex-rank-head">
                    <span className="rex-rank-n">{node.inLinks}</span>
                    <span className="rex-rank-path">{node.label}</span>
                  </span>
                  <span
                    className="rex-rank-bar"
                    style={{ width: `${Math.max(6, (node.inLinks / busiest) * 100)}%` }}
                  />
                </button>
              ))
            )}
          </div>

          <div className="rex-ranks">
            <span className="rex-label">BROKEN LINKS</span>
            {props.graph.brokenLinks.length === 0 ? (
              <p className="rex-allclear">
                <Check />
                None. Every link resolves.
              </p>
            ) : (
              props.graph.brokenLinks.map((link) => (
                <div key={`${link.from}:${link.line}:${link.href}`} className="rex-broken">
                  <code>{link.href}</code>
                  <span className="rex-meta">
                    {link.from.split("/").pop()}
                    {link.line === null ? "" : `:${link.line}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
