// Spec 61 §5 — a chat's whole size in tokens, and under the pointer what it is
// made of.
//
// The total is the number on the line because it is the one the reviewer asked
// for first. In, out and the cache are the breakdown, and a breakdown is read
// on demand, so it waits for a hover rather than widening a line that already
// says turns, time and price.
//
// `position: fixed` and not `[data-tip]`: the trace head clips its summary with
// `overflow: hidden`, and an absolutely placed label inside it is cut off. A
// fixed box escapes that, the way the context menu does.

import { useRef, useState } from "react";
import { type TokenTotals, tokensText } from "../../shared/totals.ts";

const exact = new Intl.NumberFormat("en-US");

/** Wide enough for `written to cache` and a nine-digit count. */
const POP_WIDTH = 210;

export function TokenCount({ tokens }: { tokens: TokenTotals }): React.JSX.Element {
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  const show = (): void => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    // Kept inside the window: the card's numbers sit at the panel's right edge.
    const left = Math.max(8, Math.min(box.left, window.innerWidth - POP_WIDTH - 8));
    setAt({ top: box.bottom + 5, left });
  };
  const hide = (): void => setAt(null);

  // A cache count that was never reported is left out rather than drawn as 0.
  const rows: Array<[string, number | null, boolean]> = [
    ["in", tokens.input, false],
    ["read from cache", tokens.cacheRead, true],
    ["written to cache", tokens.cacheWrite, true],
    ["out", tokens.output, false],
  ];

  return (
    <span
      ref={anchor}
      className="rex-tokens"
      // Focus opens the breakdown for the keyboard too.
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {`${tokensText(tokens.total)} tokens`}
      {at ? (
        <span className="rex-tokens-pop" role="tooltip" style={{ top: at.top, left: at.left }}>
          <span className="rex-tokens-row rex-tokens-total">
            <span>total</span>
            <span>{exact.format(tokens.total)}</span>
          </span>
          {rows.map(([label, count, part]) =>
            count === null ? null : (
              <span key={label} className={`rex-tokens-row${part ? " rex-tokens-part" : ""}`}>
                <span>{label}</span>
                <span>{exact.format(count)}</span>
              </span>
            ),
          )}
        </span>
      ) : null}
    </span>
  );
}
