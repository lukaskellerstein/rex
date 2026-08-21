import { Label, Quote, Shell } from "@rex/design-system";

export const NamingARegion = () => (
  <Shell style={{ padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 8 }}>
    <Label>ANCHOR</Label>
    <Quote small>The anchor resolver runs in the renderer, on the live DOM.</Quote>
  </Shell>
);

export const TheOnesREXUses = () => (
  <Shell style={{ padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 14 }}>
    <Label>ANCHOR</Label>
    <Label>PLACES</Label>
    <Label>MOST REFERENCED</Label>
    <Label>EVIDENCE</Label>
    <Label>SELECTION · 3 PLACES</Label>
  </Shell>
);

export const AgainstTheThingItNames = () => (
  <Shell style={{ padding: 20, width: 340 }}>
    <Label>OLDER CLAIM</Label>
    <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
      The budget was 40ms until commit 1785be6. The label is quiet so this line is what you read
      first.
    </p>
  </Shell>
);
