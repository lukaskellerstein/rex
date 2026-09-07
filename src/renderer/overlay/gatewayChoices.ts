// Spec 43 §4 — the pure questions the gateway control asks of a list.
//
// Beside the components rather than in them, for the reason `modelChoices.ts`
// is: they hold no JSX, and this machine's test runner hands `.ts` straight to
// `node`, which strips types and cannot parse `.tsx`.

import type { AgentSdk, SdkDescriptor } from "../../shared/agent-protocol.ts";
import type { GatewayView } from "../../shared/channels.ts";
import type { Message, ModelChoice, SendChoices } from "../../shared/types.ts";

/** The id of the one gateway that is always there and cannot be edited (§2.5). */
export const ORIGINAL_GATEWAY_ID = "rex-original";

/**
 * §4.5 — one route, described in the words the sheet shows.
 *
 * `Original` has no URL and says so in words rather than showing an empty cell:
 * "the SDK's own endpoint" is a real answer, and a blank looks like a mistake.
 */
export function routeSummary(view: GatewayView, sdk: AgentSdk): string {
  const route = view.gateway.routes[sdk];
  if (!route) return "No route for this agent.";
  if (!route.baseUrl) return "The SDK's own endpoint, on your own login.";
  const auth =
    route.auth === "environment"
      ? ` · ${route.credentialEnv ?? "a credential"}`
      : route.auth === "none"
        ? " · no authentication"
        : " · your own login";
  return `${route.baseUrl}${auth}`;
}

/**
 * §4.2 — why this gateway cannot answer for this agent, or null when it can.
 *
 * **Impossible combinations are shown, not hidden.** A gateway with no route
 * stays in the list, greyed, with the reason on hover. Hiding it would make a
 * missing configuration look like a missing feature — and this spec is where
 * the rule is written, one spec before the one where it first bites.
 */
export function unusableReason(view: GatewayView, sdk: AgentSdk, sdkLabel: string): string | null {
  if (!view.gateway.routes[sdk]) {
    return `${view.gateway.name} has no ${sdkLabel} route. Add one in Manage gateways…`;
  }
  // §8.1 — `supportsAsk` false greys the whole combination, exactly as a missing
  // route does. `supportsAct` is different and is handled at the ACT button:
  // a platform that cannot write must still offer ASK.
  const capability = view.capabilities[sdk];
  if (capability && !capability.supportsAsk) {
    return `${view.gateway.name} cannot answer a question through ${sdkLabel} yet.`;
  }
  return null;
}

/** The rows the gateway picker draws, in the order main sent them. */
export function gatewayRows(views: readonly GatewayView[], sdk: AgentSdk): ModelChoice[] {
  return views.map((view) => ({
    value: view.gateway.id,
    displayName: view.gateway.name,
    description: routeSummary(view, sdk),
  }));
}

/**
 * Spec 44 §3 — the rows the AGENT picker draws.
 *
 * **The labels are the descriptor's**, so REX's source names no SDK: `describe`
 * returns only the agents that have an adapter, and an agent REX cannot run is
 * therefore not a row a reviewer can reach.
 *
 * The description counts the gateways that offer each one, because that is the
 * fact the next control depends on: an agent with no route anywhere leads to a
 * gateway menu where every row is greyed, and saying so here is what turns that
 * from a dead end into an instruction.
 */
export function agentRows(
  sdks: readonly SdkDescriptor[],
  views: readonly GatewayView[],
): ModelChoice[] {
  return sdks.map((sdk) => {
    const offered = views.filter((view) => view.gateway.routes[sdk.id]).length;
    return {
      value: sdk.id,
      displayName: sdk.label,
      description:
        offered === 0
          ? "No gateway has a route for it yet. Add one in Manage gateways…"
          : `${offered} of ${views.length} gateway${views.length === 1 ? "" : "s"} offer it.`,
    };
  });
}

/**
 * §3 — the gateway this agent should move to, when the one in hand cannot run it.
 *
 * Spec 43 §4.1's rule for the model, applied one control to the left: a rebuild
 * that drops the current value picks the first that works rather than leaving a
 * selection that cannot send. Null means the one in hand is fine, or that
 * nothing better exists — and a greyed row with its reason on hover is the
 * honest end of that road (§4.2).
 */
export function gatewayForAgent(
  views: readonly GatewayView[],
  sdk: AgentSdk,
  current: string,
): string | null {
  if (views.find((view) => view.gateway.id === current)?.gateway.routes[sdk]) return null;
  return views.find((view) => view.gateway.routes[sdk])?.gateway.id ?? null;
}

/**
 * §4.0 — what a comment that has ALREADY been sent starts on.
 *
 * The newest message that a run produced, which is the newest one carrying a
 * gateway at all: a NOTE stores null in every field (§5.4), so it is skipped by
 * construction rather than by a second test.
 *
 * The reason generalises from spec 31 §4.1's rule for the style: a reply
 * usually continues the conversation it is in, and re-picking three controls on
 * every reply is a tax on the common case.
 */
export function lastUsed(messages: readonly Message[]): SendChoices | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.gatewayName === null && message.sdk === null) continue;
    return {
      sdk: message.sdk,
      // The message keeps the gateway's NAME, not its id — §5.3's whole point,
      // and it means the id has to be found again from the live list. A gateway
      // that has since been renamed or deleted is simply not found, and the
      // caller falls back to the setting.
      gatewayId: null,
      model: message.model,
      style: message.style,
    };
  }
  return null;
}

/**
 * The gateway a comment last ran through, as an id the picker can select.
 *
 * Matched by name, because that is what the message stored. A rename makes this
 * miss and the comment starts on the setting instead — which is right: the row
 * the reviewer is looking at is not the one that answered.
 */
export function lastGatewayId(
  messages: readonly Message[],
  views: readonly GatewayView[],
): string | null {
  const used = lastUsed(messages);
  if (!used) return null;
  const name = [...messages].reverse().find((message) => message.gatewayName !== null)?.gatewayName;
  if (!name) return null;
  return views.find((view) => view.gateway.name === name)?.gateway.id ?? null;
}

/**
 * §5.2's warning — has this combination seen this comment before?
 *
 * The first send to a new one replays the whole thread, and on a local model
 * measured at about 100 tokens per second that is minutes. The composer says so
 * once, **before** the send, because a cost the reviewer learns about by
 * waiting is a cost they had no chance to decline.
 */
export function replayNotice(
  messages: readonly Message[],
  gatewayName: string,
  sdk: AgentSdk,
): string | null {
  if (messages.length === 0) return null;
  const seen = messages.some(
    (message) => message.gatewayName === gatewayName && message.sdk === sdk,
  );
  return seen
    ? null
    : `${gatewayName} has not seen this comment yet. It will be given the conversation so far.`;
}
