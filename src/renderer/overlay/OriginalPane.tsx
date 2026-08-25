// Spec 15 §6.1 — the left-hand pane: the document as it is on disk.
//
// Read-only in the strongest sense the design allows. It hands up no surface, so
// no anchor is ever created or resolved against it (invariant I1 is about the
// document being reviewed, and this is not that document — it is what the
// reviewer is comparing against). No selection, no pick, no pen, no comment
// gesture: comments belong to the version that will exist.
//
// What it does draw is §6.2's other half — the blocks the original has and the
// new version does not, tinted red at the height their replacements sit at.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LineRange, OpenedDocument } from "../../shared/types.ts";
import type { ScopeRect } from "../anchor/pick.ts";
import { boxesForLinesIn } from "./anchoring.ts";
import { enrichDocument } from "./enrich.ts";
import { applyZoom, srcdocFor } from "./frame.ts";
import { addPaperFonts } from "./paperFonts.ts";

interface Props {
  doc: OpenedDocument;
  /** §6.2 — line ranges only the original has. */
  removed: LineRange[];
  zoom: number;
  /**
   * Handed the frame once it is drawn, so the right-hand pane can keep this one
   * level with it (§6.2). Called again with null when the document goes.
   */
  onFrameReady: (frame: HTMLIFrameElement | null) => void;
}

export function OriginalPane(props: Props): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [boxes, setBoxes] = useState<ScopeRect[]>([]);

  const { doc, zoom, removed, onFrameReady } = props;

  // The ranges as a string, so the effect below re-runs when they change and
  // not when a new array of the same numbers arrives from a re-render.
  const ranges = JSON.stringify(removed);

  const measure = useCallback((frame: HTMLIFrameElement, lines: LineRange[]): void => {
    const view = frame.contentWindow;
    const inner = frame.contentDocument;
    if (!view || !inner || lines.length === 0) {
      setBoxes([]);
      return;
    }
    setBoxes(boxesForLinesIn(view, inner, lines));
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let live = true;
    const onLoad = async (): Promise<void> => {
      const view = frame.contentWindow;
      const inner = frame.contentDocument;
      if (!live || !view || !inner) return;

      const follow = (): void => setScroll({ x: view.scrollX, y: view.scrollY });
      follow();
      view.addEventListener("scroll", follow, { passive: true });

      await addPaperFonts(view).catch(() => undefined);
      if (!live) return;
      applyZoom(inner, zoom);
      await enrichDocument(inner, doc);
      if (!live) return;

      measure(frame, JSON.parse(ranges) as LineRange[]);
      onFrameReady(frame);
    };

    const onLoadEvent = (): void => void onLoad();
    frame.addEventListener("load", onLoadEvent);
    frame.srcdoc = srcdocFor(doc);
    return () => {
      live = false;
      frame.removeEventListener("load", onLoadEvent);
      onFrameReady(null);
    };
    // `zoom` is deliberately absent: re-running rewrites `srcdoc`, which reloads
    // the document and throws away where the reviewer had scrolled to. The
    // effect below applies every zoom after the first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, ranges, measure, onFrameReady]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    applyZoom(frame.contentDocument, zoom);
    measure(frame, JSON.parse(ranges) as LineRange[]);
  }, [zoom, ranges, measure]);

  return (
    <section className="rex-half rex-half-original">
      <header className="rex-half-head">
        <span className="rex-half-title">Original</span>
        <span className="rex-half-hint">on disk · read-only</span>
      </header>
      <div className="rex-half-body">
        <iframe
          ref={frameRef}
          className="rex-frame"
          title="The document as it is on disk"
          sandbox="allow-same-origin"
        />
        {boxes.map((box) => (
          <div
            key={`removed-${box.x}-${box.y}-${box.w}-${box.h}`}
            className="rex-removed-outline"
            style={{
              left: box.x - scroll.x,
              top: box.y - scroll.y,
              width: box.w,
              height: box.h,
            }}
          />
        ))}
      </div>
    </section>
  );
}
