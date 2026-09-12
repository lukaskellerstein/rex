// Spec 41 §2 — one block's text, on the clipboard.
//
// It sits in the head of every block the chat and the trace draw, after the
// clock, and it is invisible until the pointer is over the block. What it
// copies is decided elsewhere — `trace.ts`'s `textOf` for the sheet, the
// turn's own parts for the card — because the copy rules are data and this
// file is a button.
//
// The clipboard is the RENDERER's here, and not main's as `DebugCopy` uses.
// The rule is which process owns the string: the debug report exists only in
// main, so main writes it; these words are already on this screen, and the
// click that asked for them is proof this window has focus. The tree's
// `copy path` settled the same question the same way.
//
// Not shared with `DebugCopy`, which looks like it and is not: that button
// asks main for a string that does not exist yet, can fail before there is
// anything to copy at all, and hangs the report in its own `title` so the
// reviewer can read what they are about to paste. The overlap is a timer.

import { useEffect, useState } from "react";
import { Check, Copy } from "./Icons.tsx";

/**
 * How long the tick stays up. The tree's `copy path` flash, and the same
 * number for the same job — long enough to be seen, short enough that it is
 * gone before the next block is hovered.
 */
const COPIED_FLASH_MS = 1400;

interface Props {
  /** The whole text this block puts on the clipboard. */
  text: string;
  /** What the tooltip calls it: `question`, `answer`, `step`. */
  what: string;
  /**
   * A word beside the glyph, for when two copies sit next to each other.
   *
   * Depth 4 offers one value in two forms — the JSON structure and the text —
   * and two identical glyphs a few pixels apart is a choice nobody can make.
   * Everywhere else there is one copy and the glyph alone is the whole control,
   * so this is left out and nothing changes.
   */
  label?: string;
}

export function CopyText({ text, what, label }: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /** A block that changed under the button is not the block that was copied. */
  useEffect(() => setCopied(false), [text]);

  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      // No tick is the honest report: nothing was copied, and the reviewer can
      // press again. A dialog over a one-glyph action is worse than the
      // failure it announces, and the tree's `copy path` fails this way too.
      (error) => console.warn("[rex] could not copy the text", error),
    );
  };

  return (
    <button
      type="button"
      className={[copied ? "rex-copy rex-copy-done" : "rex-copy", label ? "rex-copy-named" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Copy this ${what} to the clipboard`}
      // With a word beside it the tip says which of the two this is; without
      // one there is nothing to tell apart and `Copy` is the whole story.
      data-tip={copied ? undefined : label ? `Copy the ${what}` : "Copy"}
      onClick={copy}
    >
      {copied ? <Check size={12} /> : <Copy />}
      {label ? <span className="rex-copy-label">{label}</span> : null}
    </button>
  );
}
