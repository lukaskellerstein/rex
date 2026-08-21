import { Shell, Token } from "@rex/design-system";

export const FourStates = () => (
  <Shell style={{ padding: 24, display: "flex", alignItems: "center", gap: 14 }}>
    <Token index={1} />
    <Token index={2} state="moved" />
    <Token index={3} state="orphaned" />
    <Token index={4} state="resolved" />
  </Shell>
);

export const Labelled = () => (
  <Shell style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, width: 260 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Token index={1} />
      <span style={{ color: "var(--muted)", fontSize: 11 }}>resolved exactly</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Token index={2} state="moved" />
      <span style={{ color: "var(--muted)", fontSize: 11 }}>text moved</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Token index={3} state="orphaned" />
      <span style={{ color: "var(--muted)", fontSize: 11 }}>anchor lost</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Token index={4} state="resolved" />
      <span style={{ color: "var(--muted)", fontSize: 11 }}>
        resolved — drained, still numbered
      </span>
    </div>
  </Shell>
);

export const TheOpenOneIsRinged = () => (
  <Shell style={{ padding: 24, display: "flex", alignItems: "center", gap: 16 }}>
    <Token index={1} />
    <Token index={2} state="moved" active />
    <Token index={3} state="orphaned" />
  </Shell>
);
