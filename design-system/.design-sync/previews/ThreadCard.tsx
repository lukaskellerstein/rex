import { Shell, ThreadCard, Token } from "@rex/design-system";

export const Resting = () => (
  <Shell style={{ padding: 20, width: 384 }}>
    <ThreadCard
      token={<Token index={1} />}
      note="Is 40ms still the target here?"
      documents="docs/architecture/components.md"
      meta={<span>read · 2 turns</span>}
    />
  </Shell>
);

export const FourStates = () => (
  <Shell style={{ padding: 20, width: 384, display: "flex", flexDirection: "column", gap: 8 }}>
    <ThreadCard
      token={<Token index={1} />}
      note="Is 40ms still the target here?"
      documents="docs/architecture/components.md"
      meta={<span>read · 2 turns</span>}
    />
    <ThreadCard
      state="moved"
      token={<Token index={2} state="moved" />}
      note="This paragraph contradicts §4."
      documents="components.md · architecture.html"
      meta={<span className="rex-state-moved">text moved</span>}
    />
    <ThreadCard
      state="orphaned"
      token={<Token index={3} state="orphaned" />}
      note="Was this sentence removed on purpose?"
      documents="2026-08-20-architecture-explained.html"
      meta={<span className="rex-state-orphaned">anchor lost</span>}
    />
    <ThreadCard
      state="resolved"
      token={<Token index={4} state="resolved" />}
      note="Name the two processes explicitly."
      documents="docs/architecture/components.md"
      meta={<span className="rex-state-resolved">resolved</span>}
    />
  </Shell>
);

export const SelectedDeepensTheSameWash = () => (
  <Shell style={{ padding: 20, width: 384, display: "flex", flexDirection: "column", gap: 8 }}>
    <ThreadCard
      state="moved"
      token={<Token index={2} state="moved" />}
      note="Resting — this one is not open."
      documents="components.md"
      meta={<span className="rex-state-moved">text moved</span>}
    />
    <ThreadCard
      state="moved"
      selected
      token={<Token index={2} state="moved" active />}
      note="Selected — same hue, deeper wash, brighter border."
      documents="components.md"
      meta={<span className="rex-state-moved">text moved</span>}
    />
  </Shell>
);
