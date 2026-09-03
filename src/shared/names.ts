// Spec 14 §3.2 — what a comment is called, decided in exactly one place.
//
// Main, the panel, the card and `rex export` all call this, so the four can
// never disagree about a comment's name. It is in `shared/` for that reason and
// imports nothing: the rule is one branch and a regular expression.

/** The two fields the rule reads. Anything with them can be named. */
interface Nameable {
  title: string | null;
  note: string;
}

/**
 * Spec 30 §3.6 — the last resort, for a comment with neither a name nor words.
 *
 * Unreachable until spec 30: every comment was created by a send, and a send
 * needs a question, so the note was never empty. A draft is saved by walking
 * away, and walking away immediately is allowed — so a comment with nothing to
 * be named by exists now, and it drew a blank headline until this.
 *
 * "Named by the note" (spec 14 §3.1) is still the rule; this is what it says
 * when there is no note to be named by.
 */
const UNNAMED = "Untitled";

/**
 * The name to show: the typed title, else the note's first line.
 *
 * No length cut. The panel clips with CSS, which respects the column's real
 * width; `rex export` prints the whole line, because a heading in a file has no
 * column. A number here would be wrong in both places.
 *
 * "First line" matters because a pasted note is one paste away, and a row that
 * grows to five lines breaks the list's rhythm. Runs of whitespace collapse to
 * one so that a note wrapped across lines does not arrive with a tab in the
 * middle of it.
 */
export function commentName(thread: Nameable): string {
  const title = thread.title?.trim();
  if (title) return title;

  const line = thread.note.split("\n").find((candidate) => candidate.trim().length > 0);
  return (line ?? thread.note).trim().replace(/\s+/g, " ") || UNNAMED;
}

/**
 * True when the note says something the name does not already say.
 *
 * The row shows the note under the name only then (§7.2): with no title the two
 * are the same string, and printing it twice is how a four-line row becomes a
 * five-line one that says nothing more.
 */
export function noteAddsToName(thread: Nameable): boolean {
  if (!thread.title?.trim()) return false;
  return commentName({ title: null, note: thread.note }) !== commentName(thread);
}
