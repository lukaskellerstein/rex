// SPEC.md §8.7 step 5 and spec 05 §5.6.1 — show the change and WAIT.
//
// This is not optional: an agent must never change files the user has not seen.
// Undo restores every one of them with `git checkout`.
//
// It is a bar and not a dialog, and that is the whole point of §5.6.1. A modal
// over the document answers "what does this patch say" while hiding the thing it
// says it about; the reviewer wants to read the document as it now stands, with
// the changed sections outlined in it. So the patch text is here on demand, and
// the document stays visible behind.
//
// Two things stay from the old dialog because both are safety rather than
// decoration: the WRITE PROFILE pill, so it is obvious which of the two agents
// produced this, and a plain statement that keeping it re-runs anchoring and
// will move or orphan comments written on the removed text.

import { useState } from "react";
import type { ApplyReadyEvent, DeckPreview, DeckSlidePreview } from "../../shared/channels.ts";
import { type PlaceTally, placesWord, threadState } from "../../shared/targets.ts";
import type { ThreadStatus, ThreadWithMessages } from "../../shared/types.ts";
import { Pencil, Warning } from "./Icons.tsx";
import { tokenClass, washClass } from "./wash.ts";

/**
 * The comment's state, in words, for the sentence under the diff.
 *
 * It was the list row's word until spec 33 took the words off the row — a lost
 * place is a mark on a file chip there now. This sentence still wants one:
 * "the comment this patch answers" needs its subject named, and the lane and
 * the count are what name it.
 *
 * Spec 32 §2.2 — below the lanes, the word is a COUNT and not a verdict.
 * `anchor lost` on a comment with three live places is the sentence that spec
 * exists to delete, and `1 of 4 lost` is what it says instead.
 */
function StateWord({
  status,
  tally,
}: {
  status: ThreadStatus;
  tally: PlaceTally;
}): React.JSX.Element | null {
  if (status === "draft") return <span className="rex-state-draft">draft</span>;
  if (status === "note") return <span className="rex-state-unsent">note</span>;
  if (status === "resolved") return <span className="rex-state-resolved">resolved</span>;
  const word = placesWord(tally);
  if (!word) return null;
  const tone = word.tone === "lost" ? "rex-state-orphaned" : "rex-state-moved";
  return <span className={tone}>{word.text}</span>;
}

interface Props {
  event: ApplyReadyEvent;
  /** The comment this patch answers, so the change is never read out of context. */
  thread: ThreadWithMessages | null;
  number: number;
  /**
   * Spec 32 §5 — how that comment's places came out, counted.
   *
   * `places` and not `tally`, which this file already spends on the diff's own
   * added/removed line counts. One word, one meaning.
   */
  places: PlaceTally;
  /** How many sections are outlined in the document on screen right now. */
  outlined: number;
  openDocumentPath: string | null;
  onOpenFile: (path: string) => void;
  onDecide: (accept: boolean) => void;
}

interface Tally {
  added: number;
  removed: number;
}

/**
 * What the patch does to each file, in the two numbers a reviewer reads first.
 *
 * Per file, not per patch: Apply can now change several, and one pair of totals
 * repeated beside every name would be wrong for all but one of them.
 */
function tallyByFile(diff: string): Map<string, Tally> {
  const counts = new Map<string, Tally>();
  let current: Tally | null = null;

  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (header) {
      current = { added: 0, removed: 0 };
      counts.set(header[1].trim(), current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.added++;
    else if (line.startsWith("-") && !line.startsWith("---")) current.removed++;
  }

  return counts;
}

/**
 * The name a reviewer recognises. The whole identifier is on the title.
 *
 * A skipped document can be a URL, whose last path segment is meaningless — the
 * host is the part that names it.
 */
function baseName(identifier: string): string {
  if (/^https?:\/\//.test(identifier)) {
    try {
      return new URL(identifier).host;
    } catch {
      return identifier;
    }
  }
  return identifier.split("/").pop() ?? identifier;
}

/**
 * Spec 06 §7.2 — how much of this file the comment covers.
 *
 * The mechanism of Apply does not change, but one thing does and it must be
 * said in the dialog rather than left to be discovered: **a comment on a whole
 * document authorises an edit anywhere in that file.** The diff gate is what
 * makes that safe; the reviewer should still know what they are about to read
 * before they read it.
 *
 * The widest extent among the targets in that file wins, because that is what
 * was authorised. Null for an ordinary passage comment, where the +/− counts
 * already say everything.
 */
function coveredScope(thread: ThreadWithMessages | null, file: string): string | null {
  if (!thread) return null;
  const here = thread.targets.filter((_, position) => {
    const name = thread.targetNames[position];
    return name !== undefined && (file === name || file.endsWith(`/${name}`));
  });
  if (here.some((target) => target.anchor.extent === "document")) return "the whole document";
  const section = here.find((target) => target.anchor.extent === "section");
  if (!section) return null;
  const heading = section.anchor.quote?.exact?.trim();
  return heading ? `Section “${heading}”` : "one section";
}

function tallyFor(counts: Map<string, Tally>, file: string): Tally {
  // Main reports absolute paths; git's own headers are repository-relative, so
  // the two are matched by suffix rather than by equality.
  for (const [name, tally] of counts) {
    if (file === name || file.endsWith(`/${name}`)) return tally;
  }
  return { added: 0, removed: 0 };
}

function diffClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "rex-diff-file";
  if (line.startsWith("@@")) return "rex-diff-hunk";
  if (line.startsWith("+")) return "rex-diff-add";
  if (line.startsWith("-")) return "rex-diff-del";
  return "";
}

/**
 * Spec 11 §7.7 — how wide one slide picture is drawn in the review bar.
 *
 * Fixed rather than measured, and the scale is computed from the deck's own
 * slide size, so a 16:9 deck and a 4:3 deck are both drawn whole at the same
 * width. A preview that assumed one shape would letterbox or crop the other —
 * on the pictures that decide whether an edit is accepted.
 */
const PREVIEW_WIDTH = 380;
const PX_PER_POINT = 96 / 72;

/**
 * One slide, before and after, as two pictures.
 *
 * Each is the real page the reader emits, in an iframe sandboxed exactly as the
 * document iframe is — no `allow-scripts`, so the deck's own content runs
 * nothing here either. Scaled with a transform, because the page inside is laid
 * out in points at full size and must not be re-laid-out to be shown small: the
 * preview has to be the picture the reviewer will actually get.
 */
function SlidePair(props: { preview: DeckSlidePreview }): React.JSX.Element {
  const { preview } = props;
  const fullWidth = preview.widthPt * PX_PER_POINT;
  const fullHeight = preview.heightPt * PX_PER_POINT;
  const scale = PREVIEW_WIDTH / fullWidth;

  const frame = (html: string | null, label: string): React.JSX.Element => (
    <figure className="rex-deck-shot">
      <figcaption className="rex-meta">{label}</figcaption>
      <div
        className="rex-deck-shot-box"
        style={{ width: PREVIEW_WIDTH, height: Math.round(fullHeight * scale) }}
      >
        {html === null ? (
          <span className="rex-meta">This slide could not be drawn.</span>
        ) : (
          <iframe
            title={`Slide ${preview.slide} ${label}`}
            srcDoc={html}
            sandbox="allow-same-origin"
            style={{
              width: fullWidth,
              height: fullHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        )}
      </div>
    </figure>
  );

  // Spec 19 §7.2 — a notes change does not appear on the slide, so two
  // identical pictures would be the rubber stamp §7.7 exists to prevent. The
  // words go underneath the pictures, and only for the slides whose notes this
  // run actually named.
  const notes =
    preview.notesBefore === null && preview.notesAfter === null ? null : (
      <div className="rex-deck-notes">
        <figure className="rex-deck-note">
          <figcaption className="rex-meta">notes, before</figcaption>
          <p>{preview.notesBefore?.length ? preview.notesBefore : "— none —"}</p>
        </figure>
        <figure className="rex-deck-note">
          <figcaption className="rex-meta">notes, after</figcaption>
          <p>{preview.notesAfter?.length ? preview.notesAfter : "— none —"}</p>
        </figure>
      </div>
    );

  return (
    <div className="rex-deck-slide">
      <span className="rex-deck-slide-number">Slide {preview.slide}</span>
      <div className="rex-deck-pair">
        {frame(preview.before, "before")}
        {frame(preview.after, "after")}
      </div>
      {notes}
    </div>
  );
}

/**
 * Spec 11 §7.7 — the preview that replaces the diff, both halves of it.
 *
 * `git diff` on a `.pptx` prints `Binary files differ`, and spec 01 §8.7 step 5
 * is REX's entire safety story for Apply. The words are the first half; the
 * pictures are the half that catches what words cannot express — text that
 * overflows its shape, a style that is mechanically right and visually wrong, a
 * picture that does not suit the slide. A words-only summary reads as correct
 * in all three.
 */
function DeckReview(props: { decks: DeckPreview[] }): React.JSX.Element {
  return (
    <div className="rex-deck-review">
      {props.decks.map((deck) => (
        <section key={deck.deck} className="rex-deck-plan">
          <ol className="rex-deck-ops">
            {deck.operations.map((operation, position) => (
              // An operation has no id of its own; its position in the plan is it.
              <li key={position}>
                <span className="rex-pill rex-pill-op">{operation.op}</span>
                <span>{operation.summary}</span>
                {operation.flags.map((flag) => (
                  <span key={flag} className="rex-deck-flag">
                    <Warning />
                    {flag}
                  </span>
                ))}
              </li>
            ))}
          </ol>
          {deck.slides.map((slide) => (
            <SlidePair key={slide.slide} preview={slide} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function DiffDialog(props: Props): React.JSX.Element {
  const [showDiff, setShowDiff] = useState(false);
  const counts = tallyByFile(props.event.diff);
  const { event, thread } = props;

  // Spec 11 §7.7 — a deck run shows pictures instead of a patch, and the two
  // are never mixed: `apply.ts` refuses a run that would need both.
  const decks = event.decks ?? [];
  const isDeck = decks.length > 0;

  const hereChanged =
    props.openDocumentPath !== null && event.files.includes(props.openDocumentPath);

  // §5.6.1 — only Markdown carries `data-src-line`, so a changed HTML file has
  // nothing to outline. Saying so is the honest answer; guessing at a paragraph
  // is the silent wrong-place failure spec 01 §6.1 refuses.
  const operationCount = decks.reduce((total, deck) => total + deck.operations.length, 0);
  const heading = isDeck
    ? `${operationCount} change${operationCount === 1 ? "" : "s"} to this deck — shown before and after.`
    : !hereChanged
      ? "This document was not changed."
      : props.outlined > 0
        ? `${props.outlined} section${props.outlined === 1 ? "" : "s"} changed here — outlined in the document.`
        : "This document changed, but it carries no source lines to outline. The diff is below.";

  return (
    <section className="rex-review">
      <div className="rex-review-head">
        <span className="rex-dialog-icon">
          <Pencil size={16} />
        </span>
        <span className="rex-review-title">
          <strong>{heading}</strong>
          <span className="rex-meta">Nothing is final until you choose.</span>
        </span>
        <span className="rex-spacer" />
        <span className="rex-pill rex-pill-write">WRITE PROFILE</span>
        {isDeck ? null : (
          <button type="button" className="rex-link" onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? "hide the diff" : "show the diff"}
          </button>
        )}
        <button
          type="button"
          className="rex-button rex-primary"
          onClick={() => props.onDecide(true)}
        >
          OK
        </button>
        <button
          type="button"
          className="rex-button rex-button-write"
          onClick={() => props.onDecide(false)}
        >
          Undo
        </button>
      </div>

      {isDeck ? <DeckReview decks={decks} /> : null}

      <div className="rex-review-files">
        {event.files.length === 0 ? (
          <span className="rex-meta">
            {/*
              True in two cases, and worded for both: the agent wrote nothing,
              or it wrote and then took every line back. Either way each
              document is the same bytes it was, so its working copy is gone
              (`apply.ts`, `dropIfUnchanged`) and there is nothing to approve.
            */}
            Every document is as it was. There is nothing to approve.
          </span>
        ) : (
          event.files.map((file) => {
            const tally = tallyFor(counts, file);
            const open = file === props.openDocumentPath;
            const scope = coveredScope(thread, file);
            return (
              <button
                key={file}
                type="button"
                className={open ? "rex-file rex-file-open" : "rex-file"}
                title={open ? file : `${file} — open it to see the change in place`}
                disabled={open}
                onClick={() => props.onOpenFile(file)}
              >
                {baseName(file)}
                {/* §7.2 — what the comment covers here, before the counts of
                    what changed. A whole-document comment authorised an edit
                    anywhere in this file, and that is worth reading first. */}
                {scope ? <span className="rex-file-scope">{scope}</span> : null}
                {/* Spec 11 §7.7 — a deck has no line counts, and "+0 −0" beside
                    a real change reads as "nothing happened". The operations
                    and the pictures above are what say what changed. */}
                {isDeck ? null : (
                  <>
                    <span className="rex-file-add">+{tally.added}</span>
                    <span className="rex-file-del">−{tally.removed}</span>
                  </>
                )}
                {/* No count of "sections" here: the heading already says how
                    many are outlined in the document on screen, and a second
                    number using the same word for a different thing is how a
                    reviewer stops trusting either. */}
              </button>
            );
          })
        )}
      </div>

      {event.skipped.length > 0 ? (
        <p className="rex-meta rex-review-skipped">
          Not edited:{" "}
          {event.skipped.map((entry) => (
            <span key={entry.file} title={entry.reason}>
              {baseName(entry.file)}{" "}
            </span>
          ))}
        </p>
      ) : null}

      {showDiff && !isDeck ? (
        <>
          {thread ? (
            <div
              className={`rex-card-anchor ${washClass(thread.status, threadState(props.places))}`}
            >
              <div className="rex-card-anchor-head">
                <span
                  className={`rex-token ${tokenClass(thread.status, threadState(props.places))}`}
                >
                  {props.number}
                </span>
                <span className="rex-meta">
                  <StateWord status={thread.status} tally={props.places} /> the comment this patch
                  answers
                </span>
              </div>
              <p className="rex-card-note">{thread.note}</p>
            </div>
          ) : null}

          <pre className="rex-diff">
            {event.diff.split("\n").map((line, position) => (
              // A diff line has no id of its own; its position in the hunk is it.
              <span key={position} className={diffClass(line)}>
                {line || " "}
                {"\n"}
              </span>
            ))}
          </pre>
        </>
      ) : null}

      <p className="rex-warn">
        <Warning />
        {isDeck ? (
          // Spec 11 §7.1 — the guarantee here is stronger than on prose, and
          // saying so is not decoration: the reviewer is being asked to accept
          // a change to a file they cannot diff, and what protects them is that
          // the file has not been touched yet.
          <span>
            OK replaces the deck with the edited copy and re-runs anchoring. Comments written on
            text that changed will move or lose their anchor — they are kept either way, with the
            text they were written on. Undo throws the copy away;{" "}
            <strong>the deck itself has not been modified at any point</strong>.
          </span>
        ) : (
          <span>
            OK keeps the change and re-runs anchoring. Comments written against the removed text
            will move or lose their anchor — they are kept either way, with the text they were
            written on. Undo restores every file with <code>git checkout</code>.
          </span>
        )}
      </p>
    </section>
  );
}
