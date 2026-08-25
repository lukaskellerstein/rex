// Spec 12 §3.1 — how a mode is chosen, in the same place it is used.
//
// A segmented control rather than a dropdown, and the reason is the same one
// that put the band above the card: a mode is a STATE. A dropdown hides the
// option you did not pick behind a click, and hides the one you DID pick behind
// a glance at a closed menu. With exactly two options, both always relevant,
// there is nothing to gain by folding them away.
//
// The same component sits in the selection panel's foot and in the comment
// card's reply row (§3.2). There is one way to choose a mode in REX.

import { MODE_LABEL, MODE_PROMISE, type Mode } from "./mode.ts";

/** §3.1 — the key is drawn, because a shortcut nobody can see is unused. */
export const MODE_CHORD_HINT = "shift + tab";

/**
 * True for the chord that toggles the mode. Bound on the two prompt boxes.
 *
 * **⇧⇥ rather than a modifier chord**, and the reason is the hand: the mode is
 * chosen while typing the thing it applies to, so the gesture has to be reachable
 * without leaving the home row. ⌘⇧M was the first attempt and never fired for
 * the reviewer — a letter chord has to survive the keyboard layout, the window
 * manager and macOS's own reservations, and ⇧⇥ is a key the box already receives.
 *
 * The cost is real and worth stating: ⇧⇥ is how a keyboard user walks focus
 * BACKWARDS out of a field, and inside these two boxes it no longer does. Plain
 * ⇥ still moves focus forward, so the box is not a trap.
 *
 * Every modifier is checked, not just shift. ⌥⇧⇥ and ⌘⇧⇥ belong to the window
 * manager, and swallowing them here would break switching apps from inside a
 * comment.
 */
export function isModeChord(event: React.KeyboardEvent | KeyboardEvent): boolean {
  return (
    event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
  );
}

export function other(mode: Mode): Mode {
  return mode === "ask" ? "act" : "ask";
}

interface Props {
  mode: Mode;
  /**
   * §3.4 — why ACT cannot run here, or null when it can.
   *
   * This is `applyDisabledReason`, which spec 05 §5.6 already computes for the
   * Apply button: a comment on a rendered PDF page has nothing to write to. The
   * reason is not recomputed, it just moves to where the choice is now made.
   */
  actDisabled: string | null;
  onPick: (mode: Mode) => void;
}

export function ModeSwitch({ mode, actDisabled, onPick }: Props): React.JSX.Element {
  return (
    <div className="rex-modeswitch">
      {/*
        A track with a filled thumb, not two bordered buttons side by side.
        Bordering both said "here are two things you may press"; what a mode
        control has to say first is "you are in this one". So the unselected
        segment carries no chrome at all, and the selected one is a solid pill
        in its mode's accent.
      */}
      <div className="rex-modetrack" role="group" aria-label="Mode">
        {(["ask", "act"] as const).map((option) => {
          const off = option === "act" && actDisabled !== null;
          return (
            <button
              key={option}
              type="button"
              className={`rex-modeseg rex-modeseg-${option}${mode === option ? " rex-modeseg-on" : ""}`}
              aria-pressed={mode === option}
              disabled={off}
              // The promise is the tooltip, so the control explains itself
              // without the band having to be on screen — in the selection panel
              // there is no card yet, and so no band.
              title={off ? (actDisabled ?? "") : `${MODE_LABEL[option]} — ${MODE_PROMISE[option]}`}
              onClick={() => onPick(option)}
            >
              {MODE_LABEL[option]}
            </button>
          );
        })}
      </div>

      {/*
        Plain dim text, not a `.rex-key` cap. The cap is a bordered box, and
        beside a two-segment control it read as a third segment — which is what
        it looked like on screen.
      */}
      <span className="rex-modehint" title={`Switch mode — ${MODE_CHORD_HINT}`}>
        ⇧⇥
      </span>
    </div>
  );
}
