// SPEC.md §8.7 step 5 and spec 05 §5.6.1 — show the change and WAIT.
//
// This is not optional: an agent must never change files the user has not seen.
// Undo restores every one of them with `git checkout`.
//
// It is a bar and not a dialog, and that is the whole point of §5.6.1. A modal
// over the document answers "what does this patch say" while hiding the thing it
// says it about; the reviewer wants to read the document as it now stands, with
// the changed sections outlined in it. So the patch text is here on demand, and
// the document stays visible behind.
//
// Two things stay from the old dialog because both are safety rather than
// decoration: the WRITE PROFILE pill, so it is obvious which of the two agents
// produced this, and a plain statement that keeping it re-runs anchoring and
// will move or orphan comments written on the removed text.

import { useState } from "react";
import type { ApplyReadyEvent } from "../../shared/channels.ts";
import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";
import { tokenClass } from "./Gutter.tsx";
import { Pencil, Warning } from "./Icons.tsx";
import { StateWord, washClass } from "./ThreadRow.tsx";

interface Props {
  event: ApplyReadyEvent;
  /** The comment this patch answers, so the change is never read out of context. */
  thread: ThreadWithMessages | null;
  number: number;
  anchorState: AnchorState | null;
  /** How many sections are outlined in the document on screen right now. */
  outlined: number;
  openDocumentPath: string | null;
  onOpenFile: (path: string) => void;
  onDecide: (accept: boolean) => void;
}

interface Tally {
  added: number;
  removed: number;
}

/**
 * What the patch does to each file, in the two numbers a reviewer reads first.
 *
 * Per file, not per patch: Apply can now change several, and one pair of totals
 * repeated beside every name would be wrong for all but one of them.
 */
function tallyByFile(diff: string): Map<string, Tally> {
  const counts = new Map<string, Tally>();
  let current: Tally | null = null;

  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (header) {
      current = { added: 0, removed: 0 };
      counts.set(header[1].trim(), current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.added++;
    else if (line.startsWith("-") && !line.startsWith("---")) current.removed++;
  }

  return counts;
}

/**
 * The name a reviewer recognises. The whole identifier is on the title.
 *
 * A skipped document can be a URL, whose last path segment is meaningless — the
 * host is the part that names it.
 */
function baseName(identifier: string): string {
  if (/^https?:\/\//.test(identifier)) {
    try {
      return new URL(identifier).host;
    } catch {
      return identifier;
    }
  }
  return identifier.split("/").pop() ?? identifier;
}

/**
 * Spec 06 §7.2 — how much of this file the comment covers.
 *
 * The mechanism of Apply does not change, but one thing does and it must be
 * said in the dialog rather than left to be discovered: **a comment on a whole
 * document authorises an edit anywhere in that file.** The diff gate is what
 * makes that safe; the reviewer should still know what they are about to read
 * before they read it.
 *
 * The widest extent among the targets in that file wins, because that is what
 * was authorised. Null for an ordinary passage comment, where the +/− counts
 * already say everything.
 */
function coveredScope(thread: ThreadWithMessages | null, file: string): string | null {
  if (!thread) return null;
  const here = thread.targets.filter((_, position) => {
    const name = thread.targetNames[position];
    return name !== undefined && (file === name || file.endsWith(`/${name}`));
  });
  if (here.some((target) => target.anchor.extent === "document")) return "the whole document";
  const section = here.find((target) => target.anchor.extent === "section");
  if (!section) return null;
  const heading = section.anchor.quote?.exact?.trim();
  return heading ? `Section “${heading}”` : "one section";
}

function tallyFor(counts: Map<string, Tally>, file: string): Tally {
  // Main reports absolute paths; git's own headers are repository-relative, so
  // the two are matched by suffix rather than by equality.
  for (const [name, tally] of counts) {
    if (file === name || file.endsWith(`/${name}`)) return tally;
  }
  return { added: 0, removed: 0 };
}

function diffClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "rex-diff-file";
  if (line.startsWith("@@")) return "rex-diff-hunk";
  if (line.startsWith("+")) return "rex-diff-add";
  if (line.startsWith("-")) return "rex-diff-del";
  return "";
}

export function DiffDialog(props: Props): React.JSX.Element {
  const [showDiff, setShowDiff] = useState(false);
  const counts = tallyByFile(props.event.diff);
  const { event, thread } = props;

  const hereChanged =
    props.openDocumentPath !== null && event.files.includes(props.openDocumentPath);

  // §5.6.1 — only Markdown carries `data-src-line`, so a changed HTML file has
  // nothing to outline. Saying so is the honest answer; guessing at a paragraph
  // is the silent wrong-place failure spec 01 §6.1 refuses.
  const heading = !hereChanged
    ? "This document was not changed."
    : props.outlined > 0
      ? `${props.outlined} section${props.outlined === 1 ? "" : "s"} changed here — outlined in the document.`
      : "This document changed, but it carries no source lines to outline. The diff is below.";

  return (
    <section className="rex-review">
      <div className="rex-review-head">
        <span className="rex-dialog-icon">
          <Pencil size={16} />
        </span>
        <span className="rex-review-title">
          <strong>{heading}</strong>
          <span className="rex-meta">Nothing is final until you choose.</span>
        </span>
        <span className="rex-spacer" />
        <span className="rex-pill rex-pill-write">WRITE PROFILE</span>
        <button type="button" className="rex-link" onClick={() => setShowDiff(!showDiff)}>
          {showDiff ? "hide the diff" : "show the diff"}
        </button>
        <button
          type="button"
          className="rex-button rex-primary"
          onClick={() => props.onDecide(true)}
        >
          OK
        </button>
        <button
          type="button"
          className="rex-button rex-button-write"
          onClick={() => props.onDecide(false)}
        >
          Undo
        </button>
      </div>

      <div className="rex-review-files">
        {event.files.length === 0 ? (
          <span className="rex-meta">The agent changed no files.</span>
        ) : (
          event.files.map((file) => {
            const tally = tallyFor(counts, file);
            const open = file === props.openDocumentPath;
            const scope = coveredScope(thread, file);
            return (
              <button
                key={file}
                type="button"
                className={open ? "rex-file rex-file-open" : "rex-file"}
                title={open ? file : `${file} — open it to see the change in place`}
                disabled={open}
                onClick={() => props.onOpenFile(file)}
              >
                {baseName(file)}
                {/* §7.2 — what the comment covers here, before the counts of
                    what changed. A whole-document comment authorised an edit
                    anywhere in this file, and that is worth reading first. */}
                {scope ? <span className="rex-file-scope">{scope}</span> : null}
                <span className="rex-file-add">+{tally.added}</span>
                <span className="rex-file-del">−{tally.removed}</span>
                {/* No count of "sections" here: the heading already says how
                    many are outlined in the document on screen, and a second
                    number using the same word for a different thing is how a
                    reviewer stops trusting either. */}
              </button>
            );
          })
        )}
      </div>

      {event.skipped.length > 0 ? (
        <p className="rex-meta rex-review-skipped">
          Not edited:{" "}
          {event.skipped.map((entry) => (
            <span key={entry.file} title={entry.reason}>
              {baseName(entry.file)}{" "}
            </span>
          ))}
        </p>
      ) : null}

      {showDiff ? (
        <>
          {thread ? (
            <div className={`rex-card-anchor ${washClass(thread.status, props.anchorState)}`}>
              <div className="rex-card-anchor-head">
                <span className={`rex-token ${tokenClass(thread.status, props.anchorState)}`}>
                  {props.number}
                </span>
                <span className="rex-meta">
                  <StateWord status={thread.status} state={props.anchorState} /> the comment this
                  patch answers
                </span>
              </div>
              <p className="rex-card-note">{thread.note}</p>
            </div>
          ) : null}

          <pre className="rex-diff">
            {event.diff.split("\n").map((line, position) => (
              // A diff line has no id of its own; its position in the hunk is it.
              <span key={position} className={diffClass(line)}>
                {line || " "}
                {"\n"}
              </span>
            ))}
          </pre>
        </>
      ) : null}

      <p className="rex-warn">
        <Warning />
        <span>
          OK keeps the change and re-runs anchoring. Comments written against the removed text will
          move or lose their anchor — they are kept either way, with the text they were written on.
          Undo restores every file with <code>git checkout</code>.
        </span>
      </p>
    </section>
  );
}
