// SPEC.md §8.7 step 5 — show the diff and WAIT.
//
// This is not optional: an agent must never change a file the user has not
// seen a diff for. Rejecting reverts the change with git checkout.

import type { ApplyReadyEvent } from "../../shared/channels.ts";

interface Props {
  event: ApplyReadyEvent;
  onDecide: (accept: boolean) => void;
}

export function DiffDialog(props: Props): React.JSX.Element {
  const lines = props.event.diff.split("\n");

  return (
    <div className="rex-modal">
      <div className="rex-dialog">
        <h2>Apply this change?</h2>
        <p className="rex-meta">
          {props.event.files.length === 0
            ? "The agent reported no file changes."
            : `Files: ${props.event.files.join(", ")}`}
        </p>
        <pre className="rex-diff">
          {lines.map((line, position) => (
            // A diff line has no id of its own; its position in the hunk is it.
            <span key={position} className={diffClass(line)}>
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
        <div className="rex-row">
          <button
            type="button"
            className="rex-button rex-primary"
            onClick={() => props.onDecide(true)}
          >
            Accept
          </button>
          <button
            type="button"
            className="rex-button rex-danger"
            onClick={() => props.onDecide(false)}
          >
            Reject and revert
          </button>
        </div>
      </div>
    </div>
  );
}

function diffClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "rex-diff-file";
  if (line.startsWith("+")) return "rex-diff-add";
  if (line.startsWith("-")) return "rex-diff-del";
  if (line.startsWith("@@")) return "rex-diff-hunk";
  return "";
}
