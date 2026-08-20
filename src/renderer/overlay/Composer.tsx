// design/screens/Compose, /selection/Escalate and /selection/Region — writing
// the comment, and choosing what it is written against.
//
// The scope chips are the widening control: selecting text inside a table is
// the common case and the table is often what the comment is really about, so
// the composer offers the enclosing structure rather than making the reviewer
// re-select. Every chip writes the same `Anchor` shape — no new fields.

import { useEffect, useRef, useState } from "react";
import type { AnchorStrength, PickScope } from "../anchor/pick.ts";
import type { DraftAnchor } from "./anchoring.ts";
import { Shield } from "./Icons.tsx";

interface Props {
  draft: DraftAnchor;
  /** Where the composer sits, already corrected for scroll. */
  top: number;
  /** `widget-service.md:14`, when the anchor knows its source line. */
  where: string | null;
  /** True while the reviewer is dragging a box inside the active element. */
  arming: boolean;
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

export function Composer(props: Props): React.JSX.Element {
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const { draft } = props;
  const scope = draft.scopes[draft.active] ?? draft.scopes[0];
  const region = draft.anchor.region;

  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  return (
    <div className="rex-composer" style={{ top: props.top }}>
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
        {scope ? <span className="rex-scope-title">{scope.title}</span> : null}
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
