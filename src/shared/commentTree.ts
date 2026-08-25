// Spec 14 §4.3, §4.4 and §5.2 — the shape of the comment list, decided once.
//
// In `shared/` and not in the overlay, although §8's file map put it there.
// Both processes need the same walk: main returns `thread:list` in it (§4.4, so
// the gutter's numbers and the panel's rows cannot disagree), and the panel
// draws from it. Two implementations of one order is exactly the bug §4.4
// exists to prevent.
//
// Pure and generic. It imports nothing but a type, touches no database and no
// DOM, and `test/comments.spec.ts` exercises it with plain objects.

import type { CommentGroup, CommentItem, CommentMove } from "./types.ts";

/** The two fields the walk reads off a comment. */
export interface Positioned {
  id: string;
  groupId: string | null;
  position: number;
}

export interface GroupNode<T> {
  group: CommentGroup;
  /** 0 for a top-level group. What the panel indents by. */
  depth: number;
  groups: Array<GroupNode<T>>;
  threads: T[];
  /** Comments beneath this group at **every** depth — §5.2's count. */
  total: number;
}

export interface CommentTree<T> {
  groups: Array<GroupNode<T>>;
  /** Comments at the top level, in order. */
  threads: T[];
}

/**
 * Groups and comments, arranged.
 *
 * Two rules, both from §4.3: inside a parent, **groups first, then comments**,
 * and each of the two sorted by its own `position`. They never share a rank, so
 * no ordering key has to be valid across the two tables.
 *
 * A comment whose `groupId` names a group that is not here is treated as top
 * level. That is not a defensive shrug — it is §5.3: open a subdirectory as its
 * own workspace and a comment grouped in the outer root arrives with a group id
 * this root knows nothing about. Its id is untouched, so it is back in its group
 * the moment the outer root is open again.
 */
export function buildCommentTree<T extends Positioned>(
  groups: CommentGroup[],
  threads: T[],
): CommentTree<T> {
  const known = new Map(groups.map((group) => [group.id, group]));
  const childGroups = new Map<string | null, CommentGroup[]>();
  for (const group of groups) {
    // A parent that is not in this list makes the group top level, for the same
    // reason a comment's missing group does.
    const parentId = group.parentId && known.has(group.parentId) ? group.parentId : null;
    push(childGroups, parentId, group);
  }

  const childThreads = new Map<string | null, T[]>();
  for (const thread of threads) {
    const groupId = thread.groupId && known.has(thread.groupId) ? thread.groupId : null;
    push(childThreads, groupId, thread);
  }
  for (const list of childThreads.values()) list.sort(byPosition);
  for (const list of childGroups.values()) list.sort(byPosition);

  // The visited set is not paranoia: main refuses a cycle (§5.5), but a database
  // edited by hand can still hold one, and a walk that hangs takes the whole
  // panel with it. A group already seen is simply not descended into again.
  const seen = new Set<string>();

  const build = (parentId: string | null, depth: number): Array<GroupNode<T>> =>
    (childGroups.get(parentId) ?? [])
      .filter((group) => !seen.has(group.id))
      .map((group) => {
        seen.add(group.id);
        const nested = build(group.id, depth + 1);
        const own = childThreads.get(group.id) ?? [];
        return {
          group,
          depth,
          groups: nested,
          threads: own,
          total: own.length + nested.reduce((sum, node) => sum + node.total, 0),
        };
      });

  return { groups: build(null, 0), threads: childThreads.get(null) ?? [] };
}

/**
 * The tree flattened into the order the panel shows and the margin counts in.
 *
 * Groups depth-first, then the level's own comments — §4.4. This is what
 * `thread:list` returns and what `index + 1` on the gutter's markers means, so
 * moving a group to the top really does make its comments `1, 2, 3`.
 */
export function walkOrder<T extends Positioned>(tree: CommentTree<T>): T[] {
  const out: T[] = [];
  const visit = (nodes: Array<GroupNode<T>>): void => {
    for (const node of nodes) {
      visit(node.groups);
      out.push(...node.threads);
    }
  };
  visit(tree.groups);
  out.push(...tree.threads);
  return out;
}

/** Every group beneath one, itself included. What a delete confirm counts. */
export function subtreeOf<T>(node: GroupNode<T>): Array<GroupNode<T>> {
  return [node, ...node.groups.flatMap(subtreeOf)];
}

/** How many comments sit beneath each group, by group id, at every depth. */
export function totalsById<T>(tree: CommentTree<T>): Map<string, number> {
  const totals = new Map<string, number>();
  const visit = (nodes: Array<GroupNode<T>>): void => {
    for (const node of nodes) {
      totals.set(node.group.id, node.total);
      visit(node.groups);
    }
  };
  visit(tree.groups);
  return totals;
}

/**
 * Spec 14 §5.5 — would putting `groupId` inside `parentId` make a cycle?
 *
 * The panel asks this before it draws a drop line, and main asks the database
 * the same question before it writes. Two callers, one rule: a panel that
 * allowed what main refuses would offer a drop that silently does nothing.
 */
export function wouldCycle(
  groups: CommentGroup[],
  groupId: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return false;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<string>();
  let current: string | null = parentId;
  while (current) {
    if (current === groupId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

// ── The rows the panel draws, and what a drop onto one means ────

/** One rendered line: a group's header, or a comment. */
export type CommentRow<T> =
  | { kind: "group"; id: string; depth: number; parentId: string | null; node: GroupNode<T> }
  | { kind: "thread"; id: string; depth: number; parentId: string | null; thread: T };

/**
 * The tree as the panel lists it, top to bottom.
 *
 * `visible` decides whether a group's own row is drawn at all (§5.7), and
 * `collapsed` whether its contents follow it. A collapsed group still draws its
 * header — that is the row you drag when you want to move everything at once
 * (§4.6).
 */
export function flattenRows<T extends Positioned>(
  tree: CommentTree<T>,
  options: {
    collapsed: (group: CommentGroup) => boolean;
    visible: (node: GroupNode<T>) => boolean;
  },
): Array<CommentRow<T>> {
  const rows: Array<CommentRow<T>> = [];

  const level = (
    nodes: Array<GroupNode<T>>,
    threads: T[],
    parentId: string | null,
    depth: number,
  ): void => {
    for (const node of nodes) {
      if (!options.visible(node)) continue;
      rows.push({ kind: "group", id: node.group.id, depth, parentId, node });
      if (!options.collapsed(node.group)) {
        level(node.groups, node.threads, node.group.id, depth + 1);
      }
    }
    // A comment sits one level in from the header it belongs to, and a
    // top-level comment sits flush.
    for (const thread of threads) {
      rows.push({ kind: "thread", id: thread.id, depth, parentId, thread });
    }
  };

  level(tree.groups, tree.threads, null, 0);
  return rows;
}

/** Where a drop would land, relative to the row under the pointer. */
export type DropMode = "before" | "after" | "inside";

/**
 * Spec 14 §7.3 — one drop, turned into the gesture main is sent.
 *
 * Returns null when the drop is illegal, which is how the panel knows not to
 * draw anything: a group over a comment row, a cycle, or a move that would put
 * a row back exactly where it already is.
 *
 * `after` is an id and never an index — §4.2. The dragged row is removed from
 * the sibling list first, so "before the row I am hovering" means the same thing
 * whether the drag started above it or below it.
 */
export function dropMove<T extends Positioned>(
  rows: Array<CommentRow<T>>,
  groups: CommentGroup[],
  dragged: CommentItem,
  target: CommentRow<T>,
  mode: DropMode,
): CommentMove | null {
  if (dragged.kind === "group" && dragged.id === target.id) return null;

  if (mode === "inside") {
    if (target.kind !== "group") return null;
    if (dragged.kind === "group" && wouldCycle(groups, dragged.id, target.id)) return null;
    // Last inside, which is what dropping onto a container means everywhere.
    const siblings = siblingIds(rows, target.id, dragged.kind).filter((id) => id !== dragged.id);
    return { item: dragged, parentId: target.id, after: siblings.at(-1) ?? null };
  }

  // §4.3 — groups land among groups, comments among comments. A drop line is
  // never drawn across the boundary, so this is the same rule twice.
  if (dragged.kind !== target.kind) return null;
  if (dragged.kind === "group" && wouldCycle(groups, dragged.id, target.parentId)) return null;

  const siblings = siblingIds(rows, target.parentId, dragged.kind).filter(
    (id) => id !== dragged.id,
  );
  const index = siblings.indexOf(target.id);
  if (index < 0) return null;

  const after = mode === "after" ? target.id : (siblings[index - 1] ?? null);
  return { item: dragged, parentId: target.parentId, after };
}

/** The ids of one parent's children of one kind, in the order they are drawn. */
function siblingIds<T>(
  rows: Array<CommentRow<T>>,
  parentId: string | null,
  kind: CommentItem["kind"],
): string[] {
  return rows.filter((row) => row.parentId === parentId && row.kind === kind).map((row) => row.id);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function byPosition(a: { position: number }, b: { position: number }): number {
  return a.position - b.position;
}
