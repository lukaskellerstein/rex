// SPEC.md §6.6 and §7 — threads whose anchor no longer resolves.
//
// An orphaned thread is never deleted and never hidden. REX's own Apply
// creates orphans, so this is normal operation rather than an error path: the
// tray shows each one with the quote it was written against, so the comment can
// still be read as history.

import type { ThreadWithMessages } from "../../shared/types.ts";

interface Props {
  threads: ThreadWithMessages[];
  onSelect: (threadId: string) => void;
}

export function OrphanTray(props: Props): React.JSX.Element | null {
  if (props.threads.length === 0) return null;

  return (
    <section className="rex-tray">
      <h2 className="rex-tray-head">Orphaned · {props.threads.length}</h2>
      <p className="rex-meta">
        The text these were written against is gone. Nothing is lost — they keep their quote.
      </p>
      {props.threads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          className="rex-item rex-item-orphan"
          onClick={() => props.onSelect(thread.id)}
        >
          <span className="rex-item-note">{thread.note}</span>
          <span className="rex-quote rex-quote-small">
            {thread.anchor?.quote?.exact ?? "(element)"}
          </span>
        </button>
      ))}
    </section>
  );
}
