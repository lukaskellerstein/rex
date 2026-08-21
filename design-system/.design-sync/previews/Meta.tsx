import { Answer, Meta, Shell, StatePill } from "@rex/design-system";

export const TheRunStrip = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", alignItems: "center", gap: 8 }}>
    <StatePill tone="ok">READ</StatePill>
    <Meta tabular>2 turns · 6 steps · 12.4s · $0.031</Meta>
  </Shell>
);

export const AnAddress = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", flexDirection: "column", gap: 4 }}>
    <Meta mono>docs/architecture/components.md</Meta>
    <Meta mono>docs/review/2026-08-20-architecture-explained.html</Meta>
  </Shell>
);

export const UnderTheAnswer = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", flexDirection: "column", gap: 8 }}>
    <Answer>
      <p>No. The budget moved to 25ms in commit 1785be6, and this paragraph was not updated.</p>
    </Answer>
    <Meta tabular>read · 2 turns · 6 steps · 12.4s · $0.031</Meta>
  </Shell>
);
