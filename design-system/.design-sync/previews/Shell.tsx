import { Answer, Button, Label, Meta, NoteInput, Quote, Shell } from "@rex/design-system";

export const TheGround = () => (
  <Shell style={{ padding: 24, width: 380 }}>
    <Label>ANCHOR</Label>
    <Quote>The anchor resolver runs in the renderer, on the live DOM.</Quote>
    <Meta tabular>read · 2 turns · 6 steps · 12.4s · $0.031</Meta>
  </Shell>
);

export const OutsideAShellNothingIsStyled = () => (
  <div
    style={{
      display: "flex",
      gap: 16,
      padding: 20,
      background: "#fff",
      alignItems: "flex-start",
    }}
  >
    <div style={{ padding: 12, border: "1px dashed #bbb", borderRadius: 6 }}>
      <div style={{ marginBottom: 8, font: "600 11px system-ui", color: "#666" }}>no Shell</div>
      <Button variant="primary">Ask</Button>
    </div>
    <Shell style={{ padding: 12, borderRadius: 6 }}>
      <div style={{ marginBottom: 8, font: "600 11px var(--sans)", color: "var(--muted)" }}>
        inside a Shell
      </div>
      <Button variant="primary">Ask</Button>
    </Shell>
  </div>
);

export const AWholeColumn = () => (
  <Shell
    style={{
      width: 384,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}
  >
    <Label>COMMENT</Label>
    <Answer role="user">
      <p>Is 40ms still the target here?</p>
    </Answer>
    <Answer>
      <p>No. The budget moved to 25ms in commit 1785be6, and this paragraph was not updated.</p>
    </Answer>
    <NoteInput placeholder="Reply to this thread" />
    <Button variant="primary" block>
      Send
    </Button>
  </Shell>
);
