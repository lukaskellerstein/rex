// Spec 43 §7.3 — how long the run in front of you has been going.
//
// Its own component so the tick re-renders one span rather than the whole card,
// which is a list of every message in the thread. Its own FILE since 2026-09-04,
// because the trace sheet needs the same clock: a reviewer who opens the trace
// to watch a long run was the one person REX showed no clock to.

import { useEffect, useState } from "react";
import { spentText } from "../../shared/totals.ts";

/**
 * The clock beside `working…`.
 *
 * `since` is when the reviewer sent, in epoch milliseconds — normally the
 * `createdAt` of their own last message. It started at FIRST PAINT until
 * 2026-09-04, which meant the number restarted every time the reviewer left the
 * comment and came back, and under-reported a long run by however long they had
 * been reading something else. The send is the moment the reviewer is measuring
 * from, and it is written down, so there is no reason to guess it.
 *
 * Mount time is the fallback for a run whose send was never recorded — a NOTE
 * promoted mid-flight, an old thread — and it is only ever an under-count.
 */
export function Elapsed({ since }: { since: number | null }): React.JSX.Element {
  const [fallback] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const from = since !== null && Number.isFinite(since) ? since : fallback;
  return (
    <span className="rex-elapsed" title="How long this run has been going, since you sent">
      {spentText(now - from)}
    </span>
  );
}
