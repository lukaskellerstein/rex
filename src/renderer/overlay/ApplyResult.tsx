// design/screens/Apply, the second state — what the write did to the comments.
//
// SPEC.md §8.7 step 7 requires the re-anchor sweep to be reported. A one-line
// notice could say "1 newly orphaned" and be technically complete; the design
// names the comment instead, because the reviewer's next question is always
// *which one*, and the answer is what tells them whether it mattered.

import type { AnchorSummary, ThreadWithMessages } from "../../shared/types.ts";
import { Check } from "./Icons.tsx";

interface Props {
  summary: AnchorSummary;
  files: string[];
  /** Threads that resolved before the write and do not now. */
  newlyOrphaned: ThreadWithMessages[];
  onClose: () => void;
  onShowOrphans: () => void;
}

export function ApplyResult(props: Props): React.JSX.Element {
  const lost = props.newlyOrphaned.length;

  return (
    <div className="rex-modal">
      <div className="rex-dialog rex-dialog-narrow">
        <header className="rex-dialog-head">
          <span className="rex-dialog-icon rex-dialog-icon-ok">
            <Check size={16} />
          </span>
          <span className="rex-dialog-title">
            <h2>Written, and re-anchored</h2>
            <p className="rex-node-path">{props.files.join(", ") || "the document"}</p>
          </span>
        </header>

        <div className="rex-dialog-body">
          <p className="rex-meta">
            Every comment on this document was resolved against the new text.
          </p>

          <div className="rex-stats">
            <div className="rex-stat">
              <span className="rex-stat-n">{props.summary.ok}</span>
              <span className="rex-stat-label">STILL EXACT</span>
            </div>
            <div className="rex-stat rex-stat-moved">
              <span className="rex-stat-n">{props.summary.moved}</span>
              <span className="rex-stat-label">MOVED</span>
            </div>
            <div className="rex-stat rex-stat-lost">
              <span className="rex-stat-n">{lost}</span>
              <span className="rex-stat-label">NEWLY LOST</span>
            </div>
          </div>

          {props.newlyOrphaned.map((thread) => (
            <div key={thread.id} className="rex-result-orphan">
              <span className="rex-token rex-token-orphaned">!</span>
              <span className="rex-result-orphan-text">
                <span>
                  “{thread.note}” lost its anchor — the text it was written on is the text this
                  patch replaced.
                </span>
                <span className="rex-meta">Kept, with its quote, in the orphaned filter.</span>
              </span>
            </div>
          ))}
        </div>

        <footer className="rex-dialog-foot">
          <button type="button" className="rex-button rex-primary" onClick={props.onClose}>
            Back to the document
          </button>
          {lost > 0 ? (
            <button type="button" className="rex-button" onClick={props.onShowOrphans}>
              Show the orphan{lost === 1 ? "" : "s"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
