// Spec 05 §3 — selecting is a phase, and this is where it stands.
//
// It replaces the floating composer, whose three faults were one fault: a
// transient card is the wrong home for something built up over time. This panel
// cannot steal a shortcut (its field is focused only when clicked), cannot be
// dismissed by accident (only `clear` or Ask empties it), and cannot inherit a
// previous selection (there is one panel and its contents are visible).
//
// Spec 37 §2 — it is the card's foot before there is a card. The places sit
// above the box they are sent with, under `PLACES n`, exactly where an open
// comment keeps the places picked for its next reply (spec 24 §3.2); the body
// above them is the conversation that does not exist yet. A new comment used
// to be a list at the top of an empty column with the box 900px below it, and
// pressing Ask turned that into a screen of a different shape.

import { useRef, useState } from "react";
import { type AgentChoices, DEFAULT_STYLE, type RegionRef } from "../../shared/types.ts";
import { type PickScope, scopeWord } from "../anchor/pick.ts";
import type { GatewayChoice } from "./Composer.tsx";
import { Trash } from "./Icons.tsx";
import { onSendChord, SEND_CHORD_HINT, SendChord } from "./keys.tsx";
import { ModelPick, styleRows } from "./ModelPick.tsx";
import { isModeChord, ModeSwitch, other } from "./ModeSwitch.tsx";
import { MODE_VERB, type Mode } from "./mode.ts";
import { ReplyGrip } from "./ReplyGrip.tsx";
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
  /**
   * Spec 12 §3.2 — ASK for a new comment, always. A comment is a question until
   * its author says otherwise, and the switch is how they say otherwise.
   */
  mode: Mode;
  onMode: (mode: Mode) => void;
  /**
   * Spec 25 §7.1 — the models on offer, and the model this comment will use.
   *
   * `model: null` is "follow the default", which is what a new comment does
   * until the reviewer says otherwise.
   */
  models: AgentChoices;
  model: string | null;
  onModel: (model: string | null) => void;
  /**
   * Spec 43 §4 — the gateway, to the left of the model, on the panel too.
   *
   * The control sits on every surface a send can start from, because §2.6 rule
   * 1 is that every send picks: a panel that could only use the default would
   * make "pick a gateway" mean "pick it after the first answer".
   */
  gateways: GatewayChoice;
  gateway: string;
  onGateway: (gatewayId: string) => void;
  onManageGateways: () => void;
  /** Spec 31 §2.2 — the style the next comment is made with. Never null. */
  style: string;
  onStyle: (style: string) => void;
  /** Sends in `mode`. §4 — ASK goes to `thread:ask`, ACT to `thread:apply`. */
  onAsk: () => void;
  onHover: (id: string | null) => void;
  onReorder: (from: number, to: number) => void;
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

/** "this place" / "these 3 places" — used in three tooltips, so it is written once. */
function places(count: number): string {
  return count === 1 ? "this place" : `these ${count} places`;
}

export function SelectionPanel(props: Props): React.JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null);
  /**
   * The height of the box, once the reviewer has dragged its top edge. Null
   * until then, and the stylesheet decides. The same handle as the card's, for
   * the same reason: a question worth asking is often longer than two lines.
   */
  const [noteHeight, setNoteHeight] = useState<number | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /**
   * The note is the question; without it there is nothing to ask. Spec 37 §2.1
   * — and it needs a place: the box is drawn before any is picked, so the
   * button is what says a comment about nothing cannot be sent.
   */
  const canAsk = props.note.trim().length > 0 && props.items.length > 0;

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
      {/*
        Spec 37 §2.1 — the body: the conversation that does not exist yet. It
        holds the hint that says how picking starts, while nothing is picked,
        and nothing else.
      */}
      <div className="rex-composer-body" ref={bodyRef}>
        {props.items.length === 0 ? (
          <p className="rex-meta">
            Nothing selected. Select text, or press <strong>P</strong> to pick an element — every
            place you click is added below, above the box.
          </p>
        ) : null}
      </div>

      <ReplyGrip box={noteRef} above={bodyRef} label="the box" onChange={setNoteHeight} />

      <div className="rex-selection-foot">
        {/*
          Spec 37 §2.1 — the places, above the box they are sent with: spec 24
          §3.2's strip, before there is a card. `PLACES n` is the card head's
          word for the same list (spec 35 §2.4), and `clear` sits where the
          card's strip has `new comment ›`.

          Spec 08 §3.2 — `clear` acts on the selection only, so it lives with
          the selection, and deliberately far from the send at the foot: a
          destructive action next to the primary one is a slip waiting to happen.
        */}
        {props.items.length > 0 ? (
          <div className="rex-pending">
            <div className="rex-pending-head">
              <span className="rex-label">
                places <span className="rex-places-count">{props.items.length}</span>
              </span>
              <span className="rex-spacer" />
              <button type="button" className="rex-link" onClick={clear}>
                clear
              </button>
            </div>

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
                    // §3.2 — the order is the order the agent is given them in,
                    // and `targets[0]` is what Apply's prompt leads with.
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
                        <Trash size={12} />
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
                                  {scopeWord(option)}
                                </button>
                              ))}
                              {scope?.regionCapable ? (
                                <button
                                  type="button"
                                  className={
                                    isCutOut(item.anchor.region)
                                      ? "rex-scope rex-scope-on"
                                      : "rex-scope"
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
                            {/*
                              Spec 26 §4.1's worded meter is GONE from this row —
                              "Durable — hand-written id, survives a rebuild" and
                              its two siblings. Reported 2026-09-02.

                              It answered a question the reviewer was not asking.
                              They are picking what a comment is about, and the
                              chips above already say what each level IS; a green
                              strip predicting how well the anchor would survive a
                              rebuild is REX talking about its own machinery in
                              the middle of that. The bars survive in the path bar
                              (`PathBar.tsx`), where they are drawn bare and the
                              sentence is a tooltip — so nothing is lost, it just
                              stops interrupting.
                            */}
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
          </div>
        ) : null}

        <textarea
          className="rex-input"
          ref={noteRef}
          style={noteHeight === null ? undefined : { height: noteHeight }}
          placeholder={props.mode === "act" ? "What should change here?" : "What about these?"}
          value={props.note}
          onChange={(event) => props.onNote(event.target.value)}
          onKeyDown={(event) => {
            // §3.1 — ⇧⇥ toggles the mode from inside the box, without sending.
            // Checked first, and it must preventDefault: the browser's own
            // meaning for ⇧⇥ is "walk focus backwards out of this field".
            if (isModeChord(event)) {
              event.preventDefault();
              props.onMode(other(props.mode));
              return;
            }
            onSendChord(canAsk, props.onAsk)(event);
          }}
        />
        <div className="rex-row">
          {/*
            Spec 12 §3 — the switch replaces the `read-only` badge that used to
            sit here. The badge stated a fact the reviewer could not change,
            which is exactly what this control now lets them change; leaving
            both would say the mode is fixed and offer to move it in one row.
          */}
          <ModeSwitch mode={props.mode} actDisabled={null} onPick={props.onMode} />
          {/*
            Spec 25 §7.1 — the model, beside the button it sends with. The two
            are one group at the right edge, so when the row wraps they move
            together instead of the button dropping to the left on its own.
          */}
          <span className="rex-row-end">
            <ModelPick
              models={props.gateways.rows}
              value={props.gateway}
              fallback={props.gateway}
              allowDefault={false}
              disabled={
                props.mode === "note" ? "A note runs nothing, so it uses no gateway." : null
              }
              error={null}
              rowDisabled={props.gateways.blocked}
              action={{
                label: "Manage gateways…",
                title: "Add, edit or remove a gateway. Old answers keep their own record.",
                onPick: props.onManageGateways,
              }}
              onPick={(value) => {
                if (value !== null) props.onGateway(value);
              }}
            />
            <ModelPick
              models={props.models.models}
              value={props.model}
              fallback={props.models.chosen}
              allowDefault
              disabled={props.mode === "note" ? "A note runs nothing, so it uses no model." : null}
              error={props.models.error}
              onPick={props.onModel}
            />
            {/*
              Spec 31 §7.1 — the output style, beside the model. §7.3 — no
              `Default — …` row: a style has no app-wide default to follow, so
              `default` is an ordinary choice like the others.
            */}
            <ModelPick
              models={styleRows(props.models.styles)}
              value={props.style}
              fallback={DEFAULT_STYLE}
              allowDefault={false}
              disabled={props.mode === "note" ? "A note runs nothing, so it has no style." : null}
              error={props.models.error}
              onPick={(value) => {
                if (value !== null) props.onStyle(value);
              }}
            />
            {/*
              NOTE gets the quiet treatment: not `rex-primary`, because it is not
              the send. A filled accent button that reaches nobody would be the
              loudest control on the panel doing the least.
            */}
            <button
              type="button"
              className={[
                "rex-button",
                props.mode === "note" ? "rex-button-note" : "rex-primary",
                props.mode === "act" ? "rex-button-write" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={
                props.items.length === 0
                  ? "Pick a place on the paper first"
                  : props.mode === "act"
                    ? `Change ${places(props.items.length)} — you will see a diff before anything is kept — ${SEND_CHORD_HINT}`
                    : props.mode === "note"
                      ? `Save this comment about ${places(props.items.length)} — no agent runs, and nothing is spent — ${SEND_CHORD_HINT}`
                      : `Ask about ${places(props.items.length)} — ${SEND_CHORD_HINT}`
              }
              // The note is the question, the instruction, or the note itself.
              // Without it, or without a place, there is nothing to ask, do or
              // save (§4.3, spec 37 §2.1).
              disabled={!canAsk}
              onClick={props.onAsk}
            >
              {MODE_VERB[props.mode]} {props.items.length}
              <SendChord />
            </button>
          </span>
        </div>
      </div>
    </section>
  );
}
