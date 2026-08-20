// The document under review, plus the margin REX draws beside it.
//
// Tier 1 (§5.2) renders into an iframe that is `sandbox="allow-same-origin"`
// and nothing else: same-origin so the resolver can reach the DOM for
// anchoring (§6.3 rule 3), and without `allow-scripts` so a local file's
// scripts cannot run (§5.4 step 2). Tier 2 renders into a <webview>, where the
// resolver runs behind a preload instead.

import { useEffect, useRef, useState } from "react";
import type { OpenedDocument, ThreadWithMessages } from "../../shared/types.ts";
import {
  type DocumentSurface,
  type DraftAnchor,
  FrameSurface,
  type ResolvedThread,
  type WebviewElement,
  WebviewSurface,
} from "./anchoring.ts";
import { Gutter } from "./Gutter.tsx";
import { prepareDocumentHtml } from "./sanitise.ts";

interface Props {
  doc: OpenedDocument | null;
  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  draft: DraftAnchor | null;
  onSurfaceReady: (surface: DocumentSurface) => void;
  onSelectionChanged: () => void;
  onSelectMarker: (threadId: string) => void;
  onCreateComment: (note: string) => void;
  onCancelDraft: () => void;
}

function baseHref(directory: string): string {
  const encoded = directory
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `rex-doc://doc${encoded}/`;
}

export function DocumentView(props: Props): React.JSX.Element {
  const [scrollY, setScrollY] = useState(0);
  const [note, setNote] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const webviewRef = useRef<WebviewElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const { doc, onSurfaceReady, onSelectionChanged } = props;
  const isWebview = doc !== null && doc.html === null;

  // ── Tier 1: load the sanitised HTML, then hand up a surface ──

  useEffect(() => {
    const frame = frameRef.current;
    if (!doc || doc.html === null || !frame) return;

    let live = true;
    const onLoad = (): void => {
      if (!live) return;
      const view = frame.contentWindow;
      const inner = frame.contentDocument;
      if (!view || !inner) return;

      setScrollY(view.scrollY);
      view.addEventListener("scroll", () => setScrollY(view.scrollY), { passive: true });
      inner.addEventListener("mouseup", onSelectionChanged);
      onSurfaceReady(new FrameSurface(frame, doc.ref.kind === "file" ? doc.ref.value : null));
    };

    frame.addEventListener("load", onLoad);
    frame.srcdoc = prepareDocumentHtml(doc.html, doc.baseDir ? baseHref(doc.baseDir) : null);
    return () => {
      live = false;
      frame.removeEventListener("load", onLoad);
    };
  }, [doc, onSurfaceReady, onSelectionChanged]);

  // ── Tier 2: the <webview> resolves inside its own process ───

  useEffect(() => {
    const webview = webviewRef.current;
    if (!doc || doc.html !== null || !webview) return;

    const onReady = (): void => {
      onSurfaceReady(new WebviewSurface(webview));
      // A remote page scrolls in its own process; markers follow its scroll
      // rather than the overlay's, and a poll is the cheapest honest way to
      // track it without another IPC surface.
      setScrollY(0);
    };

    webview.addEventListener("dom-ready", onReady);
    webview.setAttribute("src", doc.ref.value);
    return () => webview.removeEventListener("dom-ready", onReady);
  }, [doc, onSurfaceReady]);

  useEffect(() => {
    if (!isWebview) return;
    const timer = window.setInterval(() => onSelectionChanged(), 700);
    return () => window.clearInterval(timer);
  }, [isWebview, onSelectionChanged]);

  useEffect(() => {
    if (props.draft) {
      setNote("");
      noteRef.current?.focus();
    }
  }, [props.draft]);

  return (
    <main className="rex-doc">
      {doc === null ? (
        <div className="rex-empty">
          <h1>REX</h1>
          <p>Open a Markdown or HTML document, or type a URL, to start commenting.</p>
        </div>
      ) : null}

      {isWebview ? (
        <webview
          ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
          className="rex-frame"
          preload={doc?.webviewPreload ?? undefined}
        />
      ) : (
        <iframe
          ref={frameRef}
          className="rex-frame"
          title="Document under review"
          sandbox="allow-same-origin"
        />
      )}

      <Gutter
        resolved={props.resolved}
        threads={props.threads}
        activeId={props.activeId}
        scrollY={scrollY}
        onSelect={props.onSelectMarker}
      />

      {props.draft ? (
        <div className="rex-composer" style={{ top: Math.max(8, props.draft.top - scrollY) }}>
          <div className="rex-quote">{props.draft.anchor.quote?.exact ?? "(element)"}</div>
          <textarea
            ref={noteRef}
            className="rex-input"
            placeholder="What about this passage?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="rex-row">
            <button
              type="button"
              className="rex-button rex-primary"
              disabled={note.trim().length === 0}
              onClick={() => props.onCreateComment(note.trim())}
            >
              Ask
            </button>
            <button type="button" className="rex-button" onClick={props.onCancelDraft}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
