// Spec 14 §5 and §6 — comment groups, and the one move that rearranges them.
//
// Its own module rather than more of `queries.ts`, which is already 700 lines of
// threads and messages. Everything here is about *arrangement*: what contains
// what, and in what order. Nothing here reads a note, an anchor or a message.
//
// Invariant I2 — main only, like every other module under `db/`.

import { v4 as uuidv4 } from "uuid";
import type { CommentGroup, CommentMove } from "../../shared/types.ts";
import type { Db } from "./database.ts";

const now = (): string => new Date().toISOString();

interface GroupRow {
  id: string;
  root: string;
  parent_id: string | null;
  name: string;
  position: number;
  collapsed: number;
  created_at: string;
}

function toGroup(row: GroupRow): CommentGroup {
  return {
    id: row.id,
    root: row.root,
    parentId: row.parent_id,
    name: row.name,
    position: row.position,
    collapsed: row.collapsed !== 0,
    createdAt: row.created_at,
  };
}

/**
 * Every group in one workspace, at every depth, in walk order.
 *
 * Flat rather than nested: the renderer builds the tree, because it is the one
 * that has to filter it, indent it and decide what a drop means. Sorted by
 * parent then position so a caller that only wants siblings can group in one
 * pass.
 */
export function listGroups(db: Db, root: string): CommentGroup[] {
  return db
    .prepare<[string], GroupRow>(
      "SELECT * FROM comment_group WHERE root = ? ORDER BY parent_id, position",
    )
    .all(root)
    .map(toGroup);
}

export function getGroup(db: Db, groupId: string): CommentGroup | null {
  const row = db
    .prepare<[string], GroupRow>("SELECT * FROM comment_group WHERE id = ?")
    .get(groupId);
  return row ? toGroup(row) : null;
}

/** A new group, last among its parent's groups. Spec 14 §7.4. */
export function createGroup(
  db: Db,
  input: { root: string; parentId: string | null; name: string },
): CommentGroup {
  const name = input.name.trim();
  if (!name) throw new Error("A group needs a name.");

  if (input.parentId) {
    const parent = getGroup(db, input.parentId);
    if (!parent) throw new Error("That group no longer exists.");
    if (parent.root !== input.root) {
      throw new Error("A group cannot sit inside a group from another workspace.");
    }
  }

  const group: CommentGroup = {
    id: uuidv4(),
    root: input.root,
    parentId: input.parentId,
    name,
    position: nextPosition(db, input.root, input.parentId),
    collapsed: false,
    createdAt: now(),
  };

  db.prepare(
    `INSERT INTO comment_group (id, root, parent_id, name, position, collapsed, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(group.id, group.root, group.parentId, group.name, group.position, group.createdAt);

  return group;
}

/**
 * The name, the collapsed flag, or both.
 *
 * An empty name is refused rather than written: a group with no name is a row
 * nobody can talk about, and unlike a comment there is no note to fall back to
 * (§7.1). A comment's name can be emptied; a group's cannot.
 */
export function updateGroup(
  db: Db,
  input: { groupId: string; name?: string; collapsed?: boolean },
): void {
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("A group needs a name.");
    db.prepare("UPDATE comment_group SET name = ? WHERE id = ?").run(name, input.groupId);
  }
  if (input.collapsed !== undefined) {
    db.prepare("UPDATE comment_group SET collapsed = ? WHERE id = ?").run(
      input.collapsed ? 1 : 0,
      input.groupId,
    );
  }
}

/**
 * Spec 14 §5.4 — deleting a group promotes everything inside it to that group's
 * own parent, then removes the group.
 *
 * Not to the top level: a subgroup two levels down whose parent is deleted
 * belongs one level up, not at the root of a list of sixty.
 *
 * **No comment is destroyed.** The promotion runs first and leaves the schema's
 * cascade nothing to take — that cascade is the backstop for a row deleted some
 * other way, not this path.
 */
export function deleteGroup(db: Db, groupId: string): void {
  const group = getGroup(db, groupId);
  if (!group) return;

  const promote = db.transaction((): void => {
    // Both lists land at the end of the parent's own, keeping their order among
    // themselves: `nextPosition` is read once and each row is offset from it.
    let slot = nextPosition(db, group.root, group.parentId);
    const children = db
      .prepare<[string], { id: string }>(
        "SELECT id FROM comment_group WHERE parent_id = ? ORDER BY position",
      )
      .all(groupId);
    const move = db.prepare("UPDATE comment_group SET parent_id = ?, position = ? WHERE id = ?");
    for (const child of children) move.run(group.parentId, slot++, child.id);

    let commentSlot = nextThreadPosition(db, group.parentId);
    const comments = db
      .prepare<[string], { id: string }>(
        "SELECT id FROM thread WHERE group_id = ? ORDER BY position",
      )
      .all(groupId);
    const moveComment = db.prepare("UPDATE thread SET group_id = ?, position = ? WHERE id = ?");
    for (const comment of comments) moveComment.run(group.parentId, commentSlot++, comment.id);

    db.prepare("DELETE FROM comment_group WHERE id = ?").run(groupId);
  });
  promote();
}

/**
 * Spec 14 §4.2 — one drop.
 *
 * The caller sends a gesture: this item, into that parent, after that sibling.
 * Positions are computed here and nowhere else, because the panel is filtered
 * and cannot count.
 *
 * The whole sibling list is renumbered `0…n-1`, including rows the filter hid.
 * Renumbering a superset preserves the relative order of everything in it, so
 * hidden rows keep their places. Spec 14 §4.1 says why this is an integer and
 * not a fractional key.
 */
export function moveItem(db: Db, move: CommentMove): void {
  if (move.item.kind === "group") moveGroup(db, move);
  else moveThread(db, move);
}

function moveGroup(db: Db, move: CommentMove): void {
  const group = getGroup(db, move.item.id);
  if (!group) throw new Error("That group no longer exists.");

  if (move.parentId !== null) {
    const parent = getGroup(db, move.parentId);
    if (!parent) throw new Error("That group no longer exists.");
    if (parent.root !== group.root) {
      throw new Error("A group cannot move into another workspace.");
    }
    // Spec 14 §5.5 — refused in main, not only in the panel. A cycle makes the
    // tree walk non-terminating, which takes the whole comments panel with it.
    if (isSelfOrDescendant(db, move.parentId, group.id)) {
      throw new Error("A group cannot be moved inside itself.");
    }
  }

  // `IS`, not `=`: the top level is NULL, and `parent_id = NULL` is never true.
  const siblings = db
    .prepare<{ root: string; parentId: string | null; moved: string }, { id: string }>(
      `SELECT id FROM comment_group
        WHERE root = :root AND parent_id IS :parentId AND id != :moved
        ORDER BY position`,
    )
    .all({ root: group.root, parentId: move.parentId, moved: group.id })
    .map((row) => row.id);

  const ordered = insertAfter(siblings, group.id, move.after);
  const write = db.prepare("UPDATE comment_group SET parent_id = ?, position = ? WHERE id = ?");
  db.transaction((): void => {
    for (const [position, id] of ordered.entries()) write.run(move.parentId, position, id);
  })();
}

function moveThread(db: Db, move: CommentMove): void {
  const exists = db
    .prepare<[string], { id: string }>("SELECT id FROM thread WHERE id = ?")
    .get(move.item.id);
  if (!exists) throw new Error("That comment no longer exists.");
  if (move.parentId !== null && !getGroup(db, move.parentId)) {
    throw new Error("That group no longer exists.");
  }

  const siblings = db
    .prepare<{ parentId: string | null; moved: string }, { id: string }>(
      `SELECT id FROM thread
        WHERE group_id IS :parentId AND id != :moved
        ORDER BY position, created_at`,
    )
    .all({ parentId: move.parentId, moved: move.item.id })
    .map((row) => row.id);

  const ordered = insertAfter(siblings, move.item.id, move.after);
  const write = db.prepare("UPDATE thread SET group_id = ?, position = ? WHERE id = ?");
  db.transaction((): void => {
    for (const [position, id] of ordered.entries()) write.run(move.parentId, position, id);
  })();
}

/** Where a new row goes: last among its parent's groups. */
function nextPosition(db: Db, root: string, parentId: string | null): number {
  const row = db
    .prepare<{ root: string; parentId: string | null }, { next: number }>(
      "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM comment_group WHERE root = :root AND parent_id IS :parentId",
    )
    .get({ root, parentId });
  return row?.next ?? 0;
}

/** The same, for comments. A new comment lands at the end of the top level. */
export function nextThreadPosition(db: Db, groupId: string | null): number {
  const row = db
    .prepare<{ groupId: string | null }, { next: number }>(
      "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM thread WHERE group_id IS :groupId",
    )
    .get({ groupId });
  return row?.next ?? 0;
}

/**
 * True when `candidate` is `group`, or sits anywhere beneath it.
 *
 * Walks upward from the candidate rather than downward from the group: the
 * chain to the root is at most as deep as the tree, while the subtree below can
 * be the whole workspace. The visited set is not paranoia — it is what stops
 * this hanging if a cycle ever does reach the table.
 */
function isSelfOrDescendant(db: Db, candidateId: string, groupId: string): boolean {
  const seen = new Set<string>();
  let current: string | null = candidateId;
  while (current) {
    if (current === groupId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = getGroup(db, current)?.parentId ?? null;
  }
  return false;
}

/**
 * The sibling list with `id` put back at the place `after` names.
 *
 * `after === null` is first. An `after` that is not in the list — a row deleted
 * between the drag starting and the drop landing — puts the item last, which is
 * the one answer that never loses it.
 */
function insertAfter(siblings: string[], id: string, after: string | null): string[] {
  if (after === null) return [id, ...siblings];
  const index = siblings.indexOf(after);
  if (index < 0) return [...siblings, id];
  return [...siblings.slice(0, index + 1), id, ...siblings.slice(index + 1)];
}
