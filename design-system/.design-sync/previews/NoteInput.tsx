import { Button, Label, NoteInput, Panel, Shell } from "@rex/design-system";

export const Empty = () => (
  <Shell style={{ padding: 20, width: 340 }}>
    <NoteInput placeholder="What is wrong with this?" />
  </Shell>
);

export const Written = () => (
  <Shell style={{ padding: 20, width: 340 }}>
    <NoteInput
      readOnly
      value="This says 40ms but §4 says 25ms. Which one is current, and which document should change?"
      rows={3}
    />
  </Shell>
);

export const AtTheFootOfTheSelectionPanel = () => (
  <Shell style={{ padding: 20, width: 384 }}>
    <Panel tone="well" padded>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Label>3 PLACES · 2 DOCUMENTS</Label>
        <NoteInput placeholder="What is wrong with this?" />
        <Button variant="primary" block>
          Ask
        </Button>
      </div>
    </Panel>
  </Shell>
);
