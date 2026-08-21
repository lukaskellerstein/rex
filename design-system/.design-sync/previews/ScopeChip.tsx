import { ScopeChip, Shell, StrengthMeter } from "@rex/design-system";

export const WideningOutOfATable = () => (
  <Shell style={{ padding: 20 }}>
    <div className="rex-scopes">
      <ScopeChip>sentence</ScopeChip>
      <ScopeChip on>cell</ScopeChip>
      <ScopeChip>row</ScopeChip>
      <ScopeChip>table</ScopeChip>
    </div>
  </Shell>
);

export const InProse = () => (
  <Shell style={{ padding: 20 }}>
    <div className="rex-scopes">
      <ScopeChip on>sentence</ScopeChip>
      <ScopeChip>paragraph</ScopeChip>
      <ScopeChip>section</ScopeChip>
    </div>
  </Shell>
);

/* The chips and the meter appear together, on the expanded row, because the
   moment you choose what to point at is the moment the meter can change it. */
export const OnTheExpandedRow = () => (
  <Shell style={{ padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 8 }}>
    <div className="rex-scopes">
      <ScopeChip>sentence</ScopeChip>
      <ScopeChip on>paragraph</ScopeChip>
      <ScopeChip>section</ScopeChip>
    </div>
    <StrengthMeter strength="weak" />
  </Shell>
);
