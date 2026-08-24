// Spec 02 §4 — the workspace tree.
//
// Inside the shadow root like everything else REX draws (spec 01 §7), and
// holding no database handle: the counts arrive already aggregated.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CommentCounts, TreeEntry, WorkspaceTree } from "../../shared/types.ts";
import { EyeOff, TriangleDown, TriangleRight } from "./Icons.tsx";

interface Props {
  tree: WorkspaceTree;
  width: number;
  activePath: string | null;
  /**
   * Spec 10 §3.5 — whether the folders REX skips on its own are listed.
   *
   * Not the reviewer's own exclusions. Those are always drawn, because a
   * decision that hides its own undo is a trap.
   */
  showSkipped: boolean;
  onOpen: (path: string) => void;
  onReload: () => void;
  /**
   * Spec 06 §4.3 — the whole file as one place in the selection panel.
   *
   * The tree is the only surface that can offer it for a file that is not on
   * screen: every other route to a document target goes through picking inside
   * the open document, and "is this whole file still accurate?" is a question
   * about a file you have not opened as often as one you have.
   */
  onSelectFile: (path: string) => void;
  /**
   * Spec 10 §3.4 — one path in or out of the review.
   *
   * `exclude: false` covers both "take that exclusion back" and "pull in a
   * folder REX skips by default", because from here they are the same gesture
   * on the same word. Which of the two it turns out to be is main's to decide.
   */
  onExclude: (path: string, exclude: boolean) => void;
  onToggleSkipped: () => void;
}

/** Which row the menu belongs to, and where the pointer opened it. */
interface MenuAt {
  entry: TreeEntry;
  x: number;
  y: number;
}

/** Deep enough to show a docs folder's contents, shallow enough for a repo. */
const AUTO_EXPAND_DEPTH = 2;

/**
 * A dot and a number rather than a filled badge: twenty files with badges down
 * the right reads as a second, competing tree.
 *
 * Its own component because an excluded document shows them too (spec 10 §3.3):
 * excluding narrows what REX looks at and never what it holds, so the count of
 * what would be left behind is exactly the number somebody needs to judge
 * whether the exclusion was right.
 */
function Counts({ counts }: { counts: CommentCounts }): React.JSX.Element {
  return (
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
  );
}

/** How long the row says "copied" before going quiet again. */
const COPIED_FLASH_MS = 1400;

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
  /** The row that was just copied, so it can say so for a moment. */
  const [copied, setCopied] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const flash = useRef(0);

  useEffect(() => () => window.clearTimeout(flash.current), []);

  /**
   * The menu closes on anything that is not choosing from it.
   *
   * A context menu that outlives the gesture that opened it is a context menu
   * that ends up over the wrong row: the tree scrolls, the workspace reloads,
   * and it is still sitting at the coordinates the pointer had. Capture phase,
   * so a pointer-down on a row closes it before that row's own handler runs.
   *
   * THE EXCEPTION IS THE MENU ITSELF, and getting that wrong made every item
   * inert. A native capture listener on `document` runs before React's own
   * delegated handlers, which are attached at the root — so a React
   * `onPointerDown` on the menu cannot stop this one, however early it looks in
   * the JSX. Pressing an item fired `pointerdown`, this closed the menu, React
   * unmounted the button, and the `click` that would have run its handler
   * landed on nothing at all.
   *
   * `composedPath()` rather than `contains(target)`: the menu lives inside
   * REX's shadow root (spec 01 §7), and an event crossing that boundary is
   * retargeted to the host — so `event.target` is the host element and a
   * containment test on it answers no for every click, including the ones
   * inside the menu.
   */
  useEffect(() => {
    if (!menu) return;
    const closeUnlessInside = (event: Event): void => {
      const inside = menuRef.current && event.composedPath().includes(menuRef.current);
      if (!inside) setMenu(null);
    };
    const close = (): void => setMenu(null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", closeUnlessInside, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeUnlessInside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  /**
   * The row's full path, on the clipboard.
   *
   * Every row has one, folders included: a path is what you paste into a
   * terminal, an issue or a prompt, and the tree is the only place in REX that
   * knows it. The copy is silent otherwise, so the row says "copied" for a
   * moment — a clipboard write nobody can see is a clipboard write nobody
   * trusts.
   */
  const copyPath = (path: string): void => {
    void navigator.clipboard.writeText(path).then(
      () => {
        setCopied(path);
        window.clearTimeout(flash.current);
        flash.current = window.setTimeout(() => setCopied(null), COPIED_FLASH_MS);
      },
      // Saying nothing is the right failure: the path is in the row's tooltip
      // either way, and a dialog over a right-click is worse than no copy.
      (error) => console.warn("[rex] could not copy the path", error),
    );
  };

  const openMenu = (event: React.MouseEvent, entry: TreeEntry): void => {
    // Electron shows no menu of its own here, but a page still must not act on
    // a gesture and let the platform act on it as well.
    event.preventDefault();
    event.stopPropagation();
    setMenu({ entry, x: event.clientX, y: event.clientY });
  };

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
      // The path on hover, and how to take it. Both are the same fact.
      const hint = `${entry.path}\nRight-click for path and selection`;
      const justCopied = copied === entry.path;

      if (entry.exclusion !== null) {
        const byHand = entry.exclusion === "user";
        return [
          // §3.5 — a rule the reviewer wrote stays in the tree; a default skip
          // appears only while the header's `skipped` link is on. Both are drawn
          // the same way, and neither is `.rex-tree-other`: that grey means "REX
          // cannot open this", which is a fact about the file. This is a
          // decision about the review, and an excluded folder is usually full of
          // documents REX reads perfectly well.
          //
          // A `div` rather than a `button`: there is nothing to open, and there
          // is nothing to expand either — the subtree was never walked, which is
          // both what makes an exclusion free and what keeps revealing
          // `node_modules` from costing the whole scan.
          <div
            key={entry.path}
            className={`rex-tree-row rex-tree-excluded${byHand ? " rex-tree-excluded-user" : ""}`}
            style={indent}
            title={`${entry.path}\n${
              byHand
                ? "Excluded from this review — right-click to include it"
                : "Skipped by REX unless you ask for it — right-click to include it"
            }`}
            onContextMenu={(event) => openMenu(event, entry)}
          >
            <span className="rex-tree-twisty">
              <EyeOff size={11} />
            </span>
            <span className="rex-tree-name">{entry.name}</span>
            {justCopied ? <span className="rex-tree-copied">copied</span> : null}
            {entry.comments && !justCopied ? <Counts counts={entry.comments} /> : null}
          </div>,
        ];
      }

      if (entry.kind === "directory") {
        const isOpen = open.has(entry.path);
        return [
          <button
            key={entry.path}
            type="button"
            className="rex-tree-row rex-tree-dir"
            style={indent}
            title={hint}
            onClick={() => toggle(entry.path)}
            onContextMenu={(event) => openMenu(event, entry)}
          >
            <span className="rex-tree-twisty">{isOpen ? <TriangleDown /> : <TriangleRight />}</span>
            <span className="rex-tree-name">{entry.name}</span>
            {justCopied ? <span className="rex-tree-copied">copied</span> : null}
          </button>,
          ...(isOpen ? rows(entry.children, depth + 1) : []),
        ];
      }

      if (entry.kind === "other") {
        return [
          // §4.1 — listed, greyed and not clickable. Hiding it would be worse:
          // a reviewer needs to see the PDF is there. Its path still copies:
          // being unopenable is exactly when you want to point at it elsewhere.
          <div
            key={entry.path}
            className="rex-tree-row rex-tree-other"
            style={indent}
            title={entry.disabledReason ? `${entry.disabledReason}\n${hint}` : hint}
            onContextMenu={(event) => openMenu(event, entry)}
          >
            <span className="rex-tree-twisty" />
            <span className="rex-tree-name">{entry.name}</span>
            {justCopied ? <span className="rex-tree-copied">copied</span> : null}
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
          title={hint}
          onClick={() => props.onOpen(entry.path)}
          onContextMenu={(event) => openMenu(event, entry)}
        >
          <span className="rex-tree-twisty" />
          <span className="rex-tree-name">{entry.name}</span>
          {justCopied ? <span className="rex-tree-copied">copied</span> : null}
          {counts && !justCopied ? <Counts counts={counts} /> : null}
        </button>,
      ];
    });

  return (
    <nav className="rex-explorer" style={{ width: props.width }}>
      <header className="rex-explorer-head">
        <span className="rex-label rex-explorer-root" title={props.tree.root}>
          WORKSPACE · {(props.tree.root.split("/").pop() || props.tree.root).toUpperCase()}
        </span>
        {/*
          §3.5 — the way into the built-in skip list, which was unreachable
          until this existed: there was no way at all to review a folder REX had
          decided to skip. It says nothing about the reviewer's own exclusions,
          which are always drawn.
        */}
        <button
          type="button"
          className="rex-link"
          title={
            props.showSkipped
              ? "Hide the folders REX skips on its own"
              : "List the folders REX skips on its own — build output, dependencies — so one can be brought in"
          }
          onClick={props.onToggleSkipped}
        >
          {props.showSkipped ? "hide skipped" : "skipped"}
        </button>
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

      {/*
        Fixed to the viewport, at the pointer. Inside the shadow root like
        everything else REX draws, so the document's own CSS cannot reach it
        (spec 01 §7) — and inside `nav` rather than portalled out, because the
        overlay has no portal host and one menu does not justify inventing one.
      */}
      {menu ? (
        <div ref={menuRef} className="rex-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            type="button"
            className="rex-menu-item"
            onClick={() => {
              copyPath(menu.entry.path);
              setMenu(null);
            }}
          >
            Copy path
          </button>

          {/*
            Only a document REX can actually render. A directory is not a place
            a comment can be anchored, and an `other` entry is listed precisely
            because REX cannot open it — offering either would put a row in the
            panel that Ask could never resolve.
          */}
          {menu.entry.kind === "document" && menu.entry.exclusion === null ? (
            <button
              type="button"
              className="rex-menu-item"
              title="Add the whole file to the selection, to comment on all of it"
              onClick={() => {
                props.onSelectFile(menu.entry.path);
                setMenu(null);
              }}
            >
              Select file
            </button>
          ) : null}

          {/*
            Spec 10 §3.4 — the scope of the review, one path at a time.
            Separated from the two above because those act on a path and this
            changes what REX looks at from now on.
          */}
          <span className="rex-menu-rule" />
          <button
            type="button"
            className="rex-menu-item"
            title={
              menu.entry.exclusion === null
                ? "Drop this from the tree, the reference graph and Ask all. Comments already written on it are kept."
                : "Put this back in the review"
            }
            onClick={() => {
              props.onExclude(menu.entry.path, menu.entry.exclusion === null);
              setMenu(null);
            }}
          >
            {menu.entry.exclusion === null ? "Exclude from review" : "Include in review"}
          </button>
        </div>
      ) : null}
    </nav>
  );
}
