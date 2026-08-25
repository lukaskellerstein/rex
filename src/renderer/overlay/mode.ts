// Spec 12 §2 — the two modes, named after what the REVIEWER is doing.
//
// `Profile` in `shared/types.ts` stays `"read" | "write"`. It is the stored
// value, it is what the gate switches on, and renaming it would touch the
// database for no gain. `read`/`write` is also the right name for the thing the
// gate tests. These are the labels drawn on the screen, and they are the
// reviewer's own words: they ASK a question, or they tell REX to ACT.
//
// (Version 1 of the spec called them READ and APPLY, after what REX does. That
// was a name for the machinery, and it stopped working the moment the mode
// became something the reviewer PICKS — spec 12 §3. You do not pick "read".)
//
// The two promises are different in KIND, and nothing here may blur them.
// ASK's promise is kept before the tool runs — spec 12 §6, the gate. ACT's is
// kept after it runs, by spec 01 §8.7 step 5 — the diff. Saying "ACT is safe
// too" without saying how would be a smaller claim wearing the same words.

import type { Profile } from "../../shared/types.ts";

export type Mode = "ask" | "act";

export function modeOf(profile: Profile): Mode {
  return profile === "write" ? "act" : "ask";
}

export const MODE_LABEL: Record<Mode, string> = {
  ask: "ASK",
  act: "ACT",
};

/**
 * The subtitle beside the label, and the reason the band is worth drawing at
 * all. "ASK" on its own is a name. What a reviewer needs to know is what the
 * name buys them.
 */
export const MODE_PROMISE: Record<Mode, string> = {
  ask: "cannot change any file, by any route",
  act: "changes are shown as a diff and kept only when you accept",
};
