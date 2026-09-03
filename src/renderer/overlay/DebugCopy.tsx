// Spec 08 §6.2 — this comment's run, on the clipboard, for pasting to whoever
// is going to fix it.
//
// The button was born in the trace sheet, because that is where a reviewer
// decides something is wrong. It is here in its own file because the card wants
// it too, and for the reason the card wants it: the sheet is one click away,
// and the reviewer who has just read a bad answer is looking at the card. Two
// copies of the copy would have been two chances to drift — one asks main for
// the report, the other forgets to say what went wrong when the ask fails.
//
// It is the COMMENT's report and not the app's. The app's is the top bar's `B`
// (spec 13 §4): the port, the open document, the recent errors. This one names
// a thread — its session file, its places, its refusals, its cost — and there is
// no thread to name from up there.

import { useEffect, useState } from "react";
import { Bug, Check } from "./Icons.tsx";

/** How long the button stays on its confirmation before going back. */
const COPIED_MS = 2500;

/**
 * What the last press did. `text` is the report itself on success and the
 * failure on failure; either way it becomes the button's `title`, so a reviewer
 * can see what they are about to paste before they paste it — REX's report
 * carries absolute paths and a line of their document, and being able to read it
 * first is the difference between copying and disclosing.
 */
interface CopyOutcome {
  ok: boolean;
  text: string;
}

const HINT = "Copy this comment's ids, log paths and refusals to the clipboard";

/**
 * The same promise, short enough for REX's own label under the glyph.
 *
 * The two tooltips never both apply, and which one is up says what state the
 * button is in. Before a press there is nothing to preview, so the label says
 * what the bug glyph does. After a press `title` carries the report itself, and
 * that is worth more than a word: it is what lets a reviewer read what they are
 * about to paste before they paste it.
 */
const TIP = "Copy debug report";

interface Props {
  threadId: string;
  /** The look this button takes from the row it sits in. */
  className: string;
  /** Added while the confirmation is up, for a row that marks it that way. */
  doneClassName?: string;
  /** A word beside the glyph. Off in a row that is icons only. */
  withLabel?: boolean;
}

export function DebugCopy(props: Props): React.JSX.Element {
  const [copied, setCopied] = useState<CopyOutcome | null>(null);

  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /** A new comment is a new report, so the old confirmation is not about it. */
  useEffect(() => setCopied(null), [props.threadId]);

  const copy = async (): Promise<void> => {
    try {
      setCopied({ ok: true, text: await window.rex.debugCopy(props.threadId) });
    } catch (error) {
      // A failure here is reported where the press was, not swallowed into a
      // console nobody has open — the whole point of the button is that the
      // reviewer is already trying to tell somebody something went wrong.
      setCopied({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const done = copied?.ok === true;
  const label = copied === null ? "debug" : done ? "copied" : "copy failed";
  const classes = [props.className, done ? props.doneClassName : null].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label={HINT}
      // A row that already prints the word beside the glyph needs no label.
      data-tip={copied === null && !props.withLabel ? TIP : undefined}
      title={copied?.text}
      onClick={copy}
    >
      {done ? <Check /> : <Bug />}
      {props.withLabel ? label : null}
    </button>
  );
}
