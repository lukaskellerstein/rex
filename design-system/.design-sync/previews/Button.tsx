import { Button, Shell } from "@rex/design-system";

export const Ask = () => (
  <Shell style={{ padding: 20 }}>
    <Button variant="primary">Ask</Button>
  </Shell>
);

export const Variants = () => (
  <Shell style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
    <Button variant="primary">Ask</Button>
    <Button>Resolve</Button>
    <Button variant="write">Apply</Button>
  </Shell>
);

export const NothingSelectedYet = () => (
  <Shell style={{ padding: 20, display: "flex", gap: 12 }}>
    <Button variant="primary" disabled>
      Ask
    </Button>
    <Button disabled>Resolve</Button>
    <Button variant="write" disabled>
      Apply
    </Button>
  </Shell>
);

export const AtTheFootOfThePanel = () => (
  <Shell style={{ padding: 20, width: 320 }}>
    <Button variant="primary" block>
      Ask — 3 places, 2 documents
    </Button>
  </Shell>
);
