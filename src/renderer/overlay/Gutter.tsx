// SPEC.md §7 and design/screens/Main — one numbered marker per thread, at its
// anchor's vertical offset, carrying that anchor's state at full strength.
//
// Four states, one vocabulary shared with the cards and the highlights: steel
// ok, amber moved, outlined resolved, red lost. An orphan has no position to
// draw at, so rather than vanishing it pins to the foot of the gutter and says
// LOST — §6.6 keeps the comment, and the gutter has to keep saying so.

import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";
import type { ResolvedThread } from "./anchoring.ts";

interface Props {
  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  scrollY: number;
  onSelect: (threadId: string) => void;
}

/** The token's fill, from the thread's status and its anchor's state. */
export function tokenClass(status: string, state: AnchorState | null): string {
  if (status === "resolved") return "rex-token-done";
  if (state === "orphaned") return "rex-token-orphaned";
  if (state === "moved") return "rex-token-moved";
  return "";
}

function markerClass(status: string, state: AnchorState | null): string {
  if (status === "resolved") return "rex-marker-done";
  if (state === "orphaned") return "rex-marker-lost";
  if (state === "moved") return "rex-marker-moved";
  return "";
}

export function Gutter(props: Props): React.JSX.Element {
  const numbers = new Map(props.threads.map((thread, position) => [thread.id, position + 1]));
  const byId = new Map(props.threads.map((thread) => [thread.id, thread]));

  const placed = props.resolved.filter((entry) => entry.top !== null);
  const lost = props.resolved.filter((entry) => entry.top === null);

  const marker = (entry: ResolvedThread, pinned: boolean): React.JSX.Element | null => {
    const thread = byId.get(entry.threadId);
    if (!thread) return null;

    const classes = [
      "rex-marker",
      markerClass(thread.status, entry.state),
      props.activeId === thread.id ? "rex-marker-active" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const label =
      entry.state === "orphaned"
        ? " — anchor lost"
        : entry.state === "moved"
          ? " — text moved"
          : "";

    return (
      <button
        key={thread.id}
        type="button"
        className={classes}
        style={pinned ? undefined : { top: Math.max(2, (entry.top ?? 0) - props.scrollY) }}
        title={`${thread.note}${label}`}
        onClick={() => props.onSelect(thread.id)}
      >
        {numbers.get(thread.id)}
      </button>
    );
  };

  return (
    <div className="rex-gutter">
      {placed.map((entry) => marker(entry, false))}

      {lost.length > 0 ? (
        <div className="rex-marker-pinned">
          {lost.map((entry) => marker(entry, true))}
          <span className="rex-lost-label">LOST</span>
        </div>
      ) : null}
    </div>
  );
}
