import { Shell, StatePill } from "@rex/design-system";

export const FourTones = () => (
  <Shell
    style={{
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      alignItems: "flex-start",
    }}
  >
    <StatePill tone="ok">RESOLVED EXACTLY</StatePill>
    <StatePill tone="moved">TEXT MOVED</StatePill>
    <StatePill tone="lost">ANCHOR LOST</StatePill>
    <StatePill tone="write">WRITE PROFILE</StatePill>
  </Shell>
);

/* Red is spent on exactly two things, and this card is why that holds: both of
   them mean "look at this before you go on". */
export const TheTwoRedsAreOneMeaning = () => (
  <Shell style={{ padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <StatePill tone="lost">ANCHOR LOST</StatePill>
      <span style={{ color: "var(--muted)", fontSize: 11 }}>the text is gone</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <StatePill tone="write">WRITE PROFILE</StatePill>
      <span style={{ color: "var(--muted)", fontSize: 11 }}>this agent can change a file</span>
    </div>
  </Shell>
);

export const InACardHead = () => (
  <Shell style={{ padding: 20, display: "flex", alignItems: "center", gap: 8 }}>
    <StatePill tone="moved">TEXT MOVED</StatePill>
    <span style={{ color: "var(--muted)", fontSize: 11 }}>re-found 14 lines below</span>
  </Shell>
);
