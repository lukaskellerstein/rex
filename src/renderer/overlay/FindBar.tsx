// Spec 28 §4.1 — the find bar.
//
// One row at the top right of the pane, beside the paper strip and drawn in
// the same light pill (spec 27 §4.1), because it sits on the paper and has to
// read on both papers. The bar is a convenience over the page: every match is
// painted the moment it is typed, and the count and the arrows only say which
// of them the reviewer is on.
//
// The field is an `<input>`, so `typing()` in `App.tsx` sees it and no bare
// letter fires a mode while the reviewer types a query. `esc` is handled here
// rather than left to the document listener for the same reason: that listener
// ignores keys typed in a field, correctly.

import { useEffect, useRef } from "react";
import { MAX_PAGE_MATCHES } from "../../shared/find.ts";

interface Props {
  query: string;
  count: number;
  /** The current match's index, or -1. */
  current: number;
  /** §4.3 — more than `MAX_PAGE_MATCHES` exist; `count` is the first thousand. */
  capped: boolean;
  /**
   * Bumped by every `⌘F`. The bar focuses its field and selects the text each
   * time, which is what a second `⌘F` means in every browser: type over it.
   */
  focusToken: number;
  onQuery: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/** `k of n`, `no matches`, or nothing at all while the field is empty. */
function countText(props: Props): string {
  if (props.query.trim().length === 0) return "";
  if (props.count === 0) return "no matches";
  const total = props.capped ? `${MAX_PAGE_MATCHES}+` : String(props.count);
  return `${props.current + 1} of ${total}`;
}

export function FindBar(props: Props): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [props.focusToken]);

  const empty = props.count === 0;
  const text = countText(props);

  return (
    <div className="rex-find" role="search">
      <input
        ref={field}
        className="rex-find-field"
        type="text"
        value={props.query}
        placeholder="Find in the page"
        aria-label="Find in the page"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => props.onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) props.onPrevious();
            else props.onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
          }
        }}
      />
      <span
        className={`rex-find-count${text === "no matches" ? " rex-find-none" : ""}`}
        aria-live="polite"
      >
        {text}
      </span>
      <button
        type="button"
        className="rex-find-button"
        title="Previous match — ⇧↵"
        aria-label="Previous match"
        disabled={empty}
        onClick={props.onPrevious}
      >
        ↑
      </button>
      <button
        type="button"
        className="rex-find-button"
        title="Next match — ↵"
        aria-label="Next match"
        disabled={empty}
        onClick={props.onNext}
      >
        ↓
      </button>
      <button
        type="button"
        className="rex-find-button"
        title="Close — esc"
        aria-label="Close find"
        onClick={props.onClose}
      >
        ×
      </button>
    </div>
  );
}
