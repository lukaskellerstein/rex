// Spec 46 §8 — the pure questions the Settings screen asks of its data.
//
// Beside the components rather than in them, for the reason `gatewayChoices.ts`
// is: they hold no JSX, and this machine's test runner hands `.ts` straight to
// `node`, which strips types and cannot parse `.tsx`.
//
// **Nothing here names a provider.** Every answer comes from the descriptor
// table, which is criterion A8: adding a seventh provider is a row in
// `providers.py` and at most one probe function, with no `if provider ==` in
// anything that renders.

import type {
  GatewayDiscovery,
  GatewayProviderView,
  ProviderDescriptor,
  ProviderField,
} from "../../shared/channels.ts";

/** One row in the Models tab's model list, ready to draw. */
export interface ModelRow {
  /** The provider's own id, verbatim — what the engine is asked for. */
  id: string;
  /** Ticked means REX offers it in the composer. Nothing else reaches it. */
  ticked: boolean;
  /** Null when the provider did not say. Never guessed. */
  context: number | null;
  kind: "chat" | "embedding" | "unknown";
  /** Null is "the provider did not say" and must not be drawn as "no" (§5.5). */
  tools: boolean | null;
  /** What the probe read, in one line. */
  note: string;
  /**
   * §5.3 — the provider no longer lists it, but it stays ticked and says so.
   *
   * A refresh that no longer names a model means the engine unloaded it, the
   * account lost access, or the name changed — three different problems, and
   * REX can tell none of them apart. Deleting the row would silently change
   * what the person configured; keeping it and saying "not offered when last
   * asked" leaves the decision with them.
   */
  gone: boolean;
  /** Why it cannot be ticked, or null. Drawn beside the box, never as a silence. */
  blocked: string | null;
}

/**
 * The rows for one provider: what it offers now, plus what is ticked and gone.
 *
 * Discovery is the live list and `provider.models` is the stored one, and the
 * two disagree in both directions. A model that is offered and not ticked is an
 * option; one that is ticked and not offered is §5.3's case above.
 */
export function modelRows(
  provider: GatewayProviderView,
  discovery: GatewayDiscovery | null,
): ModelRow[] {
  const ticked = new Map(provider.models.map((model) => [model.model, model]));
  const rows: ModelRow[] = [];

  for (const found of discovery?.models ?? []) {
    rows.push({
      id: found.id,
      ticked: ticked.has(found.id),
      context: found.context,
      kind: found.kind,
      tools: found.tools,
      note: found.note,
      gone: false,
      blocked: blockedReason(found.kind, found.tools),
    });
    ticked.delete(found.id);
  }

  // Whatever is left is ticked and was not offered. Kept and marked.
  for (const model of ticked.values()) {
    rows.push({
      id: model.model,
      ticked: true,
      context: model.maxInput,
      kind: "unknown",
      tools: model.tools,
      note: "",
      gone: true,
      blocked: null,
    });
  }
  return rows;
}

/**
 * §5.5 — why a model cannot be used, in the words a person can act on.
 *
 * **Silence is never a claim.** Where a provider says nothing about tools, this
 * says nothing: a guess would be worse, because a model that cannot call a tool
 * is useless to an agent in a way that is invisible until a run silently does
 * nothing, and a wrong warning would send someone to fix the wrong thing.
 */
export function blockedReason(kind: ModelRow["kind"], tools: boolean | null): string | null {
  if (kind === "embedding") {
    return "An embedding model produces vectors, not answers. REX cannot use one.";
  }
  if (tools === false) {
    return "This model cannot call tools, so an agent using it would do nothing.";
  }
  return null;
}

/**
 * §5.4 — may this provider's models be ticked without a click each?
 *
 * A local provider may be enumerated freely: listing everything on the disk
 * costs nothing. A paid one bills a real account per model, so **REX lists what
 * it offers and adds nothing without a click** — the rule is inherited word for
 * word from the reviewer's own `gateway_discovery.py`.
 */
export function mayTickAll(descriptor: ProviderDescriptor | null): boolean {
  return descriptor?.local === true;
}

/** The sentence a paid provider's list carries, or null for a local one. */
export function moneyNotice(descriptor: ProviderDescriptor | null): string | null {
  if (!descriptor || descriptor.local) return null;
  return "Nothing is added until you tick it. These models cost money.";
}

/**
 * §6 — how old the list is, in words rather than a timestamp.
 *
 * "A cached list is dated." A list that silently ages is how a person concludes
 * their provider is broken when it merely gained a model, so the screen always
 * says when it asked and offers to ask again.
 */
export function askedAgo(listedAt: string | null, now: number = Date.now()): string {
  if (!listedAt) return "Not asked yet";
  const ms = now - new Date(listedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "Asked just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Asked just now";
  if (minutes < 60) return `Asked ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Asked ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Asked ${days} day${days === 1 ? "" : "s"} ago`;
}

/** A window in the short form the screen shows. Null stays absent, never "0k". */
export function windowLabel(context: number | null): string {
  if (context === null) return "—";
  if (context >= 1000) return `${Math.round(context / 1000)}k`;
  return String(context);
}

/**
 * What a provider must be given before it can be added.
 *
 * Read from the descriptor's own fields, so a seventh provider needs no change
 * here. An empty list means it is ready.
 */
export function missingFields(
  descriptor: ProviderDescriptor,
  values: Record<string, string>,
): ProviderField[] {
  return descriptor.fields.filter((field) => field.required && !values[field.key]?.trim());
}

/**
 * §8 — the line under the built-in row, and what it says when nothing is set up.
 *
 * A count of zero is not drawn as "0 models from 0 providers": that reads as a
 * fault. It reads as an instruction instead, because that is what it is.
 */
export function builtinSummary(models: number, providers: number): string {
  if (providers === 0) return "No providers yet — add one in Models to give it something to serve.";
  if (models === 0) {
    return `${providers} provider${providers === 1 ? "" : "s"}, but no models ticked yet.`;
  }
  return `${models} model${models === 1 ? "" : "s"} from ${providers} provider${providers === 1 ? "" : "s"}`;
}

/** Bytes, in the one unit the Settings line wants (§8 rule 5). */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The ticked set to send back, given a row list and one box the person clicked.
 *
 * A blocked model can never become ticked, whatever was clicked — the checkbox
 * is disabled in the screen and this is the second half of that, so a keyboard
 * or a stale render cannot get past it.
 */
export function toggled(rows: readonly ModelRow[], id: string): ModelRow[] {
  return rows.map((row) => (row.id === id && !row.blocked ? { ...row, ticked: !row.ticked } : row));
}

/** What `gateway:models:save` wants, from the rows on screen. */
export function tickedModels(
  rows: readonly ModelRow[],
): Array<{ model: string; context: number | null; tools: boolean | null }> {
  return rows
    .filter((row) => row.ticked)
    .map((row) => ({ model: row.id, context: row.context, tools: row.tools }));
}

/**
 * The sections the sheet has.
 *
 * A union rather than a free string, so a tab nobody built cannot be opened —
 * and adding one is a member here plus a row in `SECTIONS` below.
 */
export type SettingsTab = "gateways" | "models";

/**
 * The tab strip, as data.
 *
 * **Adding a section is one row here and one `case` in the body**, and nothing
 * else — no second place that lists the tabs, no `if` chain in the nav. The
 * reviewer asked for exactly that on 2026-09-06: "we might want to have there
 * in the future different sections than just now, the gateways."
 *
 * The order is the order a person meets them: where answers come from, then
 * what may be asked for.
 */
export const SECTIONS: ReadonlyArray<{
  id: SettingsTab;
  label: string;
  /** One line under the section's heading. What this section is FOR. */
  blurb: string;
}> = [
  {
    id: "gateways",
    label: "Gateways",
    blurb:
      "Where REX asks for inference. Every comment picks one, and every answer records the one that produced it.",
  },
  {
    id: "models",
    label: "Models",
    blurb:
      "What the built-in gateway may serve. A gateway somebody else runs has its own models, configured inside it.",
  },
];
