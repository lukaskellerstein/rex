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
