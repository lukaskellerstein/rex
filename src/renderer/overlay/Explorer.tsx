// Spec 02 §4 — the workspace tree.
//
// Inside the shadow root like everything else REX draws (spec 01 §7), and
// holding no database handle: the counts arrive already aggregated.

import { useMemo, useState } from "react";
import type { TreeEntry, WorkspaceTree } from "../../shared/types.ts";
import { TriangleDown, TriangleRight } from "./Icons.tsx";

interface Props {
  tree: WorkspaceTree;
  width: number;
  activePath: string | null;
  onOpen: (path: string) => void;
  onReload: () => void;
}

/** Deep enough to show a docs folder's contents, shallow enough for a repo. */
const AUTO_EXPAND_DEPTH = 2;

function collectExpanded(entries: TreeEntry[], depth: number, into: Set<string>): void {
  for (const entry of entries) {
    if (entry.kind !== "directory") continue;
    if (depth < AUTO_EXPAND_DEPTH) into.add(entry.path);
    collectExpanded(entry.children, depth + 1, into);
  }
}

export function Explorer(props: Props): React.JSX.Element {
  const initial = useMemo(() => {
    const expanded = new Set<string>();
    collectExpanded(props.tree.entries, 0, expanded);
    return expanded;
  }, [props.tree]);

  const [expanded, setExpanded] = useState<Set<string>>(initial);
  const [manual, setManual] = useState(false);
  const open = manual ? expanded : initial;

  const toggle = (path: string): void => {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
    setManual(true);
  };

  const rows = (entries: TreeEntry[], depth: number): React.JSX.Element[] =>
    entries.flatMap((entry) => {
      const indent = { paddingLeft: `${12 + depth * 15}px` };

      if (entry.kind === "directory") {
        const isOpen = open.has(entry.path);
        return [
          <button
            key={entry.path}
            type="button"
            className="rex-tree-row rex-tree-dir"
            style={indent}
            onClick={() => toggle(entry.path)}
          >
            <span className="rex-tree-twisty">{isOpen ? <TriangleDown /> : <TriangleRight />}</span>
            <span className="rex-tree-name">{entry.name}</span>
          </button>,
          ...(isOpen ? rows(entry.children, depth + 1) : []),
        ];
      }

      if (entry.kind === "other") {
        return [
          // §4.1 — listed, greyed and not clickable. Hiding it would be worse:
          // a reviewer needs to see the PDF is there.
          <div
            key={entry.path}
            className="rex-tree-row rex-tree-other"
            style={indent}
            title={entry.disabledReason ?? undefined}
          >
            <span className="rex-tree-twisty" />
            <span className="rex-tree-name">{entry.name}</span>
          </div>,
        ];
      }

      const counts = entry.comments;
      return [
        <button
          key={entry.path}
          type="button"
          className={`rex-tree-row rex-tree-doc${props.activePath === entry.path ? " rex-tree-active" : ""}`}
          style={indent}
          onClick={() => props.onOpen(entry.path)}
        >
          <span className="rex-tree-twisty" />
          <span className="rex-tree-name">{entry.name}</span>
          {counts ? (
            // A dot and a number rather than a filled badge: twenty files with
            // badges down the right reads as a second, competing tree.
            <span className="rex-tree-counts">
              {counts.open > 0 ? (
                <>
                  <span className="rex-dot rex-dot-open" />
                  <span className="rex-count">{counts.open}</span>
                </>
              ) : null}
              {counts.resolved > 0 && counts.open === 0 ? (
                <>
                  <span className="rex-dot rex-dot-resolved" />
                  <span className="rex-count">{counts.resolved}</span>
                </>
              ) : null}
              {counts.orphaned > 0 ? (
                <>
                  <span className="rex-dot rex-dot-orphaned" />
                  <span className="rex-count rex-count-orphaned">{counts.orphaned}</span>
                </>
              ) : null}
            </span>
          ) : null}
        </button>,
      ];
    });

  return (
    <nav className="rex-explorer" style={{ width: props.width }}>
      <header className="rex-explorer-head">
        <span className="rex-label rex-explorer-root" title={props.tree.root}>
          WORKSPACE · {(props.tree.root.split("/").pop() || props.tree.root).toUpperCase()}
        </span>
        <button type="button" className="rex-link" onClick={props.onReload}>
          reload
        </button>
      </header>

      {props.tree.truncated ? (
        // §4.2 — a silently truncated tree reads exactly like a complete one.
        <p className="rex-explorer-warn">
          Tree truncated — this folder is larger than REX will scan. Some files are not listed.
        </p>
      ) : null}

      <div className="rex-tree">{rows(props.tree.entries, 0)}</div>
    </nav>
  );
}
