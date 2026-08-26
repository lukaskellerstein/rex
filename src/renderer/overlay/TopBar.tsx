// design/screens/Main — the 44px bar.
//
// The two separate controls the old bar carried — Open file… and Open folder…
// — collapse into one `Open ▾`. A control you use once per session should not
// hold width forever.

import { useEffect, useRef, useState } from "react";
// The mark alone — what docs/logo/README.md nominates for "anywhere too small
// for text", which a 44px bar is. Taken at 128px for a 24px slot, so it is over
// 5× on a retina panel and never upscaled. Imported from the kit rather than
// copied into src/, so there is one source of truth for the brand.
import logo from "../../../docs/logo/mark/rex-mark-color-128.png";
import type { OpenedDocument, WorkspaceRef } from "../../shared/types.ts";
import { Bug, ChevronDown } from "./Icons.tsx";

interface Props {
  doc: OpenedDocument | null;
  workspace: WorkspaceRef | null;
  centre: "document" | "graph";
  cost: number;
  unanswered: number;
  /** The document's own zoom. 1 is 100%, and then nothing is shown. */
  zoom: number;
  onResetZoom: () => void;
  onCentre: (centre: "document" | "graph") => void;
  onAskAll: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  /** Spec 13 §4.1 — the app's state on the clipboard, for a bug report. */
  onDebug: () => void;
}

/**
 * The document's place in the workspace, as the design draws it: dimmed
 * directories, a bright file name. Relative to the workspace root when there is
 * one, because that is the tree the reviewer is looking at.
 */
function crumbs(doc: OpenedDocument, root: string | null): string[] {
  const path = doc.ref.value;
  const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const parts = relative.split("/").filter(Boolean);
  // An absolute path with no workspace would fill the bar; its tail locates it.
  return parts.length > 3 ? parts.slice(-3) : parts;
}

export function TopBar(props: Props): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A menu that outlives the click that dismissed it is a menu in the way.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent): void => {
      // `composedPath()`, not `event.target`. REX draws inside a shadow root
      // (§7), and an event that crosses that boundary is retargeted: by the
      // time it reaches `document`, `target` is the shadow *host*, never the
      // button that was pressed. Testing containment against that closed the
      // menu on mousedown, which unmounted the item before its click could
      // land — so every entry in this menu did nothing at all.
      const path = event.composedPath();
      const menu = menuRef.current;
      if (!menu || !path.includes(menu)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    // A click inside the document iframe never reaches this document, so
    // `mousedown` above cannot see it and the menu used to hang over the
    // document until it was dismissed some other way. Clicking into the frame
    // does move focus to it, which blurs this window — that is the one signal
    // that crosses the boundary. It also fires when the reviewer switches app,
    // where closing the menu is equally right.
    const onBlur = (): void => setMenuOpen(false);

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [menuOpen]);

  const parts = props.doc ? crumbs(props.doc, props.workspace?.root ?? null) : [];
  const file = parts.at(-1) ?? null;

  return (
    <header className="rex-bar">
      <img className="rex-mark" src={logo} alt="REX" />

      {/*
        Beside the mark, at the start of the bar. Opening something is the first
        thing anyone does and the only control here that acts on the *app*
        rather than on the document — everything to the right of the spacer is
        about the document that is already open.
      */}
      <div className="rex-open" ref={menuRef}>
        <button
          type="button"
          className="rex-button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Open
          <ChevronDown />
        </button>

        {menuOpen ? (
          <div className="rex-open-menu">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                props.onOpenFile();
              }}
            >
              Document…
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                props.onOpenFolder();
              }}
            >
              Folder as a workspace…
            </button>
          </div>
        ) : null}
      </div>

      {props.doc ? (
        <span className="rex-path" title={props.doc.ref.value}>
          {parts.slice(0, -1).map((part, position) => (
            // Directory names repeat inside one path, so the position is the id.
            <span key={`${part}-${position}`} className="rex-path-dir">
              {part}
              <span className="rex-path-sep"> / </span>
            </span>
          ))}
          <span className="rex-path-file">{file}</span>
        </span>
      ) : (
        <span className="rex-path rex-path-dir">no document open</span>
      )}

      {props.doc?.contentChanged ? (
        <span
          className="rex-pill rex-pill-moved"
          title="The file changed since these comments were anchored"
        >
          FILE CHANGED
        </span>
      ) : null}

      {/*
        Spec 01 §5.2 — a format REX can read but cannot write, said once and in
        the open.

        The sentence existed already (`main/render/formats.ts`), but the only
        place it appeared was the tooltip of a greyed-out ACT segment — which
        means it was legible only to a reviewer who had already written the
        comment, opened the card and hovered the thing that would not work.
        Beside the file name it is a fact about the document, which is what it
        is, and it is read before any of that.

        Quiet, not an alarm: a PDF that cannot be written to is the format being
        a PDF, not a fault. Amber is `FILE CHANGED`, which is a thing that
        happened.
      */}
      {props.doc && !props.doc.applyEnabled ? (
        <span
          className="rex-pill rex-pill-quiet"
          title={props.doc.applyDisabledReason ?? "Apply cannot edit this format."}
        >
          READ ONLY
        </span>
      ) : null}

      <span className="rex-spacer" />

      {/*
        Only when it is not 100%. A zoom you set and forgot explains a lot of
        confusion later — a document that "looks wrong" — and a control that is
        only there when it means something costs no width the rest of the time.
      */}
      {Math.abs(props.zoom - 1) > 0.001 ? (
        <button
          type="button"
          className="rex-button rex-zoom"
          title="The document's zoom — click to go back to 100% (⌘0)"
          onClick={props.onResetZoom}
        >
          {Math.round(props.zoom * 100)}%
        </button>
      ) : null}

      {/*
        Spec 08 §4.3 — `Pick element` and `Pen` used to sit here. They were the
        only MODES in a row that otherwise holds facts about the document and
        actions on it, and a mode belongs where it acts: both are chips at the
        foot of the paper now (`ModeStrip.tsx`). The keys are unchanged.
      */}

      {props.workspace ? (
        <div className="rex-segment">
          <button
            type="button"
            title="Show the document — D"
            className={props.centre === "document" ? "rex-on" : ""}
            onClick={() => props.onCentre("document")}
          >
            Document
          </button>
          <button
            type="button"
            title="Show the reference graph — G"
            className={props.centre === "graph" ? "rex-on" : ""}
            onClick={() => props.onCentre("graph")}
          >
            Graph
          </button>
        </div>
      ) : null}

      <span className="rex-cost" title="Running total for this document">
        ${props.cost.toFixed(4)}
      </span>

      <button
        type="button"
        className="rex-button rex-primary"
        disabled={props.unanswered === 0}
        title={
          props.unanswered === 0
            ? "Every comment on this document has been asked"
            : "Ask every unanswered comment, each in its own session — ⇧A"
        }
        onClick={props.onAskAll}
      >
        Ask all · {props.unanswered}
      </button>

      {/*
        Spec 13 §4.1 — icon only, and always there. It is about the APP, not
        about the document, so it must still work when nothing opened; that
        failure is the one it was written for.

        Last in the bar, past the primary action. Everything to its left acts on
        the document under review; this one acts on REX itself, and the end of
        the row is where a control that belongs to nothing else can sit without
        being read as part of the group before it.
      */}
      <button
        type="button"
        className="rex-icon-button rex-debug"
        title="Copy a debug report — what REX is doing, its debugger port and its recent errors. Paste it to Claude Code — B"
        aria-label="Copy a debug report"
        onClick={props.onDebug}
      >
        <Bug />
      </button>
    </header>
  );
}
