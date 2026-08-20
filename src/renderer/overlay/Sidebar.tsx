// SPEC.md §7 — all threads for the document, with the filters the spec names,
// plus the synthesis thread builder (§1 step 6).

import { useMemo, useState } from "react";
import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";
import { OrphanTray } from "./OrphanTray.tsx";

type Filter = "open" | "resolved" | "orphaned";

interface Props {
  threads: ThreadWithMessages[];
  stateById: Map<string, AnchorState>;
  busyThreads: string[];
  onSelect: (threadId: string) => void;
  onSynthesise: (refThreadIds: string[], note: string) => void;
}

export function Sidebar(props: Props): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>("open");
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const orphaned = useMemo(
    () => props.threads.filter((thread) => props.stateById.get(thread.id) === "orphaned"),
    [props.threads, props.stateById],
  );

  const visible = props.threads.filter((thread) => {
    if (filter === "orphaned") return props.stateById.get(thread.id) === "orphaned";
    if (props.stateById.get(thread.id) === "orphaned") return false;
    return thread.status === filter;
  });

  const toggle = (threadId: string): void =>
    setChosen((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [...current, threadId],
    );

  return (
    <div className="rex-sidebar">
      <nav className="rex-filters">
        {(["open", "resolved", "orphaned"] as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`rex-chip ${filter === option ? "rex-chip-on" : ""}`}
            onClick={() => setFilter(option)}
          >
            {option}
          </button>
        ))}
      </nav>

      {visible.length === 0 ? (
        <p className="rex-meta">No {filter} comments.</p>
      ) : (
        visible.map((thread, position) => {
          const state = props.stateById.get(thread.id) ?? thread.anchorState;
          return (
            <div key={thread.id} className="rex-item-row">
              {selecting ? (
                <input
                  type="checkbox"
                  aria-label={`Include comment ${position + 1}`}
                  checked={chosen.includes(thread.id)}
                  onChange={() => toggle(thread.id)}
                />
              ) : null}
              <button type="button" className="rex-item" onClick={() => props.onSelect(thread.id)}>
                <span className="rex-item-note">{thread.note}</span>
                {thread.anchor?.quote ? (
                  <span className="rex-quote rex-quote-small">{thread.anchor.quote.exact}</span>
                ) : null}
                <span className="rex-item-meta">
                  {thread.kind === "synthesis" ? "synthesis · " : ""}
                  {thread.messages.length} message(s)
                  {state === "moved" ? " · text changed" : ""}
                  {props.busyThreads.includes(thread.id) ? " · working…" : ""}
                </span>
              </button>
            </div>
          );
        })
      )}

      <section className="rex-synth">
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
          <button
            type="button"
            className="rex-button"
            disabled={props.threads.length < 2}
            onClick={() => setSelecting(true)}
          >
            Synthesis thread…
          </button>
        )}
      </section>

      {filter !== "orphaned" ? <OrphanTray threads={orphaned} onSelect={props.onSelect} /> : null}
    </div>
  );
}
