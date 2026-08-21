import { Label, Shell, Swatch } from "@rex/design-system";

export const ColourMeansState = () => (
  <Shell style={{ padding: 20, width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
    <Label>COLOUR MEANS STATE</Label>
    <Swatch color="var(--action)" name="--action · resolved exactly" value="#2f5da8" />
    <Swatch color="var(--moved)" name="--moved · text moved" value="#f0b429" />
    <Swatch color="var(--lost)" name="--lost · anchor lost" value="#d2402f" />
    <Swatch color="var(--ok)" name="--ok · resolved" value="#4a9d7a" />
    <Swatch color="var(--active)" name="--active · the open comment" value="#7a4fa3" />
  </Shell>
);

export const Surfaces = () => (
  <Shell style={{ padding: 20, width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
    <Label>FOUR DEPTHS, NO SHADOWS</Label>
    <Swatch color="var(--bg)" name="--bg" value="#0d1420" />
    <Swatch color="var(--panel)" name="--panel" value="#131d2e" />
    <Swatch color="var(--sunk)" name="--sunk" value="#1a2638" />
    <Swatch color="var(--well)" name="--well" value="#101a29" />
  </Shell>
);

export const CardWashes = () => (
  <Shell style={{ padding: 20, width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
    <Label>RESTING WASH, THEN SELECTED</Label>
    <Swatch color="var(--wash-ok)" name="--wash-ok" value="#141f31" />
    <Swatch color="var(--wash-ok-on)" name="--wash-ok-on" value="#1a2b45" />
    <Swatch color="var(--wash-moved)" name="--wash-moved" value="#1c1708" />
    <Swatch color="var(--wash-moved-on)" name="--wash-moved-on" value="#262008" />
  </Shell>
);

export const ThePaperHalf = () => (
  <Shell style={{ padding: 20, width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
    <Label>THE PAPER, AND WHAT IS PAINTED ON IT</Label>
    <Swatch color="var(--paper)" name="--paper" value="#fbfaf8" />
    <Swatch color="var(--hl-ok-bg)" name="--hl-ok-bg" value="#dbe6f6" />
    <Swatch color="var(--hl-moved-bg)" name="--hl-moved-bg" value="#fbeecd" />
    <Swatch color="var(--hl-active-bg)" name="--hl-active-bg" value="#ece1f7" />
  </Shell>
);
