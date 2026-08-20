// The document under review, plus the margin REX draws beside it.
//
// Tier 1 (§5.2) renders into an iframe that is `sandbox="allow-same-origin"`
// and nothing else: same-origin so the resolver can reach the DOM for
// anchoring (§6.3 rule 3), and without `allow-scripts` so a local file's
// scripts cannot run (§5.4 step 2). Tier 2 renders into a <webview>, where the
// resolver runs behind a preload instead.
//
// The pane is a row — frame, then a 32px gutter — rather than a gutter floating
// over the frame, so nothing the author wrote ever sits under REX's markers.

import { useEffect, useRef, useState } from "react";
import type { OpenedDocument, ThreadWithMessages } from "../../shared/types.ts";
import type { PickScope, ScopeRect } from "../anchor/pick.ts";
import {
  type DocumentSurface,
  type DraftAnchor,
  FrameSurface,
  type ResolvedThread,
  type WebviewElement,
  WebviewSurface,
} from "./anchoring.ts";
import { Composer } from "./Composer.tsx";
import { Gutter } from "./Gutter.tsx";
import { PickLayer } from "./PickLayer.tsx";
import { prepareDocumentHtml } from "./sanitise.ts";

interface Props {
  doc: OpenedDocument | null;
  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  draft: DraftAnchor | null;
  /**
   * Changes only when a *new* draft begins, never when its scope widens — so
   * the composer keeps what has been typed while the reviewer moves from the
   * cell to the row to the table.
   */
  draftKey: number;
  picking: boolean;
  pickScopes: PickScope[] | null;
  pickActive: number;
  arming: boolean;
  onSurfaceReady: (surface: DocumentSurface) => void;
  onSelectionChanged: () => void;
  onSelectMarker: (threadId: string) => void;
  onCreateComment: (note: string) => void;
  onCancelDraft: () => void;
  onScope: (index: number) => void;
  onArmRegion: () => void;
  onProbe: (x: number, y: number) => void;
  onPickActive: (index: number) => void;
  onPickCommit: (index: number) => void;
  onPickCancel: () => void;
  onRegion: (index: number, box: ScopeRect) => void;
}

function baseHref(directory: string): string {
  const encoded = directory
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `rex-doc://doc${encoded}/`;
}

/** `widget-service.md:14` — where the composer says the comment will land. */
function whereOf(draft: DraftAnchor): string | null {
  const source = draft.anchor.source;
  if (!source) return null;
  return `${source.file.split("/").pop()}:${source.line}`;
}

export function DocumentView(props: Props): React.JSX.Element {
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const webviewRef = useRef<WebviewElement>(null);

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

      const follow = (): void => setScroll({ x: view.scrollX, y: view.scrollY });
      follow();
      view.addEventListener("scroll", follow, { passive: true });
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
      setScroll({ x: 0, y: 0 });
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

  const blocks = props.resolved.filter((entry) => entry.box !== null);

  return (
    <main className="rex-doc">
      {doc === null ? (
        <div className="rex-empty">
          <h1>REX</h1>
          <p>Open a Markdown or HTML document, or a folder, to start commenting.</p>
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

      {/*
        An anchor on a whole element or a region of one is an outline, not a
        fill: the Custom Highlight API paints ranges, so there is no range to
        paint here — and drawing it as an overlay box keeps the promise that
        REX never touches the document's own tree.
      */}
      {blocks.map((entry) => (
        <div
          key={entry.threadId}
          className={`rex-block-outline${entry.state === "moved" ? " rex-block-moved" : ""}${
            props.activeId === entry.threadId ? " rex-block-active" : ""
          }`}
          style={{
            left: (entry.box?.x ?? 0) - scroll.x,
            top: (entry.box?.y ?? 0) - scroll.y,
            width: entry.box?.w ?? 0,
            height: entry.box?.h ?? 0,
          }}
        />
      ))}

      <Gutter
        resolved={props.resolved}
        threads={props.threads}
        activeId={props.activeId}
        scrollY={scroll.y}
        onSelect={props.onSelectMarker}
      />

      {props.picking ? (
        <PickLayer
          scopes={props.pickScopes}
          active={props.pickActive}
          scrollX={scroll.x}
          scrollY={scroll.y}
          arming={props.arming}
          onProbe={props.onProbe}
          onActive={props.onPickActive}
          onCommit={props.onPickCommit}
          onRegion={props.onRegion}
          onCancel={props.onPickCancel}
        />
      ) : null}

      {props.draft ? (
        <Composer
          key={props.draftKey}
          draft={props.draft}
          top={Math.max(8, props.draft.top - scroll.y)}
          where={whereOf(props.draft)}
          arming={props.arming}
          onScope={props.onScope}
          onArmRegion={props.onArmRegion}
          onCreate={props.onCreateComment}
          onCancel={props.onCancelDraft}
        />
      ) : null}
    </main>
  );
}
