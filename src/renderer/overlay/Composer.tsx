// design/screens/Compose, /selection/Escalate and /selection/Region — writing
// the comment, and choosing what it is written against.
//
// The scope chips are the widening control: selecting text inside a table is
// the common case and the table is often what the comment is really about, so
// the composer offers the enclosing structure rather than making the reviewer
// re-select. Every chip writes the same `Anchor` shape — no new fields.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Anchor } from "../../shared/types.ts";
import type { AnchorStrength, PickScope, ScopeRect } from "../anchor/pick.ts";
import type { DraftAnchor } from "./anchoring.ts";
import { Shield } from "./Icons.tsx";

/**
 * A second, third, … place the same comment is about.
 *
 * The label is captured when the element is picked rather than derived later:
 * the composer has no access to the document's DOM, and the chain the label
 * came from is replaced by the next probe.
 */
export interface ExtraTarget {
  anchor: Anchor;
  label: string;
  /**
   * Where it sits, in document coordinates, so the pane can outline it while
   * the comment is being written. Captured at the click for the same reason as
   * the label: the anchor alone would have to be resolved again to find a box,
   * and the chain it came from is gone by the next probe.
   */
  rect: ScopeRect;
  /** The document zoom `rect` was measured at, so it can be redrawn at another. */
  zoom: number;
}

interface Props {
  draft: DraftAnchor;
  /** Where the composer sits, already corrected for scroll. */
  top: number;
  /** `widget-service.md:14`, when the anchor knows its source line. */
  where: string | null;
  /** True while the reviewer is dragging a box inside the active element. */
  arming: boolean;
  /** True while pick mode is on, so the hint is worth showing. */
  picking: boolean;
  /** True while the next click adds a target rather than replacing the draft. */
  adding: boolean;
  extras: ExtraTarget[];
  onAddAnother: () => void;
  onRemoveExtra: (position: number) => void;
  onScope: (index: number) => void;
  onArmRegion: () => void;
  onCreate: (note: string) => void;
  onCancel: () => void;
}

/**
 * The design's chip words rather than tag names. `td` is what gets stored; a
 * reviewer choosing between scopes is choosing between a cell and a row.
 */
const CHIP_WORDS: Record<string, string> = {
  td: "cell",
  th: "cell",
  tr: "row",
  table: "table",
  thead: "header",
  tbody: "table",
  p: "paragraph",
  li: "item",
  ul: "list",
  ol: "list",
  pre: "code",
  blockquote: "quote",
  figure: "figure",
  figcaption: "caption",
  img: "image",
  svg: "drawing",
  canvas: "drawing",
  section: "section",
  article: "article",
  div: "block",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
};

function chipWord(scope: PickScope): string {
  if (scope.kind === "text") return "text";
  const tag = scope.label.split("#")[0];
  return CHIP_WORDS[tag] ?? tag;
}

const STRENGTH_WORD: Record<AnchorStrength, string> = {
  durable: "Durable",
  fair: "Fair",
  weak: "Weak",
};

const STRENGTH_BARS: Record<AnchorStrength, number> = { durable: 3, fair: 2, weak: 1 };

/**
 * Shown before the click because the reviewer can act on it: a bare element
 * with no id and no text is a positional path and nothing else, and widening
 * one level usually reaches something with text.
 */
export function Strength({ scope }: { scope: PickScope }): React.JSX.Element {
  const lit = STRENGTH_BARS[scope.strength];
  return (
    <span className={`rex-strength rex-strength-${scope.strength}`}>
      <span className="rex-strength-bars" aria-hidden="true">
        {[0, 1, 2].map((bar) => (
          // Three fixed positions, so the index is the identity.
          <i key={bar} className={bar < lit ? "" : "rex-off"} />
        ))}
      </span>
      <span>
        <strong>{STRENGTH_WORD[scope.strength]}</strong> — {scope.strengthNote}
      </span>
    </span>
  );
}

/** Clearance kept between the card and the edges of the document pane. */
const MARGIN = 8;

export function Composer(props: Props): React.JSX.Element {
  const [note, setNote] = useState("");
  const [lift, setLift] = useState(0);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { draft } = props;
  const scope = draft.scopes[draft.active] ?? draft.scopes[0];
  const region = draft.anchor.region;

  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  /**
   * A card that hangs off the bottom of the pane reads as no card at all.
   *
   * The composer opens level with what it is anchored to, and the pane clips
   * anything past its edge (`overflow: hidden`). Anchor to something in the
   * lower third and most of the card — the note box and the Ask button with it —
   * is simply not there, which is indistinguishable from the click having done
   * nothing. So it is measured once it exists and lifted back inside.
   */
  useLayoutEffect(() => {
    const card = cardRef.current;
    const pane = card?.offsetParent;
    if (!card || !(pane instanceof HTMLElement)) return;
    // Measured back to where the card *would* sit unlifted, so the answer does
    // not depend on what the last pass decided.
    const bottom = card.getBoundingClientRect().bottom + lift;
    const overflow = bottom - pane.getBoundingClientRect().bottom + MARGIN;
    // Never lifted past the top of the pane: a card taller than the pane
    // scrolls inside itself rather than starting off-screen.
    setLift(Math.min(Math.max(0, overflow), Math.max(0, props.top - MARGIN)));
  }, [props.top, lift]);

  return (
    <div ref={cardRef} className="rex-composer" style={{ top: props.top - lift }}>
      <div className="rex-composer-head">
        <span className="rex-label">NEW COMMENT</span>
        {props.where ? <span className="rex-composer-where">{props.where}</span> : null}
      </div>

      {draft.scopes.length > 1 ? (
        <div className="rex-scope-block">
          <span className="rex-label">ANCHOR TO</span>
          <div className="rex-scopes">
            {draft.scopes.map((option) => (
              <button
                key={option.index}
                type="button"
                className={option.index === draft.active ? "rex-scope rex-scope-on" : "rex-scope"}
                title={option.title}
                onClick={() => props.onScope(option.index)}
              >
                {chipWord(option)}
              </button>
            ))}
            {scope?.regionCapable ? (
              <button
                type="button"
                className={region ? "rex-scope rex-scope-on" : "rex-scope"}
                title="Drag a box inside it — stored as fractions, so it survives a resize"
                onClick={props.onArmRegion}
              >
                a region of it
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rex-scope-detail">
        {scope ? (
          <span className="rex-scope-title">
            {/* Numbered only when there is something to tell it apart from. */}
            {props.extras.length > 0 ? <span className="rex-place-index">1</span> : null}
            {scope.title}
          </span>
        ) : null}
        {scope?.quote ? (
          <blockquote className="rex-quote rex-quote-small">{scope.quote}</blockquote>
        ) : null}
        {region ? (
          <span className="rex-scope-mono">
            x {region.x.toFixed(2)} · y {region.y.toFixed(2)} · w {region.w.toFixed(2)} · h{" "}
            {region.h.toFixed(2)}
          </span>
        ) : null}
        <span className="rex-scope-note">
          {region ? "fractions of the box · survives a resize" : (scope?.detail ?? "")}
        </span>
      </div>

      {/*
        One comment, several places. The list is here rather than in the
        document because the reviewer is reading the note while deciding
        whether the third row really belongs in the same question.
      */}
      <div className="rex-scope-block">
        {props.extras.length > 0 ? (
          <>
            <span className="rex-label">AND ALSO · {props.extras.length}</span>
            <ul className="rex-extras">
              {props.extras.map((extra, position) => (
                // The same element can legitimately be added twice (two regions
                // of one figure), so the position is the identity.
                <li key={`${extra.label}-${position}`}>
                  {/* The primary target is 1, so the extras start at 2 — the
                      same numbers the outlines in the document carry. */}
                  <span className="rex-place-index">{position + 2}</span>
                  <span className="rex-extra-label">{extra.label}</span>
                  <button
                    type="button"
                    className="rex-link"
                    aria-label={`Remove ${extra.label}`}
                    onClick={() => props.onRemoveExtra(position)}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {/*
          The button, and not only the shift-click, is the point. The note field
          takes focus the moment this card opens, and every bare-letter shortcut
          is suppressed while it has focus — so `P` cannot re-enter pick mode
          from here, and a reviewer who did not already know about shift-click
          had no way in at all.
        */}
        {props.adding ? (
          <span className="rex-scope-note">
            Click another element to add it. Press <span className="rex-key">esc</span> when the
            comment is about every place you meant.
          </span>
        ) : (
          <button type="button" className="rex-link rex-add-place" onClick={props.onAddAnother}>
            + another place
          </button>
        )}
      </div>

      {props.arming && !region ? (
        <span className="rex-scope-note">
          Drag a box inside the element to cut a region from it.
        </span>
      ) : null}

      {scope && scope.kind === "element" ? <Strength scope={scope} /> : null}

      <textarea
        ref={noteRef}
        className="rex-input"
        placeholder="What about this?"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onCancel();
        }}
      />

      <div className="rex-row">
        <button
          type="button"
          className="rex-button rex-primary"
          disabled={note.trim().length === 0}
          onClick={() => props.onCreate(note.trim())}
        >
          Ask
        </button>
        <button type="button" className="rex-button" onClick={props.onCancel}>
          Cancel
        </button>
        <span className="rex-readonly" title="The read profile cannot write to disk">
          <Shield />
          read-only
        </span>
      </div>
    </div>
  );
}
