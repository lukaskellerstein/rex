import { Chip, Shell } from "@rex/design-system";

export const TheFilterRow = () => (
  <Shell style={{ padding: 20, display: "flex", gap: 6, flexWrap: "wrap" }}>
    <Chip on count={12}>
      All
    </Chip>
    <Chip count={7} tone="open">
      Open
    </Chip>
    <Chip count={4} tone="resolved">
      Resolved
    </Chip>
    <Chip count={1} tone="orphaned">
      Orphaned
    </Chip>
  </Shell>
);

export const TheCountTakesItsColourOnlyWhenOn = () => (
  <Shell style={{ padding: 20, display: "flex", gap: 6, flexWrap: "wrap" }}>
    <Chip count={12}>All</Chip>
    <Chip on count={7} tone="open">
      Open
    </Chip>
    <Chip on count={4} tone="resolved">
      Resolved
    </Chip>
    <Chip on count={1} tone="orphaned">
      Orphaned
    </Chip>
  </Shell>
);

export const NothingLeftToShow = () => (
  <Shell style={{ padding: 20, display: "flex", gap: 6 }}>
    <Chip count={12}>All</Chip>
    <Chip on count={0} tone="orphaned">
      Orphaned
    </Chip>
  </Shell>
);
