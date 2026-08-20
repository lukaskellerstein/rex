// SPEC.md §8.7 step 5 and design/screens/Apply — show the diff and WAIT.
//
// This is not optional: an agent must never change a file the user has not seen
// a diff for. Rejecting reverts the change with git checkout.
//
// The design adds two things the old dialog left implicit, and both are safety
// rather than decoration: the WRITE PROFILE pill, so it is obvious which of the
// two agents produced this, and a plain statement that accepting re-runs
// anchoring and will move or orphan comments written on the removed text.

import type { ApplyReadyEvent } from "../../shared/channels.ts";
import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";
import { tokenClass } from "./Gutter.tsx";
import { Pencil, Warning } from "./Icons.tsx";
import { StateWord, washClass } from "./ThreadRow.tsx";

interface Props {
  event: ApplyReadyEvent;
  /** The comment this patch answers, so the diff is never read out of context. */
  thread: ThreadWithMessages | null;
  number: number;
  anchorState: AnchorState | null;
  onDecide: (accept: boolean) => void;
}

interface Tally {
  added: number;
  removed: number;
}

/** What the patch does to the file, in the two numbers a reviewer reads first. */
function tally(diff: string): Tally {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

function diffClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "rex-diff-file";
  if (line.startsWith("@@")) return "rex-diff-hunk";
  if (line.startsWith("+")) return "rex-diff-add";
  if (line.startsWith("-")) return "rex-diff-del";
  return "";
}

export function DiffDialog(props: Props): React.JSX.Element {
  const lines = props.event.diff.split("\n");
  const counts = tally(props.event.diff);
  const { thread } = props;

  return (
    <div className="rex-modal">
      <div className="rex-dialog">
        <header className="rex-dialog-head">
          <span className="rex-dialog-icon">
            <Pencil size={16} />
          </span>
          <span className="rex-dialog-title">
            <h2>Apply this change?</h2>
            <p>A write-capable agent produced this patch. Nothing has been written to disk yet.</p>
          </span>
          <span className="rex-spacer" />
          <span className="rex-pill rex-pill-write">WRITE PROFILE</span>
        </header>

        <div className="rex-dialog-body">
          {thread ? (
            <div className={`rex-card-anchor ${washClass(thread.status, props.anchorState)}`}>
              <div className="rex-card-anchor-head">
                <span className={`rex-token ${tokenClass(thread.status, props.anchorState)}`}>
                  {props.number}
                </span>
                <span className="rex-meta">
                  <StateWord status={thread.status} state={props.anchorState} /> the comment this
                  patch answers
                </span>
              </div>
              <p className="rex-card-note">{thread.note}</p>
            </div>
          ) : null}

          <div className="rex-files">
            <span className="rex-label">FILES</span>
            {props.event.files.length === 0 ? (
              <span className="rex-meta">The agent reported no file changes.</span>
            ) : (
              props.event.files.map((file) => (
                <span key={file} className="rex-file">
                  {file}
                  <span className="rex-file-add">+{counts.added}</span>
                  <span className="rex-file-del">−{counts.removed}</span>
                </span>
              ))
            )}
          </div>

          <pre className="rex-diff">
            {lines.map((line, position) => (
              // A diff line has no id of its own; its position in the hunk is it.
              <span key={position} className={diffClass(line)}>
                {line || " "}
                {"\n"}
              </span>
            ))}
          </pre>

          <p className="rex-warn">
            <Warning />
            <span>
              Accepting rewrites the file on disk and re-runs anchoring. Comments written against
              the removed text will move or lose their anchor — they are kept either way, with the
              text they were written on.
            </span>
          </p>
        </div>

        <footer className="rex-dialog-foot">
          <button
            type="button"
            className="rex-button rex-primary"
            onClick={() => props.onDecide(true)}
          >
            Accept and write
          </button>
          <button
            type="button"
            className="rex-button rex-button-write"
            onClick={() => props.onDecide(false)}
          >
            Reject and revert
          </button>
          <span className="rex-dialog-foot-note">git checkout restores the file if you reject</span>
        </footer>
      </div>
    </div>
  );
}
