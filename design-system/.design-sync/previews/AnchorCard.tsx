import {
  AnchorCard,
  AnchorKind,
  Quote,
  Shell,
  StatePill,
  TextButton,
  Token,
} from "@rex/design-system";

export const Open = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <AnchorCard
      head={
        <>
          <Token index={1} />
          <TextButton>go to ›</TextButton>
        </>
      }
      note="Is 40ms still the target here?"
    >
      <Quote>The renderer must paint a resolved highlight within 40ms.</Quote>
    </AnchorCard>
  </Shell>
);

export const TheTextMoved = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <AnchorCard
      state="moved"
      head={
        <>
          <Token index={2} state="moved" />
          <StatePill tone="moved">TEXT MOVED</StatePill>
          <TextButton>go to ›</TextButton>
        </>
      }
      note="This contradicts §4 — which one is current?"
    >
      <Quote>The anchor resolver runs in the renderer, on the live DOM.</Quote>
    </AnchorCard>
  </Shell>
);

export const TheAnchorIsLost = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <AnchorCard
      state="orphaned"
      head={
        <>
          <Token index={3} state="orphaned" />
          <StatePill tone="lost">ANCHOR LOST</StatePill>
        </>
      }
      note="Was this sentence removed on purpose?"
    >
      <Quote>
        A webview showing a remote page has no local file for the main process to search.
      </Quote>
    </AnchorCard>
  </Shell>
);

/* A figure has no words to quote, so AnchorKind takes the quote's place. */
export const AFigureInsteadOfAQuote = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <AnchorCard head={<Token index={4} />} note="This diagram still shows the broker we removed.">
      <AnchorKind title="Figure" geometry="1024 × 384" />
    </AnchorCard>
  </Shell>
);
