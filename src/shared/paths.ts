// Spec 23 §4.1 — where a path lands when a file or a folder above it is renamed.
//
// Shared, because both processes have to agree: main moves the `document` and
// `workspace_rule` rows and the working copies, and the renderer has to work out
// whether the document it is showing is one of the things that moved.
//
// No `node:path`: this is imported by the renderer, which has no Node built-ins.
// `/` is the separator on the two platforms REX runs on, and `targets.ts`
// already reasons about paths the same way.

/**
 * `value` after `from` was renamed to `to`, or null when `value` is elsewhere.
 *
 * Answers for the renamed path itself and for everything under it, which is the
 * whole difference between renaming a file and renaming a folder. The prefix
 * test carries the separator so `/docs-old` is never treated as living inside
 * `/docs` — the string-prefix bug `isInsideWorkspace` exists to avoid, in a
 * second place.
 */
export function movedPath(value: string, from: string, to: string): string | null {
  if (value === from) return to;
  if (value.startsWith(`${from}/`)) return to + value.slice(from.length);
  return null;
}

/**
 * Spec 39 §5.1 — the folder a path is in.
 *
 * The tree's menu needs it: `New file…` on a FILE row puts the new file beside
 * that file, which is a question about the file's parent rather than about the
 * file. Every row in a scanned tree is absolute, so the two fallbacks are for
 * completeness and not for a case the explorer can reach.
 */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash > 0) return path.slice(0, slash);
  return slash === 0 ? "/" : path;
}
