// design/screens/Threads — every comment on the document, filtered.
//
// The chips carry their own counts, so the filter row doubles as the tally and
// the panel needs no second header to say how many of what there are.

import { useMemo, useState } from "react";
import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";
import { Lines } from "./Icons.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

type Filter = "open" | "resolved" | "orphaned";

interface Props {
  threads: ThreadWithMessages[];
  stateById: Map<string, AnchorState>;
  labelById: Map<string, string | null>;
  busyThreads: string[];
  onSelect: (threadId: string) => void;
  onSynthesise: (refThreadIds: string[], note: string) => void;
}

const FILTERS: Filter[] = ["open", "resolved", "orphaned"];

export function Sidebar(props: Props): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>("open");
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");

  /** One rule, used for both the chip counts and the list. */
  const belongsTo = useMemo(() => {
    const state = props.stateById;
    return (thread: ThreadWithMessages, which: Filter): boolean => {
      const orphaned = state.get(thread.id) === "orphaned";
      if (which === "orphaned") return orphaned;
      return !orphaned && thread.status === which;
    };
  }, [props.stateById]);

  const numbers = new Map(props.threads.map((thread, position) => [thread.id, position + 1]));
  const counts = Object.fromEntries(
    FILTERS.map((which) => [which, props.threads.filter((t) => belongsTo(t, which)).length]),
  ) as Record<Filter, number>;

  const visible = props.threads.filter((thread) => belongsTo(thread, filter));

  const toggle = (threadId: string): void =>
    setChosen((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [...current, threadId],
    );

  return (
    <>
      <nav className="rex-side-head rex-filters">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={`rex-chip ${filter === option ? "rex-chip-on" : ""}`}
            onClick={() => setFilter(option)}
          >
            {option}
            <span className={`rex-chip-count rex-chip-count-${option}`}>{counts[option]}</span>
          </button>
        ))}
      </nav>

      <div className="rex-side-scroll">
        {filter === "orphaned" && visible.length > 0 ? (
          // §6.6 — REX's own Apply creates orphans, so this is normal operation
          // rather than an error path, and the panel says so plainly.
          <p className="rex-orphan-note">
            The text these were written against is gone. Nothing is lost — each keeps the quote it
            was written on, and REX's own Apply is a normal way to create one.
          </p>
        ) : null}

        {visible.length === 0 ? (
          <p className="rex-meta">No {filter} comments.</p>
        ) : (
          visible.map((thread) => (
            <div key={thread.id} className="rex-row">
              {selecting ? (
                <input
                  type="checkbox"
                  aria-label={`Include comment ${numbers.get(thread.id)}`}
                  checked={chosen.includes(thread.id)}
                  onChange={() => toggle(thread.id)}
                />
              ) : null}
              <ThreadRow
                thread={thread}
                number={numbers.get(thread.id) ?? 0}
                state={props.stateById.get(thread.id) ?? thread.anchorState}
                label={props.labelById.get(thread.id) ?? null}
                selected={false}
                busy={props.busyThreads.includes(thread.id)}
                onSelect={() => props.onSelect(thread.id)}
              />
            </div>
          ))
        )}

        {filter !== "orphaned" && counts.orphaned > 0 ? (
          <button type="button" className="rex-tray" onClick={() => setFilter("orphaned")}>
            {counts.orphaned} comment{counts.orphaned === 1 ? "" : "s"} lost{" "}
            {counts.orphaned === 1 ? "its" : "their"} anchor
            <span className="rex-tray-more">show</span>
          </button>
        ) : null}
      </div>

      <div className="rex-side-foot">
        {selecting ? (
          <>
            <p className="rex-meta">
              Pick the comments to discuss together, then say what to ask about them.
            </p>
            <textarea
              className="rex-input"
              placeholder="e.g. do comments 2 and 5 contradict each other?"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="rex-row">
              <button
                type="button"
                className="rex-button rex-primary"
                disabled={chosen.length < 2 || note.trim().length === 0}
                onClick={() => {
                  props.onSynthesise(chosen, note.trim());
                  setSelecting(false);
                  setChosen([]);
                  setNote("");
                }}
              >
                Ask about {chosen.length}
              </button>
              <button type="button" className="rex-button" onClick={() => setSelecting(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="rex-button"
              disabled={props.threads.length < 2}
              onClick={() => setSelecting(true)}
            >
              <Lines />
              Synthesis thread…
            </button>
            <span className="rex-meta">discuss several comments together</span>
          </>
        )}
      </div>
    </>
  );
}
