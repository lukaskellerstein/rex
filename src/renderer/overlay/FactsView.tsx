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
import type { FactStage, Finding } from "../../shared/types.ts";
import { topicColour } from "./FactGraph.tsx";
import { Check, ChevronDown, Warning } from "./Icons.tsx";

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
 * What each stage is doing, in the worker's own words.
 *
 * Needed because a build that is already running when this tab is opened has
 * sent its progress events to nobody: the subscription lives with the
 * component, and switching to Document unmounts it. The `fact_run` row survives
 * that — §6.4 keeps stage and cursor in the database precisely so a build can
 * be picked up again — but it stores the stage as a word, not a sentence.
 */
const STAGE_MESSAGE: Record<FactStage, string> = {
  scan: "Reading documents",
  chunk: "Splitting documents",
  extract: "Extracting claims",
  canonical: "Merging subjects",
  judge: "Comparing claims",
  topics: "Naming topics",
};

/**
 * A failed command, in words about the thing that failed.
 *
 * Electron wraps anything an `invoke` handler throws as `Error invoking remote
 * method 'facts:build': Error: …`, and that prefix names REX's own IPC channel
 * — which is true, useless, and the first thing the reviewer reads. The message
 * underneath is the one written for them, so the wrapper comes off.
 */
function readable(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "");
}

/**
 * §8.1 — "Above the list, the build summary: counts, the aliases used, when it
 * ran, and whatever §7.4 requires it to admit."
 *
 * The admissions are the part that matters and the part that is easiest to drop:
 * a report that leaves them out reads as "everything was covered" when it was
 * not, which §7.4 forbids and §11 rule 6 repeats.
 */
/**
 * Spec 08 §8.2 — what the last build did NOT cover.
 *
 * §7.4 and §11 rule 6 both forbid capping anything silently: a report that
 * leaves these out reads as "everything was covered" when it was not. Amber,
 * because it is an admission about the build, not a finding about the
 * documents.
 */
function Dropped({ status }: { status: FactsStatusResponse }): React.JSX.Element | null {
  const run = status.run;
  if (!run) return null;

  const admissions: string[] = [];
  if (run.droppedQuotes > 0) {
    admissions.push(
      `${run.droppedQuotes} claim${run.droppedQuotes === 1 ? "" : "s"} dropped for a quote that was not verbatim`,
    );
  }
  if (run.failedChunks > 0) {
    admissions.push(
      `${run.failedChunks} passage${run.failedChunks === 1 ? "" : "s"} could not be read`,
    );
  }
  if (admissions.length === 0) return null;

  return (
    <div className="rex-facts-dropped">
      <Warning />
      <span>Not everything was covered: {admissions.join(", and ")}.</span>
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
  // Spec 08 §8.3 — a note ABOUT a finding is not part of the finding. Closed
  // until asked for, one flag per row so opening one never opens the next.
  const [details, setDetails] = useState(false);

  const notes: Array<[string, string]> = [];
  const stated = Math.max(finding.a.evidenceCount, finding.b.evidenceCount);
  if (stated > 1) {
    notes.push([
      "EVIDENCE",
      `Stated in ${stated} documents, ${Math.min(finding.a.evidenceCount, finding.b.evidenceCount)} against. That is not a vote — REX reports the pair and you decide.`,
    ]);
  }
  if (finding.kind === "supersedes") {
    notes.push(["OLDER CLAIM", "Its window is closed, not deleted."]);
    notes.push(["DATES", "Taken from the text itself, never from the model's opinion."]);
  }
  if (finding.verdict === "dismissed") {
    notes.push(["DISMISSED", "Stays hidden across rebuilds — the key is the two quotes."]);
  }

  return (
    <li className={`rex-finding${finding.verdict ? ` rex-finding-${finding.verdict}` : ""}`}>
      <div className="rex-finding-head">
        <span className={`rex-pill rex-pill-${finding.kind}`}>
          {finding.kind === "supersedes" ? "SUPERSEDES" : "CONTRADICTS"}
        </span>
        <span className="rex-finding-subject">{finding.subject}</span>
        {finding.topicName ? (
          <span className="rex-finding-topic">
            <span className="rex-swatch" style={{ background: topicColour(finding.topicId) }} />
            {finding.topicName}
          </span>
        ) : null}
        {finding.verdict === "confirmed" ? (
          <span className="rex-finding-confirm">
            <Check />
            confirmed
          </span>
        ) : null}
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

        {notes.length > 0 ? (
          <button
            type="button"
            className="rex-finding-details"
            aria-expanded={details}
            onClick={() => setDetails(!details)}
          >
            details
            <ChevronDown />
          </button>
        ) : null}
      </div>

      {/*
        Spec 08 §8.3 — each line labelled inside, so the label says what the
        line IS. A disclosure and not a tooltip: these are longer than a tooltip
        holds, and a tooltip is reachable by neither touch nor keyboard.
      */}
      {details ? (
        <dl className="rex-finding-notes">
          {notes.map(([label, text]) => (
            <div key={label}>
              <dt className="rex-label">{label}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
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
      setError(readable(cause));
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
      setError(readable(cause));
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
    // A build that cannot start must not be started automatically either. The
    // incremental path fires on opening the tab, so without this a workspace
    // with no gateway key threw an error banner every single time it was
    // opened, for something the reviewer never asked for.
    if (!status?.buildEnabled) return;
    if (status.state !== "stale" || (status.changedCount ?? 0) === 0) return;
    autoBuilt.current = true;
    void build();
  }, [status?.state, status?.changedCount, status?.buildEnabled]);

  const verdict = async (finding: Finding, decision: "confirmed" | "dismissed"): Promise<void> => {
    await window.rex.factsVerdict({ findingKey: finding.key, verdict: decision });
    await refreshFindings(showDismissed);
  };

  if (!status) return <p className="rex-meta rex-graph-loading">Reading the workspace…</p>;

  const building = status.state === "running" || progress !== null;
  const run = status.run;

  /*
    What the bar draws: the live event if one has arrived, and otherwise the
    `fact_run` row.

    The fallback is the whole point. Progress events reach a MOUNTED component,
    and switching to Document unmounts this one — so coming back to a build that
    has been running for ten minutes showed "BUILDING starting" and no bar at
    all, until the next event happened to land. The build was fine; the tab was
    simply reporting from nothing. §6.4 already persists stage and cursor for
    resuming, and that is exactly what the reader needs here too.
  */
  const live =
    progress ??
    (run && status.state === "running"
      ? {
          runId: run.runId,
          stage: run.stage,
          done: run.done,
          total: run.total,
          message: STAGE_MESSAGE[run.stage],
        }
      : null);
  // Said before the button is pressed rather than after it fails, and shown
  // even when the strip is in a state that has no Build of its own — a
  // workspace whose findings are readable but cannot be refreshed should say so
  // while the reviewer is deciding whether to trust them.
  const blocked = status.buildEnabled ? null : status.buildDisabledReason;

  return (
    <div className="rex-facts">
      {error ? <p className="rex-notice">{error}</p> : null}
      {blocked && !error ? <p className="rex-notice">{blocked}</p> : null}

      {/*
        Spec 08 §8.2 — ONE strip, in exactly one state, and it always ends in
        the same sentence.

        §11 rule 1 governs every word of it: say CANDIDATES, never "all
        contradictions". The best measured method in the literature reaches
        about 60% recall and this one will do worse, so the strip says so in
        plain words every time — whether the build is done, running, or refused
        to start.
      */}
      <section
        className={`rex-facts-strip${status.state === "unavailable" ? " rex-facts-strip-stop" : ""}`}
      >
        <div className="rex-facts-strip-head">
          {status.state === "unavailable" ? (
            <>
              <span className="rex-label rex-facts-stop">CANNOT START</span>
              <span>{status.reason}</span>
              <span className="rex-spacer" />
              <button type="button" className="rex-button" onClick={() => void refresh()}>
                Check again
              </button>
            </>
          ) : building ? (
            <>
              <span className="rex-label rex-facts-running">
                <span className="rex-spinner" />
                BUILDING
              </span>
              <span>{live?.message ?? "starting"}</span>
              <span className="rex-spacer" />
              {live ? (
                <>
                  <progress value={live.done} max={Math.max(live.total, 1)} />
                  <span className="rex-meta-mono">
                    {/* Passages, not documents — a build splits each document
                        into many (§4.2), so `8 / 56` over seven files reads as
                        a count of files unless it says otherwise. */}
                    {live.done} / {live.total} passages
                  </span>
                  <button
                    type="button"
                    className="rex-button rex-button-write"
                    onClick={() => void window.rex.factsCancel(live.runId)}
                  >
                    Cancel
                  </button>
                </>
              ) : null}
            </>
          ) : status.state === "never-built" ? (
            <>
              <span className="rex-label">NOT BUILT</span>
              <span>
                {status.documentCount} documents. Reading them takes{" "}
                {estimate(status.documentCount)}.
              </span>
              <span className="rex-spacer" />
              <button
                type="button"
                className="rex-button rex-primary"
                disabled={!status.buildEnabled}
                title={status.buildDisabledReason ?? undefined}
                onClick={() => void build()}
              >
                Build
              </button>
            </>
          ) : status.state === "interrupted" ? (
            <>
              <span className="rex-label rex-facts-running">INTERRUPTED</span>
              <span>
                Stopped at {run?.done ?? 0} of {run?.total ?? 0} passages. Nothing was lost.
              </span>
              <span className="rex-spacer" />
              <button
                type="button"
                className="rex-button rex-primary"
                disabled={!status.buildEnabled}
                title={status.buildDisabledReason ?? undefined}
                onClick={() => void build(run?.runId)}
              >
                Resume
              </button>
            </>
          ) : (
            <>
              <span className="rex-label rex-facts-built">
                <Check />
                BUILT
              </span>
              <span className="rex-meta-mono">
                {findings.length} candidate{findings.length === 1 ? "" : "s"} ·{" "}
                {run?.subjectsMerged ?? 0} subjects merged · {run?.claimsMerged ?? 0} claims merged
              </span>
              <span className="rex-spacer" />
              {run ? (
                <span className="rex-meta-mono" title="Extract · judge and name topics">
                  {run.aliasExtract}
                  {run.aliasJudge === run.aliasExtract ? "" : ` · ${run.aliasJudge}`}
                </span>
              ) : null}
              {run ? <span className="rex-meta-mono">{relative(run.startedAt)}</span> : null}
              <button
                type="button"
                className="rex-button"
                disabled={!status.buildEnabled}
                title={status.buildDisabledReason ?? undefined}
                onClick={() => void build()}
              >
                Rebuild
              </button>
            </>
          )}
        </div>

        <Dropped status={status} />

        {building ? (
          <span className="rex-meta">
            A first build of a folder this size runs on your own machine at no cost.{" "}
            <strong>You can close REX</strong> — it starts again where it stopped, not at the
            beginning. The findings below are from the last build until this one finishes.
          </span>
        ) : null}

        {status.state === "unavailable" ? (
          <span className="rex-meta rex-facts-admission">
            Neither missing model has a fallback, on purpose — a build that quietly reached for a
            cloud model would send your documents off this machine. So this is a stop, not a wait.
          </span>
        ) : null}

        <span className="rex-meta">
          <strong>These are candidates, not all the contradictions.</strong> The best measured
          method finds about 60% of them; this one will find fewer. Read every row before you trust
          it — and REX never edits a document from a finding.
        </span>
      </section>

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
