import { GutterMarker, Shell } from "@rex/design-system";

/* The gutter is on the paper, so these cards put it beside one — that is the
   only ground the marker was ever drawn to read against. */
const Paper = ({ children }: { children: React.ReactNode }) => (
  <Shell style={{ padding: 20 }}>
    <div style={{ display: "flex", height: 240, background: "var(--paper)" }}>
      <div
        style={{
          flex: 1,
          padding: "16px 20px",
          color: "var(--paper-ink-body)",
          font: "15px/1.68 var(--serif)",
        }}
      >
        The anchor resolver runs in the renderer, on the live DOM. The main process stores anchors
        and never resolves them — a webview showing a remote page has no local file for it to
        search.
      </div>
      {children}
    </div>
  </Shell>
);

export const OnThePaper = () => (
  <Paper>
    <div className="rex-gutter">
      <GutterMarker index={1} style={{ position: "absolute", top: 18, right: 7 }} />
      <GutterMarker index={2} state="moved" style={{ position: "absolute", top: 74, right: 7 }} />
      <GutterMarker
        index={3}
        state="resolved"
        style={{ position: "absolute", top: 130, right: 7 }}
      />
    </div>
  </Paper>
);

export const AnOrphanPinsToTheFoot = () => (
  <Paper>
    <div className="rex-gutter">
      <GutterMarker index={1} style={{ position: "absolute", top: 18, right: 7 }} />
      <GutterMarker
        index={4}
        state="orphaned"
        pinned
        style={{ position: "absolute", bottom: 10, right: 7 }}
      />
    </div>
  </Paper>
);

export const TheOpenCommentIsRinged = () => (
  <Paper>
    <div className="rex-gutter">
      <GutterMarker index={1} style={{ position: "absolute", top: 18, right: 7 }} />
      <GutterMarker
        index={2}
        state="moved"
        active
        style={{ position: "absolute", top: 78, right: 7 }}
      />
    </div>
  </Paper>
);
