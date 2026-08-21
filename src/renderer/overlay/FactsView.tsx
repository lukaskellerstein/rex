// Spec 07 §8.1 and §8.5 — the Facts tab.
//
// **The list is the product.** The graph picture (§8.2) is a second view of the
// same data: good for seeing shape, bad for doing work.
//
// §8.5 decides what opening this tab does, and it is the difference between a
// tab that opens instantly and a tab that starts a three-day job. Clicking the
// tab is the trigger and nothing else is; of the five states only two build, and
// the dividing line is whether a previous build exists — because that is exactly
// what separates the incremental path (seconds) from the first one.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FactsProgressEvent, FactsStatusResponse } from "../../shared/channels.ts";
import type { Finding } from "../../shared/types.ts";

interface Props {
  root: string;
  /** Jump to a quote in its document — §8.1's **Open**. */
  onOpen: (documentPath: string, finding: Finding) => void;
  /** §8.4 — a finding becomes a comment about two documents. */
  onComment: (finding: Finding) => void;
}

/**
 * §7.3 — what a first build is likely to cost, so **Build** is an informed
 * decision rather than a surprise.
 *
 * Built from a measured rate rather than the spec's table. §7.3 puts 20
 * documents at about 40 minutes, but that assumes the `local` alias — a
 * mixture-of-experts model with ~4B active parameters (§5.1). §5.4's default is
 * `local-31b`, the terminal alias that cannot fall through to a cloud provider,
 * and it is a dense *reasoning* model: measured on 2026-08-21 it spent 2,214 and
 * 3,585 completion tokens on two passages of `components.md` at roughly 11
 * tokens/second, so **6 to 11 minutes per passage**, with a 50 KB document
 * yielding 44 passages.
 *
 * That is an order of magnitude away from §7.3, so the wording is deliberately
 * coarse and leans slow. A precise-looking "4 h 12 m" from a figure this
 * variable would be a lie with a decimal point, and the failure that matters is
 * a reviewer starting an overnight job believing it is a coffee break.
 */
function estimate(documents: number): string {
  if (documents === 0) return "nothing to read";
  if (documents <= 3) return "up to an hour on the local model";
  if (documents <= 20) return "many hours on the local model — an overnight job";
  return "days on the local model. Leave it running, and expect to resume it";
}

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * §8.1 — "Above the list, the build summary: counts, the aliases used, when it
 * ran, and whatever §7.4 requires it to admit."
 *
 * The admissions are the part that matters and the part that is easiest to drop:
 * a report that leaves them out reads as "everything was covered" when it was
 * not, which §7.4 forbids and §11 rule 6 repeats.
 */
function BuildSummary({
  status,
  findingCount,
}: {
  status: FactsStatusResponse;
  findingCount: number;
}): React.JSX.Element | null {
  const run = status.run;
  if (!run) return null;

  const admissions: string[] = [];
  if (run.droppedQuotes > 0) {
    admissions.push(`${run.droppedQuotes} claims dropped for a quote that was not verbatim`);
  }
  if (run.failedChunks > 0) admissions.push(`${run.failedChunks} passages could not be read`);

  return (
    <div className="rex-facts-summary">
      <span>
        {findingCount} candidate{findingCount === 1 ? "" : "s"} · built {relative(run.startedAt)} on{" "}
        <code>{run.aliasExtract}</code>
        {run.aliasJudge === run.aliasExtract ? null : (
          <>
            {" and "}
            <code>{run.aliasJudge}</code>
          </>
        )}
      </span>
      <span className="rex-meta">
        {run.subjectsMerged} subjects merged · {run.claimsMerged} claims merged
      </span>
      {admissions.length > 0 ? (
        <span className="rex-meta rex-facts-admission">{admissions.join(" · ")}</span>
      ) : null}
    </div>
  );
}

function FindingRow({
  finding,
  onOpen,
  onComment,
  onVerdict,
}: {
  finding: Finding;
  onOpen: (path: string, finding: Finding) => void;
  onComment: (finding: Finding) => void;
  onVerdict: (verdict: "confirmed" | "dismissed") => void;
}): React.JSX.Element {
  return (
    <li className={`rex-finding${finding.verdict ? ` rex-finding-${finding.verdict}` : ""}`}>
      <div className="rex-finding-head">
        <span className={`rex-pill rex-pill-${finding.kind}`}>
          {finding.kind === "supersedes" ? "SUPERSEDED" : "DISAGREES"}
        </span>
        <span className="rex-finding-subject">{finding.subject}</span>
        {finding.topicName ? <span className="rex-meta">{finding.topicName}</span> : null}
      </div>

      {/* Both quotes, side by side, with their document paths. §8.1 */}
      <div className="rex-finding-sides">
        {[finding.a, finding.b].map((side, index) => (
          <button
            key={side.claimId}
            type="button"
            className="rex-finding-side"
            title={`Open ${side.documentPath}`}
            onClick={() => onOpen(side.documentPath, finding)}
          >
            <span className="rex-finding-value">{side.value}</span>
            <q className="rex-finding-quote">{side.quote}</q>
            <span className="rex-meta">
              {fileName(side.documentPath)}
              {side.evidenceCount > 1 ? ` · stated in ${side.evidenceCount} documents` : null}
              {finding.kind === "supersedes" && index === 0 ? " · newer" : null}
            </span>
          </button>
        ))}
      </div>

      <div className="rex-finding-actions">
        <button type="button" className="rex-button" onClick={() => onComment(finding)}>
          Comment
        </button>
        <button
          type="button"
          className="rex-button"
          aria-pressed={finding.verdict === "confirmed"}
          onClick={() => onVerdict("confirmed")}
        >
          Confirm
        </button>
        <button type="button" className="rex-button" onClick={() => onVerdict("dismissed")}>
          Dismiss
        </button>
        {finding.threadIds.length > 0 ? (
          <span className="rex-meta">
            {finding.threadIds.length} comment{finding.threadIds.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function FactsView(props: Props): React.JSX.Element {
  const [status, setStatus] = useState<FactsStatusResponse | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [progress, setProgress] = useState<FactsProgressEvent | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFindings = useCallback(
    async (includeDismissed: boolean) => {
      setFindings(
        await window.rex.factsFindings({ root: props.root, filter: { includeDismissed } }),
      );
    },
    [props.root],
  );

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.rex.factsStatus({ root: props.root }));
      await refreshFindings(showDismissed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [props.root, refreshFindings, showDismissed]);

  // §8.5 — "clicking the tab calls facts:status and then branches". Mounting
  // this component *is* the click; nothing else starts a build.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      window.rex.onFactsProgress((event) => {
        // `ended` is the supervisor saying the build is over, however it ended —
        // done, cancelled, failed, or its process dying. Clearing `progress` is
        // what takes the bar down and puts §8.1's build summary back.
        if (event.message === "ended") {
          setProgress(null);
          void refresh();
          return;
        }
        setProgress(event);
      }),
    [refresh],
  );

  const build = async (resumeRunId?: string): Promise<void> => {
    setError(null);
    try {
      await window.rex.factsBuild({ root: props.root, resumeRunId });
      setStatus(await window.rex.factsStatus({ root: props.root }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // §8.5 — "Built, N documents changed: yes, at once. This is the incremental
  // path — seconds to minutes." The first build is never automatic.
  //
  // `autoBuilt` is a latch, and it is not paranoia. The state cycles
  // stale → running → stale while the tab is open, so anything that leaves the
  // workspace stale *after* a build makes this effect fire again, and again: a
  // workspace holding one unreadable document was measured producing 113 builds
  // in a few seconds. The root cause is fixed in `reads.ts`, and this makes the
  // whole class of it cost one wasted build instead of unbounded ones. The
  // reviewer can always press Build.
  const autoBuilt = useRef(false);
  useEffect(() => {
    if (autoBuilt.current) return;
    if (status?.state !== "stale" || (status.changedCount ?? 0) === 0) return;
    autoBuilt.current = true;
    void build();
  }, [status?.state, status?.changedCount]);

  const verdict = async (finding: Finding, decision: "confirmed" | "dismissed"): Promise<void> => {
    await window.rex.factsVerdict({ findingKey: finding.key, verdict: decision });
    await refreshFindings(showDismissed);
  };

  if (!status) return <p className="rex-meta rex-graph-loading">Reading the workspace…</p>;

  if (status.state === "unavailable") {
    return (
      <div className="rex-facts">
        <p className="rex-meta">{status.reason}</p>
      </div>
    );
  }

  const building = status.state === "running" || progress !== null;

  return (
    <div className="rex-facts">
      <header className="rex-facts-head">
        <h2>Facts</h2>
        {/*
          §11 rule 1 — "Say candidates, never all contradictions." The best
          measured method in the literature reaches about 60% recall and this one
          will do worse, so the UI must not imply completeness.
        */}
        <p className="rex-meta">
          Places where two documents may not agree. These are candidates for you to judge, not a
          complete list.
        </p>
      </header>

      {error ? <p className="rex-notice">{error}</p> : null}

      {status.state === "never-built" ? (
        <div className="rex-facts-empty">
          <p>
            {status.documentCount} documents in this workspace. Reading them takes{" "}
            {estimate(status.documentCount)}.
          </p>
          <button type="button" className="rex-button rex-primary" onClick={() => void build()}>
            Build
          </button>
        </div>
      ) : null}

      {status.state === "interrupted" ? (
        <div className="rex-facts-empty">
          <p>
            The last build stopped at {status.run?.done ?? 0} of {status.run?.total ?? 0} passages.
            Nothing was lost.
          </p>
          <button
            type="button"
            className="rex-button rex-primary"
            onClick={() => void build(status.run?.runId)}
          >
            Resume
          </button>
        </div>
      ) : null}

      {/*
        §8.5 — the progress bar never blocks the tab. The findings from the
        previous build stay readable, sortable and clickable while a new build
        runs: a build is not a modal state.
      */}
      {building && progress ? (
        <div className="rex-facts-progress">
          <span>{progress.message}</span>
          <progress value={progress.done} max={Math.max(progress.total, 1)} />
          <span className="rex-meta">
            {progress.done} of {progress.total}
          </span>
          <button
            type="button"
            className="rex-button"
            onClick={() => void window.rex.factsCancel(progress.runId)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <BuildSummary status={status} findingCount={findings.length} />

      {findings.length === 0 && status.state !== "never-built" ? (
        <p className="rex-meta">
          No disagreements found. That is not proof there are none — see the note above.
        </p>
      ) : null}

      <ul className="rex-finding-list">
        {findings.map((finding) => (
          <FindingRow
            key={finding.key}
            finding={finding}
            onOpen={props.onOpen}
            onComment={props.onComment}
            onVerdict={(decision) => void verdict(finding, decision)}
          />
        ))}
      </ul>

      {findings.length > 0 || showDismissed ? (
        <button
          type="button"
          className="rex-link"
          onClick={() => {
            const next = !showDismissed;
            setShowDismissed(next);
            void refreshFindings(next);
          }}
        >
          {showDismissed ? "hide dismissed" : "show dismissed"}
        </button>
      ) : null}
    </div>
  );
}
