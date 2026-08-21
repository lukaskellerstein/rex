// Spec 07 §8.2 — the fact lens on the graph view.
//
// The same `d3-force` layout the reference graph already uses, with one
// addition: **each topic gets its own centre of gravity**, so communities
// separate visibly instead of by accident.
//
// §1.1 is the thing to keep in mind while reading this file: the graph picture
// is a second view of the same data. It is good for seeing shape and bad for
// doing work, and the findings list is the product. Nothing here may become the
// only way to reach something.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClaimEvidence } from "../../shared/channels.ts";
import type { Anchor, FactGraph as FactGraphData, FactNode } from "../../shared/types.ts";

interface Props {
  graph: FactGraphData;
  /** Clicking a claim opens its evidence — every document that states it. */
  onSelectClaim: (claimId: string) => void;
  selectedClaimId: string | null;
  /** §8.2 — jump to one of those documents, at the quote. */
  onOpenEvidence: (documentPath: string, anchor: Anchor) => void;
}

/**
 * §8.2's "clicking a claim node opens its evidence — every document that states
 * it", which is also §11 rule 4: no claim is ever displayed without at least one
 * quote and a way to jump to it. A claim the reviewer cannot check is worse than
 * no claim, so this panel is not optional decoration on the lens.
 */
function Evidence({
  claimId,
  label,
  onOpen,
  onClose,
}: {
  claimId: string;
  label: string;
  onOpen: (documentPath: string, anchor: Anchor) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<ClaimEvidence[] | null>(null);

  useEffect(() => {
    let live = true;
    void window.rex.factsEvidence({ claimId }).then((found) => {
      if (live) setRows(found);
    });
    return () => {
      live = false;
    };
  }, [claimId]);

  return (
    <div className="rex-fact-evidence">
      <div className="rex-fact-evidence-head">
        <strong>{label}</strong>
        <button type="button" className="rex-link" onClick={onClose}>
          close
        </button>
      </div>
      {rows === null ? <p className="rex-meta">Reading…</p> : null}
      {rows?.length === 0 ? (
        <p className="rex-meta">No evidence — this claim should not exist.</p>
      ) : null}
      <ul>
        {rows?.map((row) => (
          <li key={`${row.documentPath}-${row.quote}`}>
            <button type="button" onClick={() => onOpen(row.documentPath, row.anchor)}>
              <q>{row.quote}</q>
              <span className="rex-meta">{row.documentPath.split("/").pop()}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface LaidOut extends SimulationNodeDatum {
  id: string;
  node: FactNode;
  radius: number;
  label: string;
}

type Link = SimulationLinkDatum<LaidOut> & { kind: string };

/** Ticks run before the first paint, so the lens opens already framed. */
const WARMUP_TICKS = 300;
const PADDING = 48;

/**
 * §3.3 — the edge colours, and the one structural edge that is not drawn as an
 * edge at all.
 *
 * `about` connects a claim to its subject. It is structure, not a finding, so it
 * is drawn as a faint tether rather than in a colour that competes with a red
 * contradiction.
 */
const EDGE_STYLE: Record<string, { stroke: string; width: number; dash?: string }> = {
  about: { stroke: "var(--rule)", width: 1 },
  // The design system spends red on exactly two things so it never stops meaning
  // "look at this" (overlay.css header). A contradiction is the third, and it
  // earns it: it is the one output §1.1 says this whole feature exists for.
  contradicts: { stroke: "var(--lost)", width: 2 },
  refines: { stroke: "var(--muted)", width: 1.5, dash: "4 3" },
  supersedes: { stroke: "var(--moved)", width: 2 },
};

/**
 * Topic colours. Deliberately a small fixed wheel rather than a generated ramp:
 * the lens is read at a glance, and a reader can hold six or seven hues apart.
 * Beyond that they run together and the colour stops carrying information, so it
 * wraps rather than inventing more.
 */
const TOPIC_COLOURS = ["#6f9fe0", "#63b09a", "#c9a35e", "#9b8ad4", "#57a8b8", "#c98ba8", "#a8ac6a"];

function topicColour(topicId: number | null): string {
  if (topicId === null) return "var(--muted)";
  return TOPIC_COLOURS[topicId % TOPIC_COLOURS.length];
}

/** A claim sized by how many documents state it (§9.1 `evidenceCount`). */
function radiusOf(node: FactNode): number {
  if (node.kind === "subject") return 5;
  return 6 + Math.min(10, Math.sqrt(node.evidenceCount) * 3);
}

function shorten(label: string, max = 28): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function FactGraph(props: Props): React.JSX.Element {
  const [, redraw] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(240, entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { nodes, links } = useMemo(() => {
    const laidOut: LaidOut[] = props.graph.nodes.map((node) => ({
      id: node.id,
      node,
      radius: radiusOf(node),
      label: shorten(node.label),
    }));
    const byId = new Map(laidOut.map((node) => [node.id, node]));
    const edges: Link[] = props.graph.edges
      .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
      .map((edge) => ({
        source: byId.get(edge.source) as LaidOut,
        target: byId.get(edge.target) as LaidOut,
        kind: edge.kind,
      }));
    return { nodes: laidOut, links: edges };
  }, [props.graph]);

  useEffect(() => {
    if (nodes.length === 0) return;

    // §8.2 — a centre of gravity per topic. Without it d3 packs every community
    // into one ball and the topics are a colour legend rather than a shape.
    const topics = [...new Set(nodes.map((n) => n.node.topicId).filter((id) => id !== null))];
    const angle = (topicId: number | null): number => {
      const index = topicId === null ? topics.length : topics.indexOf(topicId);
      return (index / Math.max(1, topics.length + 1)) * Math.PI * 2;
    };
    const spread = Math.min(size.width, size.height) * 0.32;

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<LaidOut, Link>(links)
          .id((node) => node.id)
          // A claim sits close to its subject; a contradiction is a longer,
          // looser tie, because the two claims belong to different documents and
          // pulling them together hides the very gap being reported.
          .distance((link) => (link.kind === "about" ? 26 : 90))
          .strength((link) => (link.kind === "about" ? 1 : 0.2)),
      )
      .force("charge", forceManyBody().strength(-160))
      .force(
        "collide",
        forceCollide<LaidOut>().radius((node) => node.radius + 14),
      )
      .force(
        "x",
        forceX<LaidOut>()
          .x((node) => size.width / 2 + Math.cos(angle(node.node.topicId)) * spread)
          .strength(0.12),
      )
      .force(
        "y",
        forceY<LaidOut>()
          .y((node) => size.height / 2 + Math.sin(angle(node.node.topicId)) * spread)
          .strength(0.12),
      );

    simulation.tick(WARMUP_TICKS);
    simulation.on("tick", () => redraw((n) => n + 1));
    redraw((n) => n + 1);
    return () => {
      simulation.stop();
    };
  }, [nodes, links, size.width, size.height]);

  const viewBox = useMemo(() => {
    if (nodes.length === 0) return `0 0 ${size.width} ${size.height}`;
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - PADDING;
    const minY = Math.min(...ys) - PADDING;
    return `${minX} ${minY} ${Math.max(...xs) - minX + PADDING} ${Math.max(...ys) - minY + PADDING}`;
  }, [nodes, size.width, size.height]);

  if (props.graph.nodes.length === 0) {
    return (
      <p className="rex-meta rex-graph-loading">
        Nothing to draw yet — build the fact graph from the Facts tab.
      </p>
    );
  }

  return (
    <div className="rex-fact-graph" ref={frame}>
      <svg viewBox={viewBox} role="img" aria-label="What these documents claim">
        <title>What these documents claim</title>
        {links.map((link) => {
          const source = link.source as LaidOut;
          const target = link.target as LaidOut;
          const style = EDGE_STYLE[link.kind] ?? EDGE_STYLE.about;
          return (
            <line
              key={`${source.id}-${target.id}-${link.kind}`}
              x1={source.x ?? 0}
              y1={source.y ?? 0}
              x2={target.x ?? 0}
              y2={target.y ?? 0}
              stroke={style.stroke}
              strokeWidth={style.width}
              strokeDasharray={style.dash}
            />
          );
        })}

        {nodes.map((node) => (
          <g
            key={node.id}
            transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
            className={node.node.kind === "claim" ? "rex-fact-node" : undefined}
            onClick={() => node.node.kind === "claim" && props.onSelectClaim(node.id)}
          >
            <circle
              r={node.radius}
              fill={node.node.kind === "subject" ? "none" : topicColour(node.node.topicId)}
              stroke={topicColour(node.node.topicId)}
              strokeWidth={node.node.kind === "subject" ? 2 : 1}
              // §9.1 — a superseded claim is drawn faded rather than removed.
              // The history stays: §3.4's whole point is that a closed window is
              // still visible.
              opacity={node.node.live ? 1 : 0.35}
              strokeDasharray={node.id === props.selectedClaimId ? "3 2" : undefined}
            />
            <text
              y={node.radius + 11}
              textAnchor="middle"
              className={node.node.kind === "subject" ? "rex-fact-subject" : "rex-fact-claim"}
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>

      {props.selectedClaimId ? (
        <Evidence
          claimId={props.selectedClaimId}
          label={
            props.graph.nodes.find((node) => node.id === props.selectedClaimId)?.label ?? "claim"
          }
          onOpen={props.onOpenEvidence}
          onClose={() => props.onSelectClaim("")}
        />
      ) : null}

      {props.graph.topics.length > 0 ? (
        <ul className="rex-fact-legend">
          {props.graph.topics.map((topic) => (
            <li key={topic.id}>
              <span className="rex-swatch" style={{ background: topicColour(topic.id) }} />
              {topic.name}
              <span className="rex-meta"> · {topic.subjectCount}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
