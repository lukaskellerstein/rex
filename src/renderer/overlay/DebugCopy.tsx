// Spec 08 §6.2 — a run, on the clipboard, for pasting to whoever is going to
// fix it.
//
// The button was born in the trace sheet, because that is where a reviewer
// decides something is wrong. It is here in its own file because the card wants
// it too, and for the reason the card wants it: the sheet is one click away,
// and the reviewer who has just read a bad answer is looking at the card. Two
// copies of the copy would have been two chances to drift — one asks main for
// the report, the other forgets to say what went wrong when the ask fails.
//
// **Spec 55 gave it a third and fourth caller**, and that is why it takes the
// work to do rather than a thread id. Traffic's heads copy a chat's turns and
// one turn; the card and the sheet copy a comment. Four buttons, four reports,
// one timer and one failure path — which is the whole reason this file exists.
//
// It is never the APP's report. That one is the top bar's `B` (spec 13 §4): the
// port, the open document, the recent errors. These name something inside the
// app, and there is no thread to name from up there.

import { useEffect, useState } from "react";
import { Bug, Check } from "./Icons.tsx";

/** How long the button stays on its confirmation before going back. */
const COPIED_MS = 2500;

/**
 * What the last press did. `text` is the report itself on success and the
 * failure on failure; either way it becomes the button's `title`, so a reviewer
 * can see what they are about to paste before they paste it — REX's reports
 * carry absolute paths and a line of their document, and being able to read it
 * first is the difference between copying and disclosing.
 */
interface CopyOutcome {
  ok: boolean;
  text: string;
}

/**
 * The same promise, short enough for REX's own label under the glyph.
 *
 * The two tooltips never both apply, and which one is up says what state the
 * button is in. Before a press there is nothing to preview, so the label says
 * what the bug glyph does. After a press `title` carries the report itself, and
 * that is worth more than a word.
 */
const TIP = "Copy debug report";

interface Props {
  /**
   * The report, asked of main, which also writes it to the clipboard.
   *
   * A function and not an id: the four callers ask four different channels, and
   * a component that switched on a `kind` would be this file deciding something
   * the caller already knows.
   */
  copy: () => Promise<string>;
  /**
   * What the report is about — `comment`, `chat`, `turn`. The tooltip's word.
   */
  what: string;
  /** A new subject is a new report, so the old confirmation is not about it. */
  subject: string;
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

  useEffect(() => setCopied(null), [props.subject]);

  const press = async (): Promise<void> => {
    try {
      setCopied({ ok: true, text: await props.copy() });
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
      aria-label={`Copy this ${props.what}'s debug report to the clipboard`}
      // A row that already prints the word beside the glyph needs no label.
      data-tip={copied === null && !props.withLabel ? TIP : undefined}
      title={copied?.text}
      onClick={press}
    >
      {done ? <Check /> : <Bug />}
      {props.withLabel ? label : null}
    </button>
  );
}
