import { Button, Shell, TextButton } from "@rex/design-system";

export const OpensAView = () => (
  <Shell style={{ padding: 20, display: "flex", gap: 16 }}>
    <TextButton>show trace ›</TextButton>
    <TextButton>go to ›</TextButton>
  </Shell>
);

export const UnfoldsInPlace = () => (
  <Shell style={{ padding: 20 }}>
    <TextButton>details ⌄</TextButton>
  </Shell>
);

export const BesideARealButton = () => (
  <Shell style={{ padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
    <Button variant="primary">Ask</Button>
    <TextButton quiet>clear</TextButton>
  </Shell>
);
