import { Segmented, Shell } from "@rex/design-system";

export const TheWorkspaceView = () => (
  <Shell style={{ padding: 20 }}>
    <Segmented
      aria-label="Workspace view"
      value="document"
      options={[
        { value: "document", label: "Document" },
        { value: "graph", label: "Graph" },
        { value: "facts", label: "Facts" },
      ]}
    />
  </Shell>
);

export const TheSidebar = () => (
  <Shell style={{ padding: 20 }}>
    <Segmented
      aria-label="Sidebar"
      value="selection"
      options={[
        { value: "selection", label: "Selection", count: 3 },
        { value: "comments", label: "Comments", count: 12 },
      ]}
    />
  </Shell>
);

export const AnEmptySelectionDimsAndReadsZero = () => (
  <Shell style={{ padding: 20 }}>
    <Segmented
      aria-label="Sidebar"
      value="comments"
      options={[
        { value: "selection", label: "Selection", count: 0, disabled: true },
        { value: "comments", label: "Comments", count: 12 },
      ]}
    />
  </Shell>
);

export const BothWearTheSameControl = () => (
  <Shell style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, width: 320 }}>
    <Segmented
      aria-label="Workspace view"
      value="graph"
      options={[
        { value: "document", label: "Document" },
        { value: "graph", label: "Graph" },
        { value: "facts", label: "Facts" },
      ]}
    />
    <Segmented
      aria-label="Sidebar"
      value="selection"
      options={[
        { value: "selection", label: "Selection", count: 3 },
        { value: "comments", label: "Comments", count: 12 },
      ]}
    />
  </Shell>
);
