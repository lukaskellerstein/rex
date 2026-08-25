// Spec 12 §7.1 — the mode, on the card, while the run is happening.
//
// `CommentCard` drew a profile pill before this, and drew it on the ANSWER block
// — so it appeared only once the run had finished. A refusal appears during the
// run, which is exactly when there was nothing on screen saying which mode was
// running or what that mode is allowed to do. The reviewer saw DENIED in red
// with no frame around it.
//
// It is a BAND under the card's head rather than a row inside the card, and
// that placement is the fix to the first draft. Inside the card it scrolled
// away with the conversation, and it read as a caption on the anchor block
// below it — a note about the comment rather than a state the agent is in.
// Here it is a peer of the head: full width, always on screen, and the only
// thing between "which comment" and "what happened".
//
// One card, one mode, one place: the answer block keeps no pill of its own.

import { Shield } from "./Icons.tsx";
import { MODE_LABEL, MODE_PROMISE, type Mode } from "./mode.ts";

export function ModeBadge({ mode, busy }: { mode: Mode; busy: boolean }): React.JSX.Element {
  return (
    <div className={`rex-mode-badge rex-mode-${mode}`}>
      <Shield size={13} />
      <span className="rex-mode-name">{MODE_LABEL[mode]}</span>

      {/*
        The mode is a standing fact; this says it is being exercised RIGHT NOW.
        Without it the band answers "what may this agent do" and leaves "is it
        doing it" to the spinner further down, which scrolls away.
      */}
      {busy ? <span className="rex-mode-live" aria-label="running" /> : null}

      {/*
        The promise, not a restatement of the label. ACT is drawn in Apply's
        own tone rather than ASK's, so the flip is visible before the word is
        read — on a column this narrow that is what survives being scrolled past.
      */}
      <span className="rex-mode-promise">{MODE_PROMISE[mode]}</span>
    </div>
  );
}
