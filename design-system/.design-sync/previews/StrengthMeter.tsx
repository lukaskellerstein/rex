import { Shell, StrengthMeter } from "@rex/design-system";

export const ThreeTiers = () => (
  <Shell style={{ padding: 20, display: "flex", flexDirection: "column", gap: 8, width: 240 }}>
    <StrengthMeter strength="durable" />
    <StrengthMeter strength="fair" />
    <StrengthMeter strength="weak" />
  </Shell>
);

export const Durable = () => (
  <Shell style={{ padding: 20 }}>
    <StrengthMeter strength="durable" label="Durable — matched on #resolver-invariant" />
  </Shell>
);

export const WeakAndWhatToDoAboutIt = () => (
  <Shell style={{ padding: 20, width: 320, display: "flex", flexDirection: "column", gap: 8 }}>
    <StrengthMeter strength="weak" />
    <p style={{ margin: 0, color: "var(--muted)", fontSize: 11, lineHeight: 1.45 }}>
      This element has no id and no text of its own. Widen one level before you click and the anchor
      becomes durable.
    </p>
  </Shell>
);
