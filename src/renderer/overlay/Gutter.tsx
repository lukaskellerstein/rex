// SPEC.md §7 — one numbered marker per resolved thread, at the anchor's
// vertical offset, coloured by status. Orphans are not here: they have no
// position to draw at, so they live in the tray (§6.6).

import type { ThreadWithMessages } from "../../shared/types.ts";
import type { ResolvedThread } from "./anchoring.ts";

interface Props {
  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  scrollY: number;
  onSelect: (threadId: string) => void;
}

export function Gutter(props: Props): React.JSX.Element {
  const numbers = new Map(props.threads.map((thread, position) => [thread.id, position + 1]));
  const byId = new Map(props.threads.map((thread) => [thread.id, thread]));

  return (
    <div className="rex-gutter">
      {props.resolved.map((entry) => {
        const thread = byId.get(entry.threadId);
        if (!thread || entry.top === null) return null;

        const classes = [
          "rex-marker",
          `rex-marker-${thread.status}`,
          entry.state === "moved" ? "rex-marker-moved" : "",
          props.activeId === thread.id ? "rex-marker-active" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={thread.id}
            type="button"
            className={classes}
            style={{ top: Math.max(2, entry.top - props.scrollY) }}
            title={`${thread.note}${entry.state === "moved" ? " — text changed" : ""}`}
            onClick={() => props.onSelect(thread.id)}
          >
            {numbers.get(thread.id)}
          </button>
        );
      })}
    </div>
  );
}
