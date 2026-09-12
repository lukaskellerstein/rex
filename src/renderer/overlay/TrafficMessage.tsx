// Spec 51 §5.4 — depth 4. One message, readable or as JSON.
//
// **The Readable / JSON switch lives here and nowhere else.** At depth 3 a
// 78-message tree is a wall on any screen REX can draw; at depth 4 one message
// is twenty lines. That is the whole reason the depths exist — the fix for a
// wall of JSON was a smaller subject, not a smaller font.
//
// ── The two views are one view now ──────────────────────────────
//
// Amended 2026-09-11, and it is the second thing the reviewer reported about
// this screen. Readable and JSON answered two halves of one question and made
// the reader hold a place in their head while switching between them:
//
//   · JSON has the keys and the shape, and shows a 1 200-character value as one
//     escaped run with `\n` written out. Unreadable, and that is not a font
//     problem.
//   · Readable has the prose and throws the keys away, and drew it in a column
//     with the whole right half of the page empty beside it.
//
// So the body SPLITS: the tree on the left, and one picked value on the right.
// Clicking a row picks it. Nothing picked shows the whole message, which is what
// the Readable tab was. The empty half is now the half doing the reading.
//
// **`Plain` and `Markdown`, and plain is the default.** These strings are
// usually Markdown, and rendering it is genuinely easier to read — but the
// question this screen answers is *what did REX send*, and a renderer hides the
// exact characters. So the record is what opens, and the rendering is one click
// away. `prose.tsx` does it, with `html: false` and DOMPurify over an
// allow-list, because this is untrusted model output inside REX's own chrome
// (invariant I2) and a second renderer here would be a second thing to get
// wrong.
//
// **The inline expansion stays.** A long value still opens in place, still
// quoted, still JSON — reported 2026-09-09, and the pane does not repeal it.
// In `JSON` on its own, that is the only way to read a value; picking a row
// there switches to the split rather than doing nothing, because a control that
// answers nothing is worse than one that answers somewhere else.
//
// **The copy belongs on the thing being copied**, in two places and no others.
// A ROW of the tree copies its own subtree as `JSON`, and on a string its
// `Text` as well; a CARD of the pane copies what that card shows. The first
// build put five on the screen and the reviewer rejected it the same day: the
// pane's head carried two labelled buttons while the cards under it carried
// none, and a fifth sat beside the message's size — "extremely too much", and
// it was, because the whole message is already the tree's ROOT row.
//
// So a picked value is drawn in a CARD too. That is what gives the pane one
// rule instead of two, and it is why `kindOf` exists: a block's card says its
// type in that corner, so a value's says what it is.
//
// `JSON` is the structure, escaped and indented — what goes into a file or a
// bug report, and what proves what was on the wire. `Text` is the string with
// its real line breaks — what goes into an editor to be read or searched.
// Neither is offered where it means nothing, because a button that copies an
// empty string is a button that lies.
//
// Making the row a button took the mouse's own text selection away from the
// tree, which is what the row's copies give back.
//
// **A PAGE, like the three depths above it** — amended 2026-09-11, and the one
// thing on this screen the artboard no longer decides. `Message.dc.html` draws a
// narrow sheet and the first build followed it: `min(760px, 94vw)` over the turn
// it came from. The reviewer reported the cost on a large display — a request
// body is tens of kilobytes of JSON, and a 760px column reads it four words at a
// time while most of the screen sits empty. A dialog is for one decision and
// then dismissal (spec 46 §8); reading a message is neither.
//
// Two things follow from being a page rather than a sheet over one. The turn
// behind it is UNMOUNTED, so `Escape` has one listener instead of two racing
// ones — it went back to depth 3 only because the turn registered first. And
// `onBack` is now a separate handler from `onClose`: back walks to the turn,
// close leaves the feature, which is what every other page's × does.
//
// The pager walks the exchange: the request's system prompt, then every message
// it carried, then the response, which is the one thing the wire has that the
// request does not. The first two come from `wireEntries`, which is also what
// depth 3 draws — one list, because the index the turn hands over is a place in
// it and two lists built apart would land the reader on the wrong message.
//
// `jsonTree.ts` decides what a line says and what a folded node keeps; this file
// only draws it. Same split spec 38 §3 made for the trace's rows, for the same
// reason — the decision is checkable by `node --test` and the drawing is not.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TraceMessageResult } from "../../shared/channels.ts";
import { CopyText } from "./CopyText.tsx";
import { ChevronLeft, Cross } from "./Icons.tsx";
import {
  BLOB_PREFIX,
  foldablePaths,
  type JsonLine,
  jsonLines,
  pathLabel,
  valueAt,
  valueText,
  visibleLines,
} from "./jsonTree.ts";
import { Prose } from "./prose.tsx";
import { Splitter } from "./Splitter.tsx";
import { wireEntries } from "./wire.ts";

/** Which panes are on screen. `split` is both, and is what opens. */
type Layout = "split" | "json" | "readable";

/** How the value pane draws text: as the record, or as the Markdown it is. */
type Face = "plain" | "markdown";

/** How much of the body the tree takes, before anybody drags the divider. */
const DEFAULT_SHARE = 0.55;

/** Neither pane may be squeezed away entirely. */
const MIN_PANE = 320;

interface Props {
  /** What the head says this message came out of — `Turn 4`. The crumb. */
  where: string;
  /** The bodies, or null while they are being read. */
  bodies: TraceMessageResult | null;
  /** Which message the caller opened. Clamped, because a body can be shorter. */
  start: number;
  /** Back to depth 3, the turn this message was sent in. Also `Escape`. */
  onBack: () => void;
  /** Out of Traffic altogether, which is what every page's × does. */
  onClose: () => void;
}

/** One entry in the pager: a request message, or the response. */
interface Item {
  label: string;
  role: string;
  value: unknown;
}

function itemsOf(bodies: TraceMessageResult | null): Item[] {
  if (!bodies) return [];
  // The same LIST depth 3 draws, and not merely the same reader — the index the
  // turn hands over is a place in it. `roleOf` alone returned `?` for every
  // Responses API item, because those carry a `type` and no role at all.
  const items: Item[] = wireEntries(bodies.request).map((entry) => ({
    label: entry.at === null ? "System prompt" : `Message ${entry.at + 1}`,
    role: entry.seen.tools[0] ?? entry.seen.role ?? "?",
    value: entry.value,
  }));
  // The response is the one thing on the wire the request cannot show, so it
  // rides the same pager rather than getting a screen of its own.
  if (bodies.response !== undefined) {
    items.push({ label: "Response", role: "response", value: bodies.response });
  }
  return items;
}

function weightOf(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (!text) return "—";
    return text.length > 1024 ? `${(text.length / 1024).toFixed(1)} KB` : `${text.length} B`;
  } catch {
    return "—";
  }
}

export function TrafficMessage(props: Props): React.JSX.Element {
  const items = useMemo(() => itemsOf(props.bodies), [props.bodies]);
  const [at, setAt] = useState(props.start);
  const [layout, setLayout] = useState<Layout>("split");
  const [face, setFace] = useState<Face>("plain");
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set());
  /**
   * Long strings the reader asked to see whole.
   *
   * The opposite default to `shut`, and that is the point: a node is worth
   * seeing expanded, and a message whose every string is 1 200 characters is
   * only readable if they start cut. Reported 2026-09-09 — the count of what
   * was hidden was there, and no way to read it was.
   */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  /** Which row the pane is showing. Null is the whole message. */
  const [picked, setPicked] = useState<string | null>(null);
  /**
   * The divider's place, as a FRACTION and not a pixel count.
   *
   * A fraction survives a window resize with the proportion the reader chose;
   * a stored pixel width turns into a different layout on a different screen,
   * which is the bug every two-pane view writes once.
   */
  const [share, setShare] = useState(DEFAULT_SHARE);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);

  // A body that came back shorter than the caller expected clamps rather than
  // drawing nothing: the row said which exchange, and that is still true.
  const index = items.length === 0 ? 0 : Math.min(at, items.length - 1);
  const item = items[index] ?? null;
  const lines = useMemo(() => (item ? jsonLines(item.value) : []), [item]);
  const drawn = useMemo(() => visibleLines(lines, shut), [lines, shut]);

  // The splitter works in pixels and the state is a fraction, so the body's own
  // width is the one measurement that converts between them. An observer rather
  // than a resize listener, because the shell's panes move without the window.
  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    setBodyWidth(node.clientWidth);
    const watch = new ResizeObserver((entries) => {
      const seen = entries[0]?.contentRect.width;
      if (typeof seen === "number") setBodyWidth(seen);
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  // `Escape` walks BACK one depth rather than leaving Traffic, which is what it
  // did when this screen was a sheet over the turn. The turn is what a reader
  // was looking at a moment ago, so it is where the key belongs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onBack]);

  /**
   * Moving to another message drops everything that is a path.
   *
   * Fold state and the selection both name rows of the message that made them,
   * and the next message's rows can spell the same names while meaning
   * something else. The LAYOUT and the face stay, because those are the
   * reader's preference and not the message's.
   */
  const move = (by: number): void => {
    setAt((was) => Math.max(0, Math.min(items.length - 1, was + by)));
    setShut(new Set());
    setOpened(new Set());
    setPicked(null);
  };

  /**
   * A row was clicked.
   *
   * In `json` on its own there is no pane to show it in, so the click opens
   * one. A control that answers nothing is worse than one that answers
   * somewhere else, and this is the gesture the reviewer reached for first.
   */
  const pick = (path: string): void => {
    setPicked(path);
    if (layout === "json") setLayout("split");
  };

  const showsJson = layout === "split" || layout === "json";
  const showsValue = layout === "split" || layout === "readable";
  const pickedValue = picked === null ? undefined : valueAt(item?.value, picked);
  const jsonWidth = Math.round(bodyWidth * share);

  return (
    <div className="rex-page rex-traffic" aria-label="One message">
      <header className="rex-page-head rex-tt-head">
        {/* The same crumb depths 2 and 3 carry, pointing one step back up the
            path. `back` never leaves the feature — spec 51 §5. */}
        <button type="button" className="rex-tt-back" onClick={props.onBack}>
          <ChevronLeft size={12} />
          {props.where}
        </button>
        <span className="rex-tt-slash">/</span>
        <h1>{item?.label ?? "Message"}</h1>
        {item ? <span className="rex-message-role">{item.role}</span> : null}
        <span className="rex-spacer" />
        <button
          type="button"
          className="rex-icon-button"
          data-tip="The message before this one"
          aria-label="The message before this one"
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="rex-icon-button"
          data-tip="The message after this one"
          aria-label="The message after this one"
          disabled={index >= items.length - 1}
          onClick={() => move(1)}
        >
          ›
        </button>
        <span className="rex-meta">
          {items.length === 0 ? "—" : `${index + 1} of ${items.length}`}
        </span>
        <button
          type="button"
          className="rex-icon-button"
          data-tip="Close"
          aria-label="Close traffic"
          onClick={props.onClose}
        >
          <Cross />
        </button>
      </header>

      <div className="rex-message-bar">
        {/* Three layouts, not two views. `Split` is the one that answers the
            question this screen exists for; the other two are for a reader who
            wants one thing on the whole page. */}
        <div className="rex-message-tabs">
          {(["split", "json", "readable"] as const).map((one) => (
            <button
              key={one}
              type="button"
              className={layout === one ? "rex-tab rex-tab-on" : "rex-tab"}
              onClick={() => setLayout(one)}
            >
              {LAYOUT_LABEL[one]}
            </button>
          ))}
        </div>
        {showsJson ? (
          <>
            <button
              type="button"
              className="rex-button"
              onClick={() => {
                setShut(new Set(foldablePaths(lines).filter((p) => p !== "root")));
                setOpened(new Set());
              }}
            >
              Collapse all
            </button>
            <button
              type="button"
              className="rex-button"
              onClick={() => {
                // Every node, and every long string with it — "expand all"
                // that left the text cut would not be expanding all.
                setShut(new Set());
                setOpened(new Set(lines.filter((one) => one.full !== null).map((one) => one.path)));
              }}
            >
              Expand all
            </button>
          </>
        ) : null}
        <span className="rex-spacer" />
        {/*
          The size, and nothing after it. A copy lived here and the reviewer
          called it "extremely too much" on 2026-09-11 — and it was, because the
          whole message is already the tree's ROOT row, which carries a `JSON`
          copy like every other row. A second control for a thing already
          reachable is one more thing to read past.
        */}
        <span className="rex-meta">{item ? weightOf(item.value) : "—"}</span>
      </div>

      <div className="rex-message-body" ref={bodyRef}>
        {props.bodies === null ? (
          <p className="rex-message-note rex-meta">Reading…</p>
        ) : props.bodies.problem ? (
          // §10 rule 4 — a body may be absent, and then it says why. It may
          // never be wrong, so nothing is drawn in its place.
          <p className="rex-message-note rex-settings-note">{props.bodies.problem}</p>
        ) : items.length === 0 ? (
          <p className="rex-message-note rex-settings-note">
            Nothing was recorded for this request. Settings → Gateways turns body capture back on,
            and the next run will have one.
          </p>
        ) : (
          <>
            {showsJson ? (
              <div
                className="rex-message-pane rex-message-tree"
                // In `split` the tree is the fraction the divider was left at.
                // On its own it is the whole body, and a width would be a
                // column with nothing beside it.
                style={
                  layout === "split" ? { flex: `0 0 ${(share * 100).toFixed(2)}%` } : undefined
                }
              >
                <JsonView
                  lines={drawn}
                  message={item?.value}
                  shut={shut}
                  opened={opened}
                  picked={picked}
                  onPick={pick}
                  onToggle={(path) => {
                    // One handler, two sets. A long string toggles `opened`, a
                    // node toggles `shut`, and the line itself says which it is.
                    const long = lines.find((one) => one.path === path)?.full != null;
                    const flip = (was: ReadonlySet<string>): ReadonlySet<string> => {
                      const next = new Set(was);
                      if (!next.delete(path)) next.add(path);
                      return next;
                    };
                    if (long) setOpened(flip);
                    else setShut(flip);
                  }}
                />
              </div>
            ) : null}

            {layout === "split" ? (
              <Splitter
                width={jsonWidth}
                min={MIN_PANE}
                max={Math.max(MIN_PANE, bodyWidth - MIN_PANE)}
                direction={1}
                label="the JSON"
                onChange={(width) => {
                  if (bodyWidth > 0) setShare(width / bodyWidth);
                }}
              />
            ) : null}

            {showsValue ? (
              <ValuePane
                message={item?.value}
                picked={picked}
                value={pickedValue}
                face={face}
                onFace={setFace}
                onClear={() => setPicked(null)}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const LAYOUT_LABEL: Record<Layout, string> = {
  split: "Split",
  json: "JSON",
  readable: "Readable",
};

/**
 * The pane beside the tree: one picked value, or the whole message.
 *
 * It is the old Readable tab plus a subject. With nothing picked it draws
 * exactly what that tab drew, so the screen a reader already knows is still
 * there and is now the pane's resting state rather than a place to switch to.
 */
function ValuePane({
  message,
  picked,
  value,
  face,
  onFace,
  onClear,
}: {
  /** The whole message, for when nothing is picked. */
  message: unknown;
  picked: string | null;
  /** What `picked` points at. `undefined` when the path names nothing. */
  value: unknown;
  face: Face;
  onFace: (face: Face) => void;
  onClear: () => void;
}): React.JSX.Element {
  const label = picked === null ? "" : pathLabel(picked);
  const text = picked === null ? "" : valueText(value);
  // Markdown is a claim about TEXT. An object rendered through a Markdown
  // parser is not more readable, it is differently wrong — so the switch is
  // offered where it means something and left out where it does not.
  const isText = picked === null || typeof value === "string";

  return (
    <div className="rex-message-pane rex-message-value">
      <div className="rex-value-head">
        <span className="rex-label">{picked === null ? "whole message" : "value"}</span>
        {picked === null ? (
          <span className="rex-value-hint">click a row on the left to read one value</span>
        ) : (
          <code className="rex-value-path">{label || "the message"}</code>
        )}
        <span className="rex-spacer" />
        {isText ? (
          <div className="rex-message-tabs rex-value-faces">
            {(["plain", "markdown"] as const).map((one) => (
              <button
                key={one}
                type="button"
                className={face === one ? "rex-tab rex-tab-on" : "rex-tab"}
                onClick={() => onFace(one)}
              >
                {one === "plain" ? "Plain" : "Markdown"}
              </button>
            ))}
          </div>
        ) : null}
        {picked !== null ? (
          <button
            type="button"
            className="rex-icon-button"
            data-tip="Back to the whole message"
            aria-label="Back to the whole message"
            onClick={onClear}
          >
            <Cross />
          </button>
        ) : null}
      </div>

      {/*
        ONE COPY PER CARD, in its corner, and none in this head.

        Reported 2026-09-11, against a head that carried two labelled copies
        while the cards under it carried none: the copy belongs on the thing
        being copied. So every card in this pane has one, whether the pane is
        showing a whole message as blocks or one picked value on its own.
      */}
      <div className="rex-value-body">
        {picked === null ? (
          <Readable value={message} face={face} />
        ) : value === undefined ? (
          <p className="rex-settings-note">That row is not in this message.</p>
        ) : (
          <section className="rex-readable-block rex-value-card">
            <div className="rex-readable-head">
              <span className="rex-label">{kindOf(value)}</span>
              <span className="rex-spacer" />
              <CopyText text={text} what="value" />
            </div>
            {typeof value === "string" ? (
              <Text text={text} face={face} />
            ) : (
              // Not text, so it is the record again — indented, and never
              // pretending to be prose.
              <pre className="rex-json-plain">{text}</pre>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * One string, as the record or as the Markdown it is written in.
 *
 * PLAIN IS THE DEFAULT, and the reason is what this screen is for: it answers
 * "what did REX send", and a renderer hides the exact characters — a stray
 * asterisk, a heading that was meant literally, trailing whitespace. The
 * rendering is one click away, because these strings really are Markdown and
 * reading a page of it raw is work.
 */
function Text({ text, face }: { text: string; face: Face }): React.JSX.Element {
  if (face === "markdown") return <Prose text={drawString(text)} />;
  return <pre className="rex-value-plain">{drawString(text)}</pre>;
}

/**
 * The tree, one row per line.
 *
 * Every part of a row is a span on one source line and the row never wraps. That
 * is not a style preference: `white-space: pre` on a block whose spans sat on
 * their own indented source lines turned every source newline into a real break,
 * and one JSON row drew as five.
 */
function JsonView({
  lines,
  message,
  shut,
  opened,
  picked,
  onPick,
  onToggle,
}: {
  lines: readonly JsonLine[];
  /**
   * The value the lines were built from, so a row can copy its own subtree.
   *
   * The line carries what it DRAWS, which is a preview; the structure under it
   * is only reachable through the value, and `valueAt` is what reaches it.
   */
  message: unknown;
  /** Nodes the reader FOLDED. A node is open until it is in here. */
  shut: ReadonlySet<string>;
  /**
   * Long strings the reader OPENED. The other way round, and deliberately: a
   * tree of nodes is worth seeing expanded, and a tree of 1 200-character
   * strings expanded by default is the wall this screen exists to avoid.
   */
  opened: ReadonlySet<string>;
  /** The row the pane is showing, so the tree says which one that is. */
  picked: string | null;
  onPick: (path: string) => void;
  onToggle: (path: string) => void;
}): React.JSX.Element {
  return (
    <div className="rex-json">
      {lines.map((line, number) => {
        // A long string folds too, and starts FOLDED: its line shows the cut
        // preview, and opening it lays the whole text out underneath.
        const long = line.full !== null;
        const isShut = long ? !opened.has(line.path) : shut.has(line.path);
        // Open, a long value is the WHOLE quoted string, in the same place,
        // wrapped over as many lines as it takes. **It is JSON and it stays
        // JSON** — reported 2026-09-09: the first version put the text in a
        // panel of its own below the line, which is a widget where a reader
        // asked for a value.
        const open = long && !isShut;
        // A closing brace is punctuation, not a value, so there is nothing for
        // the pane to show. Picking it would land on the node above it, which
        // is a control that quietly does something else.
        const pickable = !line.path.endsWith("/close");
        const on = pickable && picked === line.path;
        return (
          <div
            key={line.path}
            className={["rex-json-line", open ? "rex-json-wrap" : "", on ? "rex-json-line-on" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="rex-json-gutter">{number + 1}</span>
            {line.node || long ? (
              <button
                type="button"
                className="rex-json-fold"
                aria-expanded={!isShut}
                aria-label={isShut ? "Show all of this" : "Fold this"}
                onClick={() => onToggle(line.path)}
              >
                {isShut ? "\u25b8" : "\u25be"}
              </button>
            ) : (
              <span className="rex-json-fold" />
            )}
            {/*
              THE ROW IS THE CONTROL, and the arrow beside it is a different
              one. Three parts, three jobs: the arrow folds, the text picks, the
              copy copies. A real `<button>` and not a click handler on a span,
              so the keyboard reaches it like everything else on this screen.
            */}
            {pickable ? (
              <button
                type="button"
                className="rex-json-text rex-json-pick"
                style={{ paddingLeft: `${line.depth * 12}px` }}
                aria-pressed={on}
                onClick={() => onPick(line.path)}
              >
                <Row line={line} open={open} isShut={isShut} />
              </button>
            ) : (
              <span className="rex-json-text" style={{ paddingLeft: `${line.depth * 12}px` }}>
                <Row line={line} open={open} isShut={isShut} />
              </span>
            )}
            {/*
              BOTH FORMS, on the row itself. `JSON` is this row's own subtree,
              escaped and indented — an object, an array or one quoted value —
              and it is the only way to lift a branch out of the tree. `Text` is
              the raw string, and it is the button that was already here: a long
              value is copied whole, without being opened first.

              They appear on hover, like every other copy in REX, and only a
              long string has two.
            */}
            {pickable ? (
              <CopyText text={stringify(valueAt(message, line.path))} what="JSON" label="JSON" />
            ) : null}
            {long ? <CopyText text={line.full ?? ""} what="text" label="Text" /> : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What one row says.
 *
 * Its own function only so the pickable and the fixed spellings of a row cannot
 * drift apart — they are one row drawn in two wrappers, and a change made to
 * one of two copies is the bug this avoids.
 */
function Row({
  line,
  open,
  isShut,
}: {
  line: JsonLine;
  open: boolean;
  isShut: boolean;
}): React.JSX.Element {
  return (
    <>
      {line.key ? <span className="rex-json-key">{line.key}</span> : null}
      {line.key ? <span className="rex-json-sep">: </span> : null}
      <span className={`rex-json-val rex-json-${line.kind}`}>
        {open ? line.whole : line.node && isShut ? line.shut : line.value}
      </span>
      {/* The summary stays whether the node is open or shut — a fold that hides
          a thing without saying how much is a fold nobody dares open or leave
          (criterion A9). It goes once the value is all there, because then it
          is counting nothing. */}
      {line.tail && !open ? <span className="rex-json-tail">{`  ${line.tail}`}</span> : null}
    </>
  );
}

/** One content block, drawn as what it is rather than as a field list. */
function Readable({ value, face }: { value: unknown; face: Face }): React.JSX.Element {
  const blocks = blocksOf(value);
  if (blocks.length === 0) {
    return <pre className="rex-json-plain">{stringify(value)}</pre>;
  }
  return (
    <div className="rex-readable">
      {blocks.map((block, position) => (
        // The blocks of one message are fixed and never reordered, so the
        // position is the identity.
        <Block key={position} block={block} face={face} />
      ))}
    </div>
  );
}

interface ContentBlock {
  type: string;
  name: string | null;
  text: string;
  fields: Array<[string, string]>;
}

function blocksOf(value: unknown): ContentBlock[] {
  if (value === null || typeof value !== "object") return [];
  const content = (value as { content?: unknown }).content;
  if (typeof content === "string") {
    return [{ type: "text", name: null, text: content, fields: [] }];
  }
  if (!Array.isArray(content)) return [];
  return content.map((raw) => {
    if (raw === null || typeof raw !== "object") {
      return { type: "text", name: null, text: String(raw), fields: [] };
    }
    const block = raw as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "block";
    const input = block.input;
    return {
      type,
      name: typeof block.name === "string" ? block.name : null,
      text: [block.text, block.thinking, block.content]
        .map((candidate) => (typeof candidate === "string" ? candidate : null))
        .find((candidate) => candidate !== null) as string,
      fields:
        input !== null && typeof input === "object"
          ? Object.entries(input as Record<string, unknown>).map(([key, item]) => [
              key,
              typeof item === "string" ? drawString(item) : JSON.stringify(item),
            ])
          : [],
    };
  });
}

/**
 * What a picked value is, in one word, for its card's head.
 *
 * The readable cards say `text`, `thinking`, `tool_use` there — the block's own
 * type. A picked value has no type of its own, so it says what it is instead,
 * and the head reads the same way in both states.
 */
function kindOf(value: unknown): string {
  if (typeof value === "string") return "text";
  if (Array.isArray(value)) return "list";
  if (value === null) return "null";
  return typeof value === "object" ? "object" : typeof value;
}

/** What one card puts on the clipboard: exactly what the card is showing. */
function blockText(block: ContentBlock): string {
  return [block.text, ...block.fields.map(([key, item]) => `${key}: ${item}`)]
    .filter(Boolean)
    .join("\n\n");
}

/** An image reference is drawn as an image, never as forty characters of hash. */
function drawString(value: string): string {
  return value.startsWith(BLOB_PREFIX) ? "an image, stored beside the log" : value;
}

function Block({ block, face }: { block: ContentBlock; face: Face }): React.JSX.Element {
  const text = blockText(block);
  return (
    <section className={`rex-readable-block rex-readable-${block.type}`}>
      <div className="rex-readable-head">
        <span className="rex-label">{block.type}</span>
        {block.name ? <span className="rex-readable-name">{block.name}</span> : null}
        <span className="rex-spacer" />
        {/* One block at a time, which is how a message is actually quoted.
            A card with nothing in it gets none — a button that copies an
            empty string is a button that lies. */}
        {text ? <CopyText text={text} what="block" /> : null}
      </div>
      {/* The same switch the pane's head offers for one value, applied to the
          blocks of a whole message, so it means one thing wherever it is. */}
      {block.text ? (
        face === "markdown" ? (
          <Prose text={drawString(block.text)} />
        ) : (
          <p className="rex-readable-text">{drawString(block.text)}</p>
        )
      ) : null}
      {block.fields.length > 0 ? (
        <dl className="rex-trace-fields">
          {block.fields.map(([key, item]) => (
            <div key={key} className="rex-trace-field">
              <dt>{key}</dt>
              <dd>{item}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function stringify(value: unknown): string {
  if (value === undefined) return "(not recorded)";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
