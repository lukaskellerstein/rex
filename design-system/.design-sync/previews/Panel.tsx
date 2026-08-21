import { Button, Label, NoteInput, Panel, Shell } from "@rex/design-system";

export const FourDepths = () => (
  <Shell style={{ padding: 20, width: 380, display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ color: "var(--muted)", fontSize: 11 }}>--bg is the ground this sits on</div>
    <Panel padded>
      <Label>PANEL — A COLUMN</Label>
    </Panel>
    <Panel tone="sunk" padded>
      <Label>SUNK — AN INSET</Label>
    </Panel>
    <Panel tone="well" padded>
      <Label>WELL — WHERE THINGS ARE COMPOSED</Label>
    </Panel>
  </Shell>
);

export const TheSelectionPanel = () => (
  <Shell style={{ padding: 20, width: 384 }}>
    <Panel tone="well" padded>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Label>SELECTION · 3 PLACES</Label>
        <NoteInput placeholder="What is wrong with this?" />
        <Button variant="primary" block>
          Ask
        </Button>
      </div>
    </Panel>
  </Shell>
);

export const FlushSpansTheColumn = () => (
  <Shell style={{ padding: 0, width: 320 }}>
    <Panel flush padded>
      <Label>EXPLORER</Label>
    </Panel>
  </Shell>
);
