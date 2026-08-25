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
//
// Drawn over the pane like every other mark REX makes — the outlines, the
// badges, the marquee. Nothing is written into the document.

interface Props {
  canPick: boolean;
  onTogglePick: () => void;
  onTogglePen: () => void;
}

export function ModeStrip(props: Props): React.JSX.Element | null {
  if (!props.canPick) return null;

  return (
    <div className="rex-modes">
      <button
        type="button"
        className="rex-mode"
        title="Pick an element to comment on — hold ⌥, or press P"
        onClick={props.onTogglePick}
      >
        <kbd className="rex-key">⌥</kbd>
        pick element
      </button>

      <button
        type="button"
        className="rex-mode"
        title="Circle what the comment is about — N"
        onClick={props.onTogglePen}
      >
        <kbd className="rex-key">N</kbd>
        pen
      </button>
    </div>
  );
}
