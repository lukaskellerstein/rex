// Spec 02 §4 — the workspace tree.
//
// Inside the shadow root like everything else REX draws (spec 01 §7), and
// holding no database handle: the counts arrive already aggregated.

import { useEffect, useMemo, useRef, useState } from "react";
import { parentPath } from "../../shared/paths.ts";
import { documentsIn } from "../../shared/tree.ts";
import type { CommentCounts, TreeEntry, WorkspaceTree } from "../../shared/types.ts";
import type { ExplorerTab } from "./find.ts";
import { EyeOff, FilePlus, FolderPlus, TriangleDown, TriangleRight } from "./Icons.tsx";
import { NameBox } from "./NameBox.tsx";
import { SearchView, type SearchViewProps } from "./SearchView.tsx";
import { Tabs } from "./Tabs.tsx";

/**
 * Spec 18 §4.3 — a file's block counts, from its working copy.
 *
 * Absolute path → how many blocks the new version added or altered, and how
 * many only the original has. Empty when nothing has a working copy.
 */
export type ChangeCounts = Map<string, { added: number; removed: number }>;

/** The two facts one row draws markers for. Either half can be absent. */
interface RowCounts {
  comments: CommentCounts | null;
  change: { added: number; removed: number } | null;
}

const EMPTY_COMMENTS: CommentCounts = { open: 0, resolved: 0, orphaned: 0 };

interface Props {
  tree: WorkspaceTree;
  width: number;
  activePath: string | null;
  /**
   * Spec 18 §4.3 — kept out of `WorkspaceTree` on purpose.
   *
   * A block count is a fact about a working copy, and it moves when a run
   * finishes rather than when the tree is rescanned. Carried on `TreeEntry` it
   * would be stale exactly when the reviewer is looking at it.
   */
  changes: ChangeCounts;
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
   * Spec 06 §4.3 — the same gesture on a folder: every document under it.
   *
   * The tree decides WHICH files, because it is the only side that holds the
   * tree: it walks the subtree in the order it draws and skips what REX cannot
   * open. The App decides what a place is and what it costs to make one.
   *
   * The folder's own path travels with them, and it is the path rather than the
   * name: the App names the folder in its confirm AND shortens every file
   * against it, and deriving one from the other only works in that direction.
   */
  onSelectFolder: (folder: string, paths: string[]) => void;
  /**
   * Spec 10 §3.4 — one path in or out of the review.
   *
   * `exclude: false` covers both "take that exclusion back" and "pull in a
   * folder REX skips by default", because from here they are the same gesture
   * on the same word. Which of the two it turns out to be is main's to decide.
   */
  onExclude: (path: string, exclude: boolean) => void;
  /**
   * Spec 23 §4 — a new basename for one row, main's to accept or refuse.
   *
   * The tree does not predict the outcome and does not patch itself: main moves
   * the file, the document rows, the exclusion rules and the working copy
   * together, and the tree is re-scanned from what that left behind.
   */
  onRename: (path: string, name: string) => void;
  /** Spec 23 §3 — one file to the system Bin. The confirm has already run. */
  onDelete: (path: string) => void;
  /**
   * Spec 39 §4 — one empty path, in a folder this tree named.
   *
   * The tree decides WHICH folder (§5.1) — the right-clicked one, the parent of
   * the right-clicked file, or the root — because that is the row it drew. Main
   * decides whether the name is allowed, and the tree does not predict it.
   */
  onCreate: (parent: string, name: string, kind: NewKind) => void;
  /**
   * Spec 40 §2 — one row, into one folder.
   *
   * The tree decides which folder a drop means (§5.1) and refuses the three
   * drops it can answer on its own (§3.1). Main asks every one of them again:
   * a guard that exists only here is not a guard.
   */
  onMove: (path: string, parent: string) => void;
  onToggleSkipped: () => void;
  /** Spec 28 §4.2 — which of the two views the column shows. */
  tab: ExplorerTab;
  onTab: (tab: ExplorerTab) => void;
  /** Everything the Search view needs, as one thing: it all changes together. */
  search: SearchViewProps;
}

/**
 * Which row the menu belongs to, and where the pointer opened it.
 *
 * Spec 39 §5.2 — `entry: null` is the WORKSPACE ROOT, which has no row of its
 * own. It is the menu the empty space under the tree and the header open, and
 * it carries the two creates and nothing else: there is no root to rename, bin,
 * exclude or point a comment at.
 */
interface MenuAt {
  entry: TreeEntry | null;
  x: number;
  y: number;
}

/** Spec 39 §2 — the two things the tree can make. */
type NewKind = "file" | "directory";

/** Spec 39 §5.3 — the one row that is a blank box, and what it will make. */
interface CreatingAt {
  parent: string;
  kind: NewKind;
}

/** Deep enough to show a docs folder's contents, shallow enough for a repo. */
const AUTO_EXPAND_DEPTH = 2;

/**
 * Spec 18 §4.1 — what one file's row says, in markers.
 *
 * A dot and a number rather than a filled badge: twenty files with badges down
 * the right reads as a second, competing tree.
 *
 * Its own component because an excluded document shows them too (spec 10 §3.3):
 * excluding narrows what REX looks at and never what it holds, so the count of
 * what would be left behind is exactly the number somebody needs to judge
 * whether the exclusion was right.
 *
 * The gone count is a `?` and not a dot. It is the one comment state that has
 * to be legible beside the two diff colours, and taking it off the colour axis
 * is what leaves red and green free to mean one thing each (§3).
 *
 * Every marker a file has earned is drawn, resolved included. Spec 18 first hid
 * the resolved dot behind "only when nothing is open", to hold a row to three
 * markers — but that made a file with one open comment and twelve resolved ones
 * look exactly like a file with one open comment, which hides the work rather
 * than the clutter.
 */
function Counts({ comments, change }: RowCounts): React.JSX.Element {
  const counts = comments ?? EMPTY_COMMENTS;
  return (
    <span className="rex-tree-counts">
      {counts.open > 0 ? (
        <>
          <span className="rex-dot rex-dot-open" />
          <span className="rex-count rex-count-open">{counts.open}</span>
        </>
      ) : null}
      {counts.resolved > 0 ? (
        <>
          <span className="rex-dot rex-dot-resolved" />
          <span className="rex-count">{counts.resolved}</span>
        </>
      ) : null}
      {counts.orphaned > 0 ? (
        <>
          <span className="rex-gone-mark">?</span>
          <span className="rex-count rex-count-gone">{counts.orphaned}</span>
        </>
      ) : null}
      {change && change.added > 0 ? (
        <>
          <span className="rex-dot rex-dot-added" />
          <span className="rex-count rex-count-added">{change.added}</span>
        </>
      ) : null}
      {change && change.removed > 0 ? (
        <>
          <span className="rex-dot rex-dot-removed" />
          <span className="rex-count rex-count-removed">{change.removed}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Spec 18 §4.4 — the same four numbers in words, for the row's tooltip.
 *
 * Colour is never the only signal. A number whose unit has to be guessed is
 * worse than no number, so "blocks" is said out loud: the unit is a run of
 * changed lines, which is what the panes outline, and not a paragraph.
 */
function countWords({ comments, change }: RowCounts): string[] {
  const counts = comments ?? EMPTY_COMMENTS;
  const words: string[] = [];
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

  if (counts.open > 0) words.push(plural(counts.open, "open comment", "open comments"));
  if (counts.resolved > 0) {
    words.push(plural(counts.resolved, "resolved comment", "resolved comments"));
  }
  if (counts.orphaned > 0) {
    words.push(
      counts.orphaned === 1
        ? "1 comment whose text is gone"
        : `${counts.orphaned} comments whose text is gone`,
    );
  }
  if (change && change.added > 0) {
    words.push(plural(change.added, "block added or altered", "blocks added or altered"));
  }
  if (change && change.removed > 0) {
    words.push(plural(change.removed, "block removed", "blocks removed"));
  }
  return words;
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
  /** Spec 23 §5.2 — the one row whose name is a box rather than a label. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Spec 39 §5.3 — the one folder that has a blank box under it. */
  const [creating, setCreating] = useState<CreatingAt | null>(null);
  /** Spec 40 §5.1 — the row being dragged, and the folder it would land in. */
  const [dragged, setDragged] = useState<TreeEntry | null>(null);
  const [into, setInto] = useState<string | null>(null);
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

  const openMenu = (event: React.MouseEvent, entry: TreeEntry | null): void => {
    // Electron shows no menu of its own here, but a page still must not act on
    // a gesture and let the platform act on it as well.
    event.preventDefault();
    event.stopPropagation();
    setMenu({ entry, x: event.clientX, y: event.clientY });
  };

  /**
   * Spec 23 §3.2 — the confirm names the file and what survives it.
   *
   * The count is the one thing the reviewer cannot see from a dialog, and it is
   * the thing that decides whether this is a mistake: eleven comments on a file
   * are eleven questions that go quiet with it. They are kept either way, and
   * saying so is what makes the Bin readable as the reversible act it is.
   */
  const confirmDelete = (entry: TreeEntry): void => {
    // Spec 39 §5.5 — an empty folder has no comments to keep and no contents to
    // warn about, so the second line would be two sentences saying nothing.
    if (entry.kind === "directory") {
      if (window.confirm(`Move the empty folder "${entry.name}" to the Bin?`)) {
        props.onDelete(entry.path);
      }
      return;
    }
    const counts = entry.comments ?? EMPTY_COMMENTS;
    const many = counts.open + counts.resolved + counts.orphaned;
    const kept =
      many === 0
        ? "It has no comments."
        : `Its ${many} ${many === 1 ? "comment" : "comments"} are kept — put the file back and they return.`;
    if (window.confirm(`Move "${entry.name}" to the Bin?\n${kept}`)) props.onDelete(entry.path);
  };

  /**
   * Spec 39 §5.1 — where the new thing goes, from the row that was right-clicked.
   *
   * A folder takes it inside; anything else takes it beside, in its own parent.
   * That second case is the common one — "another file next to this one" — and
   * the alternative is hunting for the parent folder's own row, which on a deep
   * row means scrolling away from what you were looking at.
   */
  const startCreate = (entry: TreeEntry | null, kind: NewKind): void => {
    // §5.2 — a null entry is the workspace root's own menu.
    if (entry === null) {
      setCreating({ parent: props.tree.root, kind });
      return;
    }
    setCreating({
      parent: entry.kind === "directory" ? entry.path : parentPath(entry.path),
      kind,
    });
  };

  /**
   * Spec 39 §5.1 and §5.2 — the two creates, for a row's menu and the root's.
   *
   * One definition for both, so the wording and the order cannot drift between
   * the two menus. `startCreate` is what knows the difference between them.
   */
  const createItems = (entry: TreeEntry | null): React.JSX.Element => (
    <>
      <button
        type="button"
        className="rex-menu-item"
        title="Make an empty file here. REX writes the path and nothing else."
        onClick={() => {
          startCreate(entry, "file");
          setMenu(null);
        }}
      >
        New file…
      </button>
      <button
        type="button"
        className="rex-menu-item"
        title="Make an empty folder here."
        onClick={() => {
          startCreate(entry, "directory");
          setMenu(null);
        }}
      >
        New folder…
      </button>
    </>
  );

  /**
   * The blank box, drawn as the first child of `parent`, or nothing.
   *
   * First rather than in sorted position, because the sort is main's answer
   * about what is on disk and this row is not on disk yet. It carries its own
   * glyph: once the menu has closed, the glyph is the only thing that says
   * whether Enter makes a file or a folder.
   */
  const newRow = (parent: string, depth: number): React.JSX.Element[] => {
    if (creating === null || creating.parent !== parent) return [];
    const folder = creating.kind === "directory";
    const what = folder ? "folder" : "file";
    return [
      <div
        key={`rex-new:${parent}`}
        className="rex-tree-row rex-tree-renaming"
        style={{ paddingLeft: `${12 + depth * 15}px` }}
      >
        <span className="rex-tree-twisty">
          {folder ? <FolderPlus size={11} /> : <FilePlus size={11} />}
        </span>
        <NameBox
          value=""
          label={`Name for the new ${what} in ${parent}`}
          placeholder={`new ${what}`}
          allowEmpty={false}
          onSave={(name) => {
            setCreating(null);
            if (name === null) return;
            // The workspace root is not a row, so adding it changes nothing.
            reveal(parent);
            props.onCreate(parent, name, creating.kind);
          }}
          onCancel={() => setCreating(null)}
        />
      </div>,
    ];
  };

  /**
   * Spec 40 §5.1 — the folder a drop on this row lands in.
   *
   * A folder takes it inside; anything else takes it beside, in its own parent.
   * Deliberately spec 39 §5.1's rule: `New file…` on a file row already means
   * "beside this file", so a drop on a file row meaning the same thing is one
   * vocabulary rather than two.
   */
  const dropParent = (entry: TreeEntry): string =>
    entry.kind === "directory" ? entry.path : parentPath(entry.path);

  /**
   * Spec 40 §3.1 — the three drops the tree can answer on its own.
   *
   * False means no `preventDefault`, so nothing lights up and the pointer keeps
   * the platform's "no drop" cursor. The answer arrives while the hand is still
   * moving, which is worth more than a sentence after the fact — and an illegal
   * drop cannot be performed at all.
   *
   * Checks 4 and 5 — an excluded destination, and a folder REX skips — need no
   * test here: both are drawn as rows with no drop handlers at all.
   */
  const mayLand = (parent: string): boolean => {
    if (dragged === null) return false;
    // Into itself, and into its own descendant. The second is the one that
    // matters: `renameSync` performs it, and the subtree goes with it.
    if (parent === dragged.path || parent.startsWith(`${dragged.path}/`)) return false;
    // Already there. A "moved" notice for a file that did not move is a lie.
    return parentPath(dragged.path) !== parent;
  };

  const endDrag = (): void => {
    setDragged(null);
    setInto(null);
  };

  /**
   * The drag handlers one row needs, whichever element it is drawn as.
   *
   * `stopPropagation` on the drag-over as well as the drop: without it the
   * tree's own root handler runs afterwards — events bubble child to parent —
   * and quietly relabels every hover as "into the workspace root", including
   * the ones this refused.
   */
  const dragProps = (
    entry: TreeEntry,
  ): React.HTMLAttributes<HTMLElement> & { draggable: boolean } => ({
    // Not while a name box is open, for spec 14 §7.3's reason: dragging the row
    // out from under the caret is never what somebody typing a name meant.
    draggable: renaming === null && creating === null,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      // Chromium refuses to start a drag with an empty transfer. The payload is
      // never read back — the row being dragged is state, not data — but the
      // path is the honest thing to put there.
      event.dataTransfer.setData("text/plain", entry.path);
      setDragged(entry);
    },
    onDragEnd: endDrag,
    onDragOver: (event: React.DragEvent) => {
      event.stopPropagation();
      const parent = dropParent(entry);
      if (!mayLand(parent)) {
        setInto(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setInto(parent);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const parent = dropParent(entry);
      if (dragged !== null && mayLand(parent)) props.onMove(dragged.path, parent);
      endDrag();
    },
  });

  /**
   * Spec 06 §4.3 — the files `Select folder` would add, or none when the item
   * is not offered.
   *
   * Recursive, because a folder in this tree is everything under it: "select
   * `docs/`" on a nested repo would otherwise hand back three files out of
   * forty. `documentsIn` is the walk main already does for the reference graph,
   * so the two can never disagree about what is in the review.
   *
   * Computed where the menu is decided rather than inside it, so the item can
   * hide itself on a folder that holds nothing REX can open. A menu item that
   * silently does nothing is worse than an absent one.
   */
  const folderDocs =
    menu?.entry != null && menu.entry.kind === "directory" && menu.entry.exclusion === null
      ? documentsIn(menu.entry.children)
      : [];

  /**
   * Spec 39 §5.3 — open a folder and keep it open, whatever the twisty said.
   *
   * The create row itself forces its parent open while the box is up, but that
   * lasts exactly as long as the box does. Without this the tree comes back
   * from the re-scan with the folder shut and the new row inside it, which
   * looks precisely like a menu item that did nothing — measured on 2026-09-03,
   * making a folder inside a collapsed `docs/`.
   *
   * `manual` comes with it, for `toggle`'s reason: the auto-expansion is a
   * default, and the first deliberate act about a folder ends it.
   */
  const reveal = (path: string): void => {
    setExpanded(new Set(open).add(path));
    setManual(true);
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
      const row: RowCounts = {
        comments: entry.comments,
        change: props.changes.get(entry.path) ?? null,
      };
      const words = countWords(row);
      const marks = row.comments !== null || row.change !== null;
      // The path on hover, what the markers mean, and how to take the path.
      const hint = [entry.path, ...words, "Right-click to copy, select, rename or delete"].join(
        "\n",
      );
      const justCopied = copied === entry.path;

      // Spec 23 §5.2 — the name is edited where it is, so a `div` stands in for
      // whatever the row usually is. An `<input>` inside the `<button>` a
      // document row draws would be invalid markup, and every click in the box
      // would open the file.
      if (renaming === entry.path) {
        const isOpen = entry.kind === "directory" && open.has(entry.path);
        return [
          <div key={entry.path} className="rex-tree-row rex-tree-renaming" style={indent}>
            <span className="rex-tree-twisty" />
            <NameBox
              value={entry.name}
              label={`New name for ${entry.name}`}
              allowEmpty={false}
              selection="stem"
              onSave={(name) => {
                setRenaming(null);
                if (name !== null && name !== entry.name) props.onRename(entry.path, name);
              }}
              onCancel={() => setRenaming(null)}
            />
          </div>,
          ...(isOpen ? rows(entry.children, depth + 1) : []),
        ];
      }

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
            title={[
              entry.path,
              byHand
                ? "Excluded from this review — right-click to include it"
                : "Skipped by REX unless you ask for it — right-click to include it",
              ...words,
            ].join("\n")}
            onContextMenu={(event) => openMenu(event, entry)}
          >
            <span className="rex-tree-twisty">
              <EyeOff size={11} />
            </span>
            <span className="rex-tree-name">{entry.name}</span>
            {justCopied ? <span className="rex-tree-copied">copied</span> : null}
            {marks && !justCopied ? <Counts {...row} /> : null}
          </div>,
        ];
      }

      if (entry.kind === "directory") {
        // Spec 39 §5.1 — a folder with a box under it is open whatever the
        // reviewer last did to its twisty. Creating inside a shut folder and
        // showing nothing would look exactly like a menu item that did nothing.
        const isOpen = open.has(entry.path) || creating?.parent === entry.path;
        return [
          <button
            key={entry.path}
            type="button"
            // Spec 40 §5.2 — the RECEIVING folder lights up, which on a folder
            // row is this row itself.
            className={`rex-tree-row rex-tree-dir${into === entry.path ? " rex-tree-into" : ""}`}
            style={indent}
            title={hint}
            onClick={() => toggle(entry.path)}
            onContextMenu={(event) => openMenu(event, entry)}
            {...dragProps(entry)}
          >
            <span className="rex-tree-twisty">{isOpen ? <TriangleDown /> : <TriangleRight />}</span>
            <span className="rex-tree-name">{entry.name}</span>
            {justCopied ? <span className="rex-tree-copied">copied</span> : null}
          </button>,
          ...(isOpen ? [...newRow(entry.path, depth + 1), ...rows(entry.children, depth + 1)] : []),
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
            {...dragProps(entry)}
          >
            <span className="rex-tree-twisty" />
            <span className="rex-tree-name">{entry.name}</span>
            {justCopied ? <span className="rex-tree-copied">copied</span> : null}
          </div>,
        ];
      }

      return [
        <button
          key={entry.path}
          type="button"
          className={`rex-tree-row rex-tree-doc${props.activePath === entry.path ? " rex-tree-active" : ""}`}
          style={indent}
          title={hint}
          onClick={() => props.onOpen(entry.path)}
          onContextMenu={(event) => openMenu(event, entry)}
          {...dragProps(entry)}
        >
          <span className="rex-tree-twisty" />
          <span className="rex-tree-name">{entry.name}</span>
          {justCopied ? <span className="rex-tree-copied">copied</span> : null}
          {marks && !justCopied ? <Counts {...row} /> : null}
        </button>,
      ];
    });

  /**
   * The menu for one row: everything that acts on a path.
   *
   * Takes the entry rather than reading `menu.entry`, so every item below is
   * about a `TreeEntry` and not about a `TreeEntry | null` — the root's menu
   * (§5.2) is a different shape and shares only the two creates.
   */
  const rowMenu = (entry: TreeEntry): React.JSX.Element => (
    <>
      <button
        type="button"
        className="rex-menu-item"
        onClick={() => {
          copyPath(entry.path);
          setMenu(null);
        }}
      >
        Copy path
      </button>

      {/*
        Only a document REX can actually render. A directory is not a place a
        comment can be anchored, and an `other` entry is listed precisely
        because REX cannot open it — offering either would put a row in the
        panel that Ask could never resolve.
      */}
      {entry.kind === "document" && entry.exclusion === null ? (
        <button
          type="button"
          className="rex-menu-item"
          title="Add the whole file to the selection, to comment on all of it"
          onClick={() => {
            props.onSelectFile(entry.path);
            setMenu(null);
          }}
        >
          Select file
        </button>
      ) : null}

      {/*
        The same slot for a folder, so there is one `Select …` item whatever was
        right-clicked. It says the count out loud: the whole point of the item is
        that it adds more than one row, and a gesture whose size you only learn
        afterwards is a gesture nobody uses twice.
      */}
      {folderDocs.length > 0 ? (
        <button
          type="button"
          className="rex-menu-item"
          title={`Add all ${folderDocs.length} documents under this folder to the selection, to comment on the folder as a whole`}
          onClick={() => {
            props.onSelectFolder(entry.path, folderDocs);
            setMenu(null);
          }}
        >
          Select folder ({folderDocs.length})
        </button>
      ) : null}

      {/*
        Spec 23 §5.1 — the two acts that change the disk, kept apart from the
        three above by a rule. Everything above this line reads; the first thing
        below it writes.
      */}
      <span className="rex-menu-rule" />

      {/*
        Spec 39 §5.1 — first in the write group, which runs create, rename,
        delete: the order is how much each one changes.

        Not offered on an excluded row. Its subtree was never walked, so REX
        cannot draw what it would put there, and a create nothing shows is the
        silent case this feature exists to avoid.
      */}
      {entry.exclusion === null ? createItems(entry) : null}

      <button
        type="button"
        className="rex-menu-item"
        title="Rename this in place. Every comment written on it follows the new name."
        onClick={() => {
          setRenaming(entry.path);
          setMenu(null);
        }}
      >
        Rename…
      </button>

      {/*
        Spec 23 §3.1 and spec 39 §5.5 — every file, and an EMPTY folder.

        A folder that holds anything is still refused, because one click must
        not be able to take a whole `docs/` with it. `children.length` is the
        tree's answer and it can be wrong in one direction only — a subtree the
        scan stopped short of (spec 02 §4.2's depth cap) looks empty here — so
        main reads the folder itself and refuses with a sentence.
      */}
      {entry.kind !== "directory" || entry.children.length === 0 ? (
        <button
          type="button"
          className="rex-menu-item rex-menu-danger"
          title={
            entry.kind === "directory"
              ? "Move this empty folder to the system Bin. The Finder's Put Back brings it back."
              : "Move this file to the system Bin. Its comments are kept, and the Finder's Put Back brings both back."
          }
          onClick={() => {
            setMenu(null);
            confirmDelete(entry);
          }}
        >
          Move to Bin
        </button>
      ) : null}

      {/*
        Spec 10 §3.4 — the scope of the review, one path at a time. Separated
        from the two above because those act on a path and this changes what REX
        looks at from now on.
      */}
      <span className="rex-menu-rule" />
      <button
        type="button"
        className="rex-menu-item"
        title={
          entry.exclusion === null
            ? "Drop this from the tree, the reference graph and Ask all. Comments already written on it are kept."
            : "Put this back in the review"
        }
        onClick={() => {
          props.onExclude(entry.path, entry.exclusion === null);
          setMenu(null);
        }}
      >
        {entry.exclusion === null ? "Exclude from review" : "Include in review"}
      </button>
    </>
  );

  return (
    <nav className="rex-explorer" style={{ width: props.width }}>
      {/*
        Spec 28 §4.2 — two views, one column. The same segmented row the
        comments column switches with (spec 08 §3.1). The `Search` tab counts
        the files the last search found something in.
      */}
      <div className="rex-side-head rex-side-tabs">
        <Tabs
          tabs={[
            { id: "files", label: "Files" },
            { id: "search", label: "Search", count: props.search.result?.files.length ?? 0 },
          ]}
          on={props.tab}
          onTab={props.onTab}
        />
      </div>

      {props.tab === "search" ? (
        <SearchView {...props.search} />
      ) : (
        <div className="rex-explorer-scroll">
          {/*
            §5.2 — the header opens the root's menu too, and it has to. A
            workspace whose tree fills the whole column has no empty space to
            right-click, and then there would be no way to make anything at the
            root at all. The label IS the root on screen.
          */}
          <header className="rex-explorer-head" onContextMenu={(event) => openMenu(event, null)}>
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

          {/*
            Spec 40 §5.1 — the empty space under the rows is the workspace root,
            which has no row of its own to drop on. The container carries the
            handlers and stretches to fill the column, so "below everything"
            is a real target rather than a two-pixel strip.
          */}
          <div
            className={`rex-tree${into === props.tree.root ? " rex-tree-into-root" : ""}`}
            // Spec 39 §5.2 — the empty space under the rows IS the workspace
            // root, so right-clicking it offers the two creates. A row stops
            // the event, so this only ever fires below everything.
            onContextMenu={(event) => openMenu(event, null)}
            onDragOver={(event) => {
              if (!mayLand(props.tree.root)) {
                setInto(null);
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setInto(props.tree.root);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged !== null && mayLand(props.tree.root)) {
                props.onMove(dragged.path, props.tree.root);
              }
              endDrag();
            }}
          >
            {newRow(props.tree.root, 0)}
            {rows(props.tree.entries, 0)}
          </div>
        </div>
      )}

      {/*
        Fixed to the viewport, at the pointer. Inside the shadow root like
        everything else REX draws, so the document's own CSS cannot reach it
        (spec 01 §7) — and inside `nav` rather than portalled out, because the
        overlay has no portal host and one menu does not justify inventing one.
      */}
      {menu ? (
        <div ref={menuRef} className="rex-menu" style={{ left: menu.x, top: menu.y }}>
          {/*
            §5.2 — a null entry is the workspace root, and its menu is the two
            creates alone: the root is not a thing that can be renamed, binned,
            excluded, or pointed a comment at.
          */}
          {menu.entry === null ? createItems(null) : rowMenu(menu.entry)}
        </div>
      ) : null}
    </nav>
  );
}
