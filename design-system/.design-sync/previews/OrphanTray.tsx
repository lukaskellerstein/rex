import { OrphanTray, Shell, ThreadCard, Token } from "@rex/design-system";

export const One = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <OrphanTray count={1} />
  </Shell>
);

export const AcrossTheWorkspace = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <OrphanTray count={4} note="3 in other documents" />
  </Shell>
);

/* Where it actually sits: at the top of the comments column, above the cards,
   because it has no line in the document to sit beside. */
export const AtTheTopOfTheColumn = () => (
  <Shell style={{ padding: 20, width: 384, display: "flex", flexDirection: "column", gap: 8 }}>
    <OrphanTray count={2} note="1 in another document" />
    <ThreadCard
      token={<Token index={1} />}
      note="Is 40ms still the target here?"
      documents="docs/architecture/components.md"
      meta={<span>read · 2 turns</span>}
    />
  </Shell>
);
