// Spec 46 §4.6 — whether this comment can have a traffic log at all, and why not.
//
// It lived inside `ipc.ts` as a closure over the database until spec 55 gave it
// a third caller. Three places now ask the same question about one thread —
// `gateway:traffic`, `trace:turns` and the report a reviewer pastes — and three
// answers to one question is the failure a shared reader exists to prevent.
//
// It takes the ROWS and not the database, so `node --test` can ask it too and
// so the caller that already has them does not read them twice.

import type { Message } from "../../shared/types.ts";
import { BUILTIN_GATEWAY_NAME } from "../db/migrate.ts";

export interface TrafficAvailability {
  available: boolean;
  /** Null when there is a log. A sentence a screen can print when there is not. */
  reason: string | null;
}

export function trafficAvailability(messages: readonly Message[]): TrafficAvailability {
  const names = new Set(messages.map((message) => message.gatewayName).filter(Boolean));

  // A comment that ran on `Original` has no gateway traffic at all: those
  // requests went straight to the vendor and no gateway ever saw them.
  if (!messages.some((message) => message.baseUrl)) {
    return {
      available: false,
      reason:
        "This comment ran on Original, so its requests went straight to the SDK's own " +
        "endpoint and never through a gateway. Pick the built-in gateway in the composer, " +
        "ask again, and this will show that run.",
    };
  }
  if (!names.has(BUILTIN_GATEWAY_NAME)) {
    return {
      available: false,
      reason:
        "This comment ran through a gateway somebody else runs, so REX did not write its " +
        "configuration and could not add the recorder to it. Only REX's own built-in " +
        "gateway keeps a traffic log.",
    };
  }
  return { available: true, reason: null };
}
