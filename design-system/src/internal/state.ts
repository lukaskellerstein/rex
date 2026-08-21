/**
 * How an anchor last resolved. This is the vocabulary the whole palette is
 * built on — steel `ok`, amber `moved`, red `orphaned`, green `resolved` — and
 * every component that shows state takes exactly these four words.
 *
 * `orphaned` means the text is gone. It is not the same as a target in a
 * document nobody has opened, which is `unchecked` and grey.
 */
export type AnchorState = "ok" | "moved" | "orphaned" | "resolved";

/** The suffix each state contributes to a class name. */
export const STATE_SUFFIX: Record<AnchorState, string> = {
  ok: "ok",
  moved: "moved",
  orphaned: "orphaned",
  resolved: "done",
};

/** What each state is called on screen. Colour never carries a meaning alone. */
export const STATE_WORD: Record<AnchorState, string> = {
  ok: "resolved exactly",
  moved: "text moved",
  orphaned: "anchor lost",
  resolved: "resolved",
};
