// design/screens/Threads — every comment on the document, filtered.
//
// The chips carry their own counts, so the filter row doubles as the tally and
// the panel needs no second header to say how many of what there are.
//
// Spec 14 turned the list into a tree: groups first at every level, then the
// comments, with the reviewer's own order inside each. The order itself is
// main's — `thread:list` returns the walk (§4.4) — so this file never sorts, it
// only arranges what it was given and reports gestures back.

import { useMemo, useState } from "react";
import {
  buildCommentTree,
  type CommentRow,
  type DropMode,
  dropMove,
  flattenRows,
  type GroupNode,
  totalsById,
} from "../../shared/commentTree.ts";
import type {
  AnchorState,
  CommentGroup,
  CommentItem,
  CommentMove,
  ThreadWithMessages,
} from "../../shared/types.ts";
import { GroupRow } from "./GroupRow.tsx";
import { FolderClosed, Lines } from "./Icons.tsx";
import { onSendChord, SEND_CHORD_HINT, SendChord } from "./keys.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

type Filter = "open" | "resolved" | "orphaned";

interface Props {
  threads: ThreadWithMessages[];
  /** Spec 14 §5 — every group in this workspace, at every depth. */
  groups: CommentGroup[];
  /** Null when no workspace is open: there is no root to hang a group on. */
  root: string | null;
  /** Null means no target of this thread has been checked yet — §5.4. */
  stateById: Map<string, AnchorState | null>;
  labelById: Map<string, string | null>;
  busyThreads: string[];
  onSelect: (threadId: string) => void;
  /** Spec 06 §6.4 — hovering a row shows that comment's ink, if it was drawn. */
  onHover: (threadId: string | null) => void;
  onSynthesise: (refThreadIds: string[], note: string) => void;
  /** Removes a comment for good. The row confirms first. */
  onDelete: (threadId: string) => void;
  /** Spec 14 §3 — null puts the note back. */
  onRename: (threadId: string, title: string | null) => void;
  /** Returns the new group's id, so the panel can open its name box (§7.4). */
  onGroupCreate: (parentId: string | null, name: string) => Promise<string | null>;
  onGroupRename: (groupId: string, name: string) => void;
  onGroupCollapse: (groupId: string, collapsed: boolean) => void;
  onGroupDelete: (groupId: string) => void;
  onMove: (move: CommentMove) => void;
}

const FILTERS: Filter[] = ["open", "resolved", "orphaned"];

/** Which row a drag is over, and what dropping there would mean. */
interface Hover {
  rowId: string;
  mode: DropMode;
}

export function Sidebar(props: Props): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>("open");
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");
  /** The row whose name box is open — a comment id or a group id, never both. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragged, setDragged] = useState<CommentItem | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  /** A synthesis is about SEVERAL comments, and needs a question about them. */
  const canSynthesise = chosen.length >= 2 && note.trim().length > 0;
  const synthesise = (): void => {
    props.onSynthesise(chosen, note.trim());
    setSelecting(false);
    setChosen([]);
    setNote("");
  };

  /** One rule, used for both the chip counts and the list. */
  const belongsTo = useMemo(() => {
    const state = props.stateById;
    return (thread: ThreadWithMessages, which: Filter): boolean => {
      const orphaned = state.get(thread.id) === "orphaned";
      if (which === "orphaned") return orphaned;
      return !orphaned && thread.status === which;
    };
  }, [props.stateById]);

  const numbers = new Map(props.threads.map((thread, position) => [thread.id, position + 1]));
  const counts = Object.fromEntries(
    FILTERS.map((which) => [which, props.threads.filter((t) => belongsTo(t, which)).length]),
  ) as Record<Filter, number>;

  const visible = props.threads.filter((thread) => belongsTo(thread, filter));

  /**
   * Two trees, and both are needed.
   *
   * The filtered one is what is drawn, and its group counts say how many of the
   * comments now listed are inside each group. The full one answers §5.7's
   * second clause: a group that holds no comments **at all** stays visible, so
   * that making a group is not a gesture whose result vanishes.
   */
  const shown = buildCommentTree(props.groups, visible);
  const everything = useMemo(
    () => totalsById(buildCommentTree(props.groups, props.threads)),
    [props.groups, props.threads],
  );

  const collapsedIds = useMemo(
    () => new Set(props.groups.filter((group) => group.collapsed).map((group) => group.id)),
    [props.groups],
  );

  const rows = flattenRows(shown, {
    collapsed: (group) => collapsedIds.has(group.id),
    // §5.7 — a group is drawn when the filter left something inside it, OR when
    // it holds nothing at all. Without the second clause, making a group is a
    // gesture whose result disappears before it can be used.
    visible: (node: GroupNode<ThreadWithMessages>) =>
      node.total > 0 || (everything.get(node.group.id) ?? 0) === 0,
  });

  const toggle = (threadId: string): void =>
    setChosen((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [...current, threadId],
    );

  const endDrag = (): void => {
    setDragged(null);
    setHover(null);
  };

  /**
   * Spec 14 §7.4 — a new group arrives with its name box already open.
   *
   * Naming it is the point, and a group called "New group" that nobody renamed
   * is worse than no group. The placeholder name exists only because main
   * refuses a nameless one.
   */
  const addGroup = async (parentId: string | null): Promise<void> => {
    const id = await props.onGroupCreate(parentId, "New group");
    if (id) setRenaming(id);
  };

  /**
   * Spec 14 §7.3 — where the pointer is inside the row decides what the drop
   * means. The line means beside; the row means inside.
   *
   * A group row gives its middle half to "inside", because that is the drop a
   * group row is for. A comment row has no inside, so it splits in two.
   */
  const modeFor = (row: CommentRow<ThreadWithMessages>, event: React.DragEvent): DropMode => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientY - box.top) / (box.height || 1);
    if (row.kind !== "group") return fraction < 0.5 ? "before" : "after";
    if (fraction < 0.25) return "before";
    if (fraction > 0.75) return "after";
    return "inside";
  };

  const over = (row: CommentRow<ThreadWithMessages>) => (event: React.DragEvent) => {
    if (!dragged) return;
    const mode = modeFor(row, event);
    const move = dropMove(rows, props.groups, dragged, row, mode);
    // Nothing is drawn for an illegal drop, which is how the panel says so
    // without a refusal: no line, no highlight, and the browser's own "no drop"
    // cursor because `preventDefault` is never called.
    if (!move) {
      setHover(null);
      return;
    }
    event.preventDefault();
    setHover({ rowId: row.id, mode });
  };

  const drop = (row: CommentRow<ThreadWithMessages>) => (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragged) return;
    const move = dropMove(rows, props.groups, dragged, row, modeFor(row, event));
    if (move) props.onMove(move);
    endDrag();
  };

  /** The empty space under the tree: the top level, last. §7.3. */
  const dropOutside = (event: React.DragEvent): void => {
    event.preventDefault();
    if (!dragged) return;
    const siblings = rows
      .filter((row) => row.parentId === null && row.kind === dragged.kind)
      .map((row) => row.id)
      .filter((id) => id !== dragged.id);
    props.onMove({ item: dragged, parentId: null, after: siblings.at(-1) ?? null });
    endDrag();
  };

  /**
   * Spec 14 §4.5 — the outliner keys, on the focused row.
   *
   * "The focused row" is literally the element with focus, so this lives on the
   * row rather than on a global listener: no id has to be tracked, and the
   * event is stopped here so Alt never reaches the document's own binding.
   *
   * Every one of them ends in the same `comments:move` a drag sends. There is
   * one way to reorder, reachable two ways.
   */
  const moveByKey = (row: CommentRow<ThreadWithMessages>, event: React.KeyboardEvent): void => {
    if (!event.altKey || renaming !== null) return;
    const item: CommentItem = { kind: row.kind, id: row.id } as CommentItem;
    const family = rows.filter((r) => r.parentId === row.parentId && r.kind === row.kind);
    const line = family.map((r) => r.id);
    const at = line.indexOf(row.id);
    let move: CommentMove | null = null;

    if (event.key === "ArrowUp" && at > 0) {
      // Two back, because the row directly above is the one being stepped over.
      move = { item, parentId: row.parentId, after: line[at - 2] ?? null };
    } else if (event.key === "ArrowDown" && at >= 0 && at < line.length - 1) {
      move = { item, parentId: row.parentId, after: line[at + 1] ?? null };
    } else if (event.key === "ArrowRight") {
      // Into the nearest group above it, which is the one a reader would point
      // at when saying "that one".
      const above = rows
        .slice(0, rows.indexOf(row))
        .reverse()
        .find((r) => r.kind === "group");
      if (above) move = dropMove(rows, props.groups, item, above, "inside");
    } else if (event.key === "ArrowLeft" && row.parentId !== null) {
      const parent = props.groups.find((group) => group.id === row.parentId);
      if (parent) {
        const outside = rows
          .filter((r) => r.parentId === parent.parentId && r.kind === row.kind)
          .map((r) => r.id);
        move = {
          item,
          parentId: parent.parentId,
          // A group lands directly after the one it came out of; a comment goes
          // last, because there is no comment it "came out of" to sit beside.
          after: row.kind === "group" ? parent.id : (outside.at(-1) ?? null),
        };
      }
    }

    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    props.onMove(move);
  };

  const dragProps = (
    row: CommentRow<ThreadWithMessages>,
    extra?: string,
  ): React.HTMLAttributes<HTMLDivElement> & { draggable: boolean } => ({
    // Not while a name box is open: dragging the row out from under the caret
    // is never what somebody halfway through typing a name meant.
    draggable: renaming === null,
    onDragStart: () => setDragged({ kind: row.kind, id: row.id } as CommentItem),
    onDragEnd: endDrag,
    onDragOver: over(row),
    onDrop: drop(row),
    onKeyDown: (event: React.KeyboardEvent) => moveByKey(row, event),
    className: [
      extra,
      "rex-drop",
      hover?.rowId === row.id && hover.mode === "before" ? "rex-drop-before" : "",
      hover?.rowId === row.id && hover.mode === "after" ? "rex-drop-after" : "",
    ]
      .filter(Boolean)
      .join(" "),
    // The line carries the indent of the parent it means, so the last line of a
    // subgroup and the line before the next top-level row are not one pixel.
    style: { "--rex-drop-indent": `${row.depth * 14}px` } as React.CSSProperties,
  });

  return (
    <>
      <nav className="rex-side-head rex-filters">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={`rex-chip ${filter === option ? "rex-chip-on" : ""}`}
            onClick={() => setFilter(option)}
          >
            {option}
            <span className={`rex-chip-count rex-chip-count-${option}`}>{counts[option]}</span>
          </button>
        ))}
      </nav>

      {/*
        The column itself is the last drop target: §7.3's empty space below the
        tree, which means the top level, last. `preventDefault` on dragover is
        what makes a drop possible at all, and it is called only while something
        is being dragged so an ordinary pointer over the list is untouched.
      */}
      <div
        className="rex-side-scroll"
        onDragOver={(event) => {
          if (dragged) event.preventDefault();
        }}
        onDrop={dropOutside}
      >
        {filter === "orphaned" && visible.length > 0 ? (
          // §6.6 — REX's own Apply creates orphans, so this is normal operation
          // rather than an error path, and the panel says so plainly.
          <p className="rex-orphan-note">
            The text these were written against is gone. Nothing is lost — each keeps the quote it
            was written on, and REX's own Apply is a normal way to create one.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="rex-meta">No {filter} comments.</p>
        ) : (
          rows.map((row) =>
            row.kind === "group" ? (
              <div key={`g:${row.id}`} {...dragProps(row)}>
                <GroupRow
                  name={row.node.group.name}
                  count={row.node.total}
                  collapsed={collapsedIds.has(row.id)}
                  depth={row.depth}
                  dropInside={hover?.rowId === row.id && hover.mode === "inside"}
                  renaming={renaming === row.id}
                  onToggle={() => props.onGroupCollapse(row.id, !collapsedIds.has(row.id))}
                  onRename={() => setRenaming(row.id)}
                  onName={(name) => {
                    if (name) props.onGroupRename(row.id, name);
                    setRenaming(null);
                  }}
                  onCancelRename={() => setRenaming(null)}
                  onAddChild={() => void addGroup(row.id)}
                  onDelete={() => {
                    const inside = everything.get(row.id) ?? 0;
                    const where = row.parentId === null ? "the top level" : "the group above it";
                    const detail =
                      inside > 0
                        ? ` Its ${inside} comment${inside === 1 ? "" : "s"} move to ${where}, and none is deleted.`
                        : "";
                    if (window.confirm(`Delete the group "${row.node.group.name}"?${detail}`)) {
                      props.onGroupDelete(row.id);
                    }
                  }}
                />
              </div>
            ) : (
              <div key={row.id} {...dragProps(row, "rex-row")}>
                {selecting ? (
                  <input
                    type="checkbox"
                    aria-label={`Include comment ${numbers.get(row.id)}`}
                    checked={chosen.includes(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                ) : null}
                <ThreadRow
                  thread={row.thread}
                  number={numbers.get(row.id) ?? 0}
                  state={props.stateById.get(row.id) ?? null}
                  label={props.labelById.get(row.id) ?? null}
                  selected={false}
                  busy={props.busyThreads.includes(row.id)}
                  depth={row.depth}
                  renaming={renaming === row.id}
                  onRename={() => setRenaming(row.id)}
                  onName={(title) => {
                    props.onRename(row.id, title);
                    setRenaming(null);
                  }}
                  onCancelRename={() => setRenaming(null)}
                  onSelect={() => props.onSelect(row.id)}
                  onHover={(isOver) => props.onHover(isOver ? row.id : null)}
                  onDelete={() => props.onDelete(row.id)}
                />
              </div>
            ),
          )
        )}

        {filter !== "orphaned" && counts.orphaned > 0 ? (
          <button type="button" className="rex-tray" onClick={() => setFilter("orphaned")}>
            {counts.orphaned} comment{counts.orphaned === 1 ? "" : "s"} lost{" "}
            {counts.orphaned === 1 ? "its" : "their"} anchor
            <span className="rex-tray-more">show</span>
          </button>
        ) : null}
      </div>

      <div className="rex-side-foot">
        {selecting ? (
          <>
            <p className="rex-meta">
              Pick the comments to discuss together, then say what to ask about them.
            </p>
            <textarea
              className="rex-input"
              placeholder="e.g. do comments 2 and 5 contradict each other?"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={onSendChord(canSynthesise, synthesise)}
            />
            <div className="rex-row">
              <button
                type="button"
                className="rex-button rex-primary"
                title={`Discuss the picked comments together — ${SEND_CHORD_HINT}`}
                disabled={!canSynthesise}
                onClick={synthesise}
              >
                Ask about {chosen.length}
                <SendChord />
              </button>
              <button type="button" className="rex-button" onClick={() => setSelecting(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rex-row">
              <button
                type="button"
                className="rex-button"
                disabled={props.threads.length < 2}
                onClick={() => setSelecting(true)}
              >
                <Lines />
                Synthesis thread…
              </button>
              {/*
                Spec 14 §5.3 — with no workspace open there is no root to hang a
                group on, so the control is not offered rather than offered and
                failing.
              */}
              {props.root ? (
                <button
                  type="button"
                  className="rex-button"
                  title="Make a group at the top level"
                  onClick={() => void addGroup(null)}
                >
                  <FolderClosed />
                  New group
                </button>
              ) : null}
            </div>
            <span className="rex-meta">
              {props.root
                ? "drag a row to reorder it, or onto a group to file it"
                : "discuss several comments together"}
            </span>
          </>
        )}
      </div>
    </>
  );
}
