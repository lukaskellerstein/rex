import { Shell, ToolSteps } from "@rex/design-system";

const RUN = [
  { name: "Read", arg: "docs/architecture/components.md" },
  { name: "Grep", arg: "40ms" },
  { name: "Read", arg: "docs/my-specs/03-rendering/SPEC.md" },
  { name: "WebFetch", arg: "https://code.claude.com/docs/en/agent-sdk" },
  { name: "ToolSearch", arg: "select:LSP" },
];

export const Collapsed = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <ToolSteps steps={RUN} onShowTrace={() => {}} />
  </Shell>
);

export const Open = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <ToolSteps open steps={RUN} onShowTrace={() => {}} />
  </Shell>
);

/* The read profile cannot write. This card is the proof, and it is why a denied
   step stays visible in red instead of being folded away. */
export const ADeniedWriteStaysVisible = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <ToolSteps
      open
      onShowTrace={() => {}}
      steps={[
        { name: "Read", arg: "docs/architecture/components.md" },
        { name: "Grep", arg: "40ms" },
        {
          name: "Write",
          arg: "docs/architecture/components.md — denied by the read profile",
          denied: true,
        },
      ]}
    />
  </Shell>
);

export const OneStep = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <ToolSteps steps={[{ name: "Read", arg: "docs/README.md" }]} />
  </Shell>
);
