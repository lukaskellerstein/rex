// Spec 05 §3 — selecting is a phase, and this is where it stands.
//
// It replaces the floating composer, whose three faults were one fault: a
// transient card is the wrong home for something built up over time. This panel
// cannot steal a shortcut (its field is focused only when clicked), cannot be
// dismissed by accident (only `clear` or Ask empties it), and cannot inherit a
// previous selection (there is one panel and its contents are visible).
//
// It lives at the top of the right sidebar, above the comments, and it is gone
// when there is nothing in it.

import { useState } from "react";
import type { RegionRef } from "../../shared/types.ts";
import type { AnchorStrength, PickScope } from "../anchor/pick.ts";
import { Shield } from "./Icons.tsx";
import type { SelectionItem } from "./selection.ts";

interface Props {
  items: SelectionItem[];
  note: string;
  /** The open document. A row from anywhere else cannot be widened (§4.1). */
  openDocumentId: string | null;
  /** The row whose scope chips are showing, if any. */
  expandedId: string | null;
  /** The chain rebuilt from that row's anchor (§4.1). Null when it has none. */
  scopes: PickScope[] | null;
  scopeActive: number;
  /** True while a box is being dragged inside the active element. */
  arming: boolean;
  hoveredId: string | null;
  onNote: (note: string) => void;
  onExpand: (item: SelectionItem) => void;
  onScope: (index: number) => void;
  onArmRegion: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onAsk: () => void;
  onHover: (id: string | null) => void;
  onReorder: (from: number, to: number) => void;
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

/**
 * A PDF's two scopes already arrive as words — `line` and `page 3` — because
 * "span" and "div" tell a reviewer nothing about a page of a document
 * (`pick.ts`, `labelOf`). They fall through the table unchanged.
 */
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
 * Shown on the expanded row only, because the reviewer can act on it: a bare
 * element with no id and no text is a positional path and nothing else, and
 * widening one level usually reaches something with text. Nine collapsed rows
 * each carrying a strength meter is a wall (§4).
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

/** §3.2 — everything in the panel was picked by hand, so emptying it asks. */
const CONFIRM_ABOVE = 3;

/**
 * Whether a box was really cut out of the element, or covers all of it.
 *
 * Every anchor in a PDF is a region of its page (spec 03 §7.3), so a whole
 * page arrives with a region of the full box and the chip lit as though a
 * region had been dragged. Fractions, so 1 × 1 is the whole thing.
 */
function isCutOut(region: RegionRef | null): boolean {
  return region !== null && (region.w < 1 || region.h < 1);
}

export function SelectionPanel(props: Props): React.JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null);

  const clear = (): void => {
    const worthAsking = props.items.length > CONFIRM_ABOVE || props.note.trim().length > 0;
    if (worthAsking && !window.confirm(`Empty the selection? ${props.items.length} places.`)) {
      return;
    }
    props.onClear();
  };

  const scope = props.scopes?.[props.scopeActive] ?? null;

  return (
    <section className="rex-selection">
      <header className="rex-side-head">
        <span className="rex-label">SELECTION · {props.items.length}</span>
        <span className="rex-spacer" />
        <button type="button" className="rex-link" onClick={clear}>
          clear
        </button>
      </header>

      <ol className="rex-selection-list">
        {props.items.map((item, position) => {
          const expanded = props.expandedId === item.id;
          const here = item.documentId === props.openDocumentId;

          return (
            <li
              key={item.id}
              className={[
                "rex-selection-item",
                expanded ? "rex-selection-open" : "",
                props.hoveredId === item.id ? "rex-selection-lit" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              // §3.2 — the order is the order the agent is given them in, and
              // `targets[0]` is what Apply's prompt leads with.
              draggable
              onDragStart={() => setDragging(position)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) props.onReorder(dragging, position);
                setDragging(null);
              }}
              onMouseEnter={() => props.onHover(item.id)}
              onMouseLeave={() => props.onHover(null)}
            >
              <div className="rex-selection-row">
                <button
                  type="button"
                  className="rex-selection-main"
                  // §3.3 — a row from another document opens it and scrolls
                  // there; a row from this one just scrolls and opens its chips.
                  onClick={() => props.onExpand(item)}
                >
                  <span className="rex-place-index">{position + 1}</span>
                  <span className="rex-selection-body">
                    <span className="rex-selection-label">{item.label}</span>
                    {/* Always, not only when it differs: a list where the
                        document appears sometimes is a list you read twice. */}
                    <span className="rex-selection-doc">{item.documentName}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="rex-selection-remove"
                  aria-label={`Remove ${item.label}`}
                  title="Remove this place"
                  onClick={() => props.onRemove(item.id)}
                >
                  ×
                </button>
              </div>

              {expanded ? (
                <div className="rex-selection-detail">
                  {props.scopes && props.scopes.length > 0 && here ? (
                    <>
                      <div className="rex-scopes">
                        {props.scopes.map((option) => (
                          <button
                            key={option.index}
                            type="button"
                            className={
                              option.index === props.scopeActive
                                ? "rex-scope rex-scope-on"
                                : "rex-scope"
                            }
                            title={option.title}
                            onClick={() => props.onScope(option.index)}
                          >
                            {chipWord(option)}
                          </button>
                        ))}
                        {scope?.regionCapable ? (
                          <button
                            type="button"
                            className={
                              isCutOut(item.anchor.region) ? "rex-scope rex-scope-on" : "rex-scope"
                            }
                            title="Drag a box inside it — stored as fractions, so it survives a resize"
                            onClick={props.onArmRegion}
                          >
                            a region of it
                          </button>
                        ) : null}
                      </div>
                      {props.arming ? (
                        <span className="rex-scope-note">
                          Drag a box inside the element to cut a region from it.
                        </span>
                      ) : null}
                      {scope && scope.kind === "element" ? <Strength scope={scope} /> : null}
                    </>
                  ) : (
                    <span className="rex-scope-note">
                      {here
                        ? "This place cannot be widened — it no longer resolves in the document."
                        : `Open ${item.documentName} to widen this place.`}
                    </span>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="rex-selection-foot">
        <textarea
          className="rex-input"
          placeholder="What about these?"
          value={props.note}
          onChange={(event) => props.onNote(event.target.value)}
        />
        <div className="rex-row">
          <button
            type="button"
            className="rex-button rex-primary"
            // The note is the question; without it there is nothing to ask.
            disabled={props.note.trim().length === 0}
            onClick={props.onAsk}
          >
            Ask about {props.items.length}
          </button>
          <span className="rex-readonly" title="The read profile cannot write to disk">
            <Shield />
            read-only
          </span>
        </div>
      </div>
    </section>
  );
}
