import { AnchorKind, Shell } from "@rex/design-system";

export const AFigure = () => (
  <Shell style={{ padding: 20, width: 330 }}>
    <AnchorKind title="Figure" geometry="1024 × 384" />
  </Shell>
);

export const ThreeKinds = () => (
  <Shell style={{ padding: 20, width: 330, display: "flex", flexDirection: "column", gap: 8 }}>
    <AnchorKind title="Figure" geometry="1024 × 384" />
    <AnchorKind title="Region of a figure" geometry="x 210 · y 96 · 320 × 180" />
    <AnchorKind title="Table" geometry="rows 3–7" />
  </Shell>
);

export const WithAThumbnail = () => (
  <Shell style={{ padding: 20, width: 330 }}>
    <AnchorKind
      title="Region of a figure"
      geometry="x 210 · y 96 · 320 × 180"
      figure={
        <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="33"
            height="25"
            rx="2"
            fill="var(--sunk)"
            stroke="var(--rule)"
          />
          <rect
            x="7"
            y="6"
            width="14"
            height="10"
            fill="none"
            stroke="var(--action)"
            strokeWidth="1.5"
          />
        </svg>
      }
    />
  </Shell>
);
