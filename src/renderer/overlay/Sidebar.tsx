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
  startsLooseBlock,
  totalsById,
  treeCells,
} from "../../shared/commentTree.ts";
import { tallyPlaces, threadState } from "../../shared/targets.ts";
import type {
  AnchorState,
  CommentGroup,
  CommentItem,
  CommentMove,
  ThreadWithMessages,
} from "../../shared/types.ts";
import { GroupRow } from "./GroupRow.tsx";
import { FolderClosed, Lines, Plus } from "./Icons.tsx";
import { onSendChord, SEND_CHORD_HINT, SendChord } from "./keys.tsx";
import { ListMenu } from "./ListMenu.tsx";
import { LANE_LABEL, LANES, type Lane, laneOf } from "./lanes.ts";
import { Tabs } from "./Tabs.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

interface Props {
  threads: ThreadWithMessages[];
  /**
   * Spec 30 §5.5 — the lane being shown, and it is App's, not the panel's.
   *
   * It used to be this component's own `useState`, and that was two faults in
   * one line. The paper could not see it, so §1.1's whole complaint — the pills
   * narrowing the list and not the document — was structural. And `Sidebar`
   * unmounts whenever a comment card opens, so reading a comment and pressing
   * back put the row back to `open`.
   */
  lane: Lane;
  onLane: (lane: Lane) => void;
  /** Narrowed to the open document. Off by default: the list is the workspace's. */
  onlyThisFile: boolean;
  onOnlyThisFile: (only: boolean) => void;
  /**
   * Spec 30 §3.3 — how many places the standing draft holds, or 0 for none.
   *
   * It is what stops a saved draft from being unfindable: the `＋` button reads
   * as "back to what you were writing" while this is above zero, and the count
   * is the one the Selection tab used to carry (§4.2).
   */
  draftPlaces: number;
  /** Spec 30 §3.1 — opens the composer. The document is the other door. */
  onNewComment: () => void;
  /** Removes every comment in the workspace. The `⋮` menu confirms first. */
  onDeleteAll: () => void;
  /** Spec 14 §5 — every group in this workspace, at every depth. */
  groups: CommentGroup[];
  /** Null when no workspace is open: there is no root to hang a folder on. */
  root: string | null;
  /**
   * The document on the paper right now, so the panel can be narrowed to it.
   *
   * A workspace's comments are one list, which is what makes *"where else did I
   * say this?"* answerable — but most of the time the question is the other one:
   * *"what have I said about the thing I am reading?"* Null when nothing is
   * open, and then the chip is not offered rather than offered and meaningless.
   */
  openDocument: { id: string; name: string } | null;
  /**
   * Spec 33 §2.1 — the state of each comment's places, in target order.
   *
   * Per place rather than the tally, because a row's chips count the lost
   * places PER FILE, and a count summed over the comment cannot be split back
   * out. The lane is summed from it here. A comment absent from the map has no
   * places anyone has looked at (spec 05 §5.4).
   */
  statesById: Map<string, Array<AnchorState | null>>;
  busyThreads: string[];
  onSelect: (threadId: string) => void;
  /** Hovering a row lights that comment's passages on the paper. */
  onHover: (threadId: string | null) => void;
  onSynthesise: (refThreadIds: string[], note: string) => void;
  /** Removes a comment for good. The row confirms first. */
  onDelete: (threadId: string) => void;
  /** Ends a comment, or puts it back — the same act as the card's own button. */
  onResolve: (threadId: string, resolved: boolean) => void;
  /** Spec 14 §3 — null puts the note back. */
  onRename: (threadId: string, title: string | null) => void;
  /** Returns the new group's id, so the panel can open its name box (§7.4). */
  onGroupCreate: (parentId: string | null, name: string) => Promise<string | null>;
  onGroupRename: (groupId: string, name: string) => void;
  onGroupCollapse: (groupId: string, collapsed: boolean) => void;
  onGroupDelete: (groupId: string) => void;
  onMove: (move: CommentMove) => void;
}

/** Which row a drag is over, and what dropping there would mean. */
interface Hover {
  rowId: string;
  mode: DropMode;
}

/**
 * The `│ ├ └` beside a row, as elements: one cell per level of nesting.
 *
 * `treeCells` decides the shape and lives in `shared/`, where the test can
 * exercise it — a tree drawn one column wrong looks deliberate, so it is not a
 * thing to leave to the eye. This turns its answer into markup and nothing else.
 */
function RowTree<T>({
  rows,
  index,
  folder,
}: {
  rows: Array<CommentRow<T>>;
  index: number;
  folder: boolean;
}): React.JSX.Element {
  return (
    <span className={`rex-branch${folder ? " rex-branch-folder" : ""}`} aria-hidden="true">
      {treeCells(rows, index).map((cell, level) => (
        // The cells ARE their positions — outermost folder first — so the level
        // is the identity here, not a stand-in for one.
        <span
          key={`${level}:${cell}`}
          className={cell ? `rex-branch-cell rex-branch-${cell}` : "rex-branch-cell"}
        />
      ))}
    </span>
  );
}

export function Sidebar(props: Props): React.JSX.Element {
  const { lane: filter, onlyThisFile } = props;
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

  /**
   * One rule, used for the five counts and for the list — and for the marks on
   * the paper, which read the same `laneOf` in `App.tsx`.
   *
   * It was a per-lane predicate until spec 30, which is a shape that lets one
   * comment answer yes to two lanes. `lanes.ts` decides once and the answer is
   * a single lane, so that cannot happen.
   */
  const laneFor = useMemo(() => {
    const states = props.statesById;
    return (thread: ThreadWithMessages): Lane =>
      laneOf(thread.status, threadState(tallyPlaces(states.get(thread.id) ?? [])));
  }, [props.statesById]);

  const numbers = new Map(props.threads.map((thread, position) => [thread.id, position + 1]));

  /**
   * Whether this comment is about the document on the paper.
   *
   * Any target counts, not just the first: one comment can be about a table
   * here and a paragraph in another file, and it is about **both** of them.
   * Asking only `thread.documentId` would drop it from the file whose paragraph
   * it is half about.
   */
  const aboutOpenDocument = (thread: ThreadWithMessages): boolean => {
    const id = props.openDocument?.id;
    if (!id) return true;
    return thread.documentId === id || thread.targets.some((target) => target.documentId === id);
  };

  // The two filters are different questions — *what state is it in* and *what
  // is it about* — so they narrow one after the other rather than replacing
  // each other. Every count below is what pressing that chip would leave.
  const listed = onlyThisFile ? props.threads.filter(aboutOpenDocument) : props.threads;
  const counts = Object.fromEntries(
    LANES.map((which) => [which, listed.filter((t) => laneFor(t) === which).length]),
  ) as Record<Lane, number>;

  const visible = listed.filter((thread) => laneFor(thread) === filter);

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
   * Naming it is the point, and a folder called "New folder" that nobody
   * renamed is worse than no folder. The placeholder name exists only because
   * main refuses a nameless one.
   */
  const addGroup = async (parentId: string | null): Promise<void> => {
    const id = await props.onGroupCreate(parentId, "New folder");
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
      .join(" ")
      .trim(),
    // How deep the row is, in levels. It sets the row's indent, and the drop
    // line reads it too — the line carries the indent of the parent it means,
    // so the last line of a subgroup and the line before the next top-level row
    // are not one pixel.
    style: { "--rex-rails": String(row.depth) } as React.CSSProperties,
  });

  return (
    <>
      {/*
        Spec 30 §4.1 — ROW ONE is the list's header. It says which list this is,
        and it is where the commands that act on the whole list live.

        The scope was a fourth pill in the row below until spec 30, split off by
        a hairline, and the hairline was not a sentence: four identical pills
        read as four states. It is drawn as a segmented control now because the
        two questions are different in KIND — §5.1, the pills below narrow the
        list AND the paper, and this narrows only the list, since a document can
        never show another file's comments anyway.

        `Tabs` and not a private copy: REX has one control that means "pick one
        of these", and spec 28 §5.7 already lifted it out for the explorer.
      */}
      <nav className="rex-side-head rex-listhead">
        {props.openDocument ? (
          <Tabs
            tabs={[
              {
                id: "all",
                label: "All files",
                count: props.threads.length,
                title: "Every comment in this workspace",
              },
              {
                id: "file",
                label: props.openDocument.name,
                count: props.threads.filter(aboutOpenDocument).length,
                // §4.3 — the whole name, since this is the label that truncates.
                title: `Only the comments about ${props.openDocument.name}`,
              },
            ]}
            on={onlyThisFile ? "file" : "all"}
            onTab={(which) => props.onOnlyThisFile(which === "file")}
          />
        ) : (
          // With nothing open there is no second scope to offer, so the row
          // says what the list is instead of drawing a switch with one side.
          <span className="rex-meta">All comments {props.threads.length}</span>
        )}

        {/*
          The menu is lifted OUT of the flow, not merely pushed right. Left in
          it it takes real width after the switch, so `margin: 0 auto` centres
          the switch in what it leaves rather than on the row.
        */}
        <span className="rex-listhead-end">
          <ListMenu commentCount={props.threads.length} onDeleteAllComments={props.onDeleteAll} />
        </span>
      </nav>

      {/*
        ROW TWO — the two things a reviewer can MAKE, side by side.

        They were in two different places: `New` at the right edge of the header
        above, `New folder` at the foot of the panel, thirty rows of list apart.
        Both answer the same question — *how do I add something?* — so both are
        asked in one place. Reported 2026-09-02.

        A row of their own rather than back in the header: two labelled buttons
        plus the scope switch do not fit a 384px sidebar, and the labels are the
        point. Moving them out also gives the header its width back — the switch
        now has the row minus two 24px columns, so nothing truncates at any
        width the panel can be dragged to.
      */}
      <nav className="rex-makerow">
        {/*
          Spec 30 §3.1 — the second door into the composer.

          The document is the main one and stays so: picking a place opens the
          composer by itself. This button is for the two cases the document
          cannot serve — starting a comment about the whole document, and
          GETTING BACK TO A DRAFT that is standing.

          §3.4 — offered whether or not a document is open. With nothing open
          nothing can be picked and back discards, and that is a better answer
          than a button whose meaning changes with the screen.

          A WORD, not a bare `＋`. An icon alone says "add", and in a panel of
          comments the first guess is "add what — a folder?" Beside a button
          that really does make a folder, the word has to say which of the two
          this is, so it reads `New comment` rather than `New`.
        */}
        <button
          type="button"
          className={`rex-new${props.draftPlaces > 0 ? " rex-new-standing" : ""}`}
          aria-label="Start a new comment"
          data-tip={
            props.draftPlaces > 0
              ? `Back to the comment you are writing — ${props.draftPlaces} place${props.draftPlaces === 1 ? "" : "s"}`
              : "Start a new comment"
          }
          onClick={props.onNewComment}
        >
          <Plus size={11} />
          New comment
          {/* §4.2 — the selection count moved here from the tab that carried it. */}
          {props.draftPlaces > 0 ? (
            <span className="rex-chip-count">{props.draftPlaces}</span>
          ) : null}
        </button>

        {/*
          Spec 14 §5.3 — with no workspace open there is no root to hang a group
          on, so the control is not offered rather than offered and failing.
        */}
        {props.root ? (
          <button
            type="button"
            className="rex-new"
            aria-label="Make a folder at the top level"
            data-tip="Make a folder at the top level"
            onClick={() => void addGroup(null)}
          >
            <FolderClosed size={12} />
            New folder
          </button>
        ) : null}
      </nav>

      {/* ROW THREE is the filter, and nothing else. Spec 30 §4.4 — five pills. */}
      <nav className="rex-side-head rex-filters">
        {LANES.map((option) => (
          <button
            key={option}
            type="button"
            className={`rex-chip ${filter === option ? "rex-chip-on" : ""}`}
            onClick={() => props.onLane(option)}
          >
            {LANE_LABEL[option]}
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
          //
          // Spec 30 §5.4 — and the second sentence is new, because the filter
          // reaches the paper now. An orphan has no place in the document by
          // definition (spec 15 §8.5), so this is the one lane that fills the
          // list and leaves the page bare. That is correct, and it looks broken
          // the first time, so the panel says which it is.
          <p className="rex-orphan-note">
            The text these were written against is gone, so none of them is marked on the page.
            Nothing is lost — each keeps the quote it was written on, and REX's own Apply is a
            normal way to create one.
          </p>
        ) : null}

        {rows.length === 0 ? (
          // Which of the two filters emptied it, so the way back is obvious.
          <p className="rex-meta">
            No {LANE_LABEL[filter]} comments
            {onlyThisFile && props.openDocument ? ` about ${props.openDocument.name}` : ""}.
          </p>
        ) : (
          rows.map((row, index) => {
            // The row that steps back out of a folder — the row above it is
            // deeper — is where that folder's block ends. It gets the air.
            const out = row.depth < (rows[index - 1]?.depth ?? row.depth);
            // And the FIRST comment that is in no folder gets the rule, because
            // that is the one boundary the reviewer scans for: folders above
            // it, everything else below. A comment stepping out of a nested
            // folder is still in a folder, so it gets the air and no rule.
            const loose = startsLooseBlock(rows, index);
            // `rex-out` and `rex-loose` both set the space above the row, so a
            // row never carries both — the bigger one would depend on which
            // rule the stylesheet happened to declare last.
            const air = loose ? "rex-loose" : out ? "rex-out" : "";
            return row.kind === "group" ? (
              <div key={`g:${row.id}`} {...dragProps(row, air)}>
                <RowTree rows={rows} index={index} folder />
                <GroupRow
                  name={row.node.group.name}
                  count={row.node.total}
                  collapsed={collapsedIds.has(row.id)}
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
              <div key={row.id} {...dragProps(row, `rex-row ${air}`)}>
                <RowTree rows={rows} index={index} folder={false} />
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
                  states={props.statesById.get(row.id) ?? []}
                  selected={false}
                  busy={props.busyThreads.includes(row.id)}
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
                  onResolve={(resolved) => props.onResolve(row.id, resolved)}
                />
              </div>
            );
          })
        )}
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
            {/*
              `New folder` used to stand here beside it, and it has moved up to
              the make row under the header — the two commands that MAKE
              something are in one place now. The foot keeps the one command
              that is about comments that already exist.
            */}
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
            </div>
            <span className="rex-meta">
              {props.root
                ? "drag a row to reorder it, or onto a folder to file it"
                : "discuss several comments together"}
            </span>
          </>
        )}
      </div>
    </>
  );
}
