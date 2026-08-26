// Spec 08 §4 — a mode control belongs where the mode acts.
//
// `Pick element` and `Pen` were the only MODES in the top bar, and a mode reads
// differently from an action: it is a state you are in, not a thing you did.
// The top bar holds facts about the document — its path, whether the file
// changed, what it has cost — and actions on it. These two belong at the foot
// of the paper, in the same strip that becomes the path bar or the pen bar the
// moment the mode is on. One place, one meaning.
//
// The keys are unchanged. `P` toggles pick, holding `⌥` turns it on while held,
// `N` toggles the pen, `esc` leaves either. §4 moved the button, not a binding.
// Spec 16 adds a third: held `⇧` arms Add.
//
// Drawn over the pane like every other mark REX makes — the outlines, the
// badges, the marquee. Nothing is written into the document.

interface Props {
  canPick: boolean;
  /**
   * Spec 16 §6.4 — Add, which the ORIGINAL pane never gets: you cannot add to a
   * version that is already fixed.
   */
  canAdd: boolean;
  /**
   * Spec 16 §4.1 — set in the new-version pane while a proposal exists.
   *
   * Pick and pen still work there, and §4 keeps them deliberately: a block the
   * agent just wrote is exactly what *"I do not like that, make it shorter"* is
   * about. But they answer **only on the blocks the change touched**, and a
   * mode that silently does nothing over three quarters of the page reads as
   * broken rather than as narrow.
   *
   * **It does not limit Add**, which is the whole reason this is drawn the way
   * it is below. Add names the space BETWEEN blocks, and every gap in the
   * document is offered whether or not the change touched what is either side.
   */
  narrow: boolean;
  onTogglePick: () => void;
  onTogglePen: () => void;
  onToggleAdd: () => void;
}

/** §4.1 — the same words the green outline already draws. */
const NARROW_NOTE = "only on the blocks this change touched — the ones outlined in green";

export function ModeStrip(props: Props): React.JSX.Element | null {
  if (!props.canPick) return null;
  const where = props.narrow ? ` — ${NARROW_NOTE}` : "";

  const pick = (
    <button
      type="button"
      className="rex-mode"
      title={`Pick an element to comment on — hold ⌥, or press P${where}`}
      onClick={props.onTogglePick}
    >
      <kbd className="rex-key">⌥</kbd>
      pick element
    </button>
  );

  const pen = (
    <button
      type="button"
      className="rex-mode"
      title={`Circle what the comment is about — N${where}`}
      onClick={props.onTogglePen}
    >
      <kbd className="rex-key">N</kbd>
      pen
    </button>
  );

  return (
    <div className="rex-modes">
      {/*
        §4.1 — the constraint is drawn AROUND the two gestures it constrains.

        It used to trail the strip as a loose caption, which put it beside
        `add` — the one gesture it does not limit — and attached it to nothing.
        A rule about two of three controls has to enclose those two: the label
        leads them, a dashed edge closes round them, and what is outside the
        edge is outside the rule.
      */}
      {props.narrow ? (
        <span className="rex-mode-scope">
          <span className="rex-mode-scope-label">changed blocks only</span>
          {pick}
          {pen}
        </span>
      ) : (
        <>
          {pick}
          {pen}
        </>
      )}

      {/*
        Spec 16 §6.6 — Add, held on with ⇧ exactly as pick is held on with ⌥.
        It is a mode, and a mode belongs on the strip that names the modes: a
        gesture nobody can find is a gesture nobody uses.
      */}
      {props.canAdd ? (
        <button
          type="button"
          className="rex-mode"
          title="Add something between two blocks — hold ⇧, or press A to add at what you are looking at. Every gap is offered, changed or not."
          onClick={props.onToggleAdd}
        >
          <kbd className="rex-key">⇧</kbd>
          add
        </button>
      ) : null}
    </div>
  );
}
