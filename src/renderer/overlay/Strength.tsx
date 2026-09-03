// How well an anchor on this scope would survive an edit.
//
// Spec 26 §4.1 gave it a second home: the panel's expanded row spells it out in
// words, and the path bar draws the bars alone with the sentence in a tooltip.
// One component with a `bare` switch rather than two, because the two must
// never disagree about how many bars a `fair` anchor lights.

import type { AnchorStrength, PickScope } from "../anchor/pick.ts";

const STRENGTH_WORD: Record<AnchorStrength, string> = {
  durable: "Durable",
  fair: "Fair",
  weak: "Weak",
};

const STRENGTH_BARS: Record<AnchorStrength, number> = { durable: 3, fair: 2, weak: 1 };

interface Props {
  scope: PickScope;
  /**
   * Spec 26 §4.1 — bars only, for the 34px bar. The words move into the title,
   * so nothing is lost, and the meter still says at a glance that one level
   * wider is worth taking.
   */
  bare?: boolean;
}

/**
 * Shown where the reviewer can act on it: a bare element with no id and no text
 * is a positional path and nothing else, and widening one level usually reaches
 * something with text. Never on a collapsed row — nine of them each carrying a
 * meter is a wall (spec 05 §4).
 */
export function Strength({ scope, bare = false }: Props): React.JSX.Element {
  const lit = STRENGTH_BARS[scope.strength];
  const words = `${STRENGTH_WORD[scope.strength]} — ${scope.strengthNote}`;

  return (
    <span
      className={`rex-strength rex-strength-${scope.strength}${bare ? " rex-strength-bare" : ""}`}
      title={bare ? words : undefined}
    >
      <span className="rex-strength-bars" aria-hidden="true">
        {[0, 1, 2].map((bar) => (
          // Three fixed positions, so the index is the identity.
          <i key={bar} className={bar < lit ? "" : "rex-off"} />
        ))}
      </span>
      {/*
        The words are the accessible name in both forms. Hidden visually rather
        than dropped when `bare`: a title attribute is not read reliably, and a
        meter with no text is three coloured rectangles.
      */}
      <span className={bare ? "rex-sr-only" : undefined}>
        <strong>{STRENGTH_WORD[scope.strength]}</strong> — {scope.strengthNote}
      </span>
    </span>
  );
}
