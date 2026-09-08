// Spec 43 §4.5 — `Manage gateways…`, and it is a **generic form over the
// descriptor**.
//
// This file contributes the styling, the shadow root, the layout, and where the
// row is saved. It contributes **no knowledge of any gateway**: the kind
// dropdown is the descriptor's `kinds`, the fields under it are that kind's
// `fields`, the preview is `buildRoutes()` and the errors are
// `validateGateway()` — both of them `bridge.ts`'s twins of the library's own
// pure functions, written over the catalogue the generator inlined. So the sheet
// previews a route with no round trip, and adding a gateway kind is a pull
// request against `catalogue.py` that never touches REX.
//
// Two rules the layout exists to keep:
//
//   * an SDK with no adapter yet is shown GREYED, with the spec that will fill
//     it, so the reviewer sees the shape and cannot save a route nothing can
//     run; and
//   * `Original` is drawn, and cannot be edited or deleted. It is what REX does
//     with no gateway at all, and it must stay reachable in one click from any
//     state this screen can get into (§2.5).

import { useEffect, useMemo, useState } from "react";
import type { AgentSdk, GatewayKind, VerifyResult } from "../../shared/agent-protocol.ts";
import type {
  AgentGatewayDraft,
  GatewayListResponse,
  GatewayRouteDraft,
  GatewayView,
  OpenCodeStatus,
} from "../../shared/channels.ts";
import { recoverValues } from "../../shared/gateways.ts";
import { ORIGINAL_GATEWAY_ID } from "./gatewayChoices.ts";

/**
 * The four SDKs, in the order spec 42 declares them.
 *
 * `list_sdks()` returns only the SDKs that have an adapter — one, today — so
 * the descriptor alone cannot draw §4.5's greyed rows. The names are the
 * library's own type; the labels here are the fallback for a row the descriptor
 * does not carry, and the descriptor's own label wins wherever it has one.
 */
const SDK_ORDER: AgentSdk[] = ["claude-agent", "codex", "opencode", "deep-agents"];

const SDK_LABELS: Record<AgentSdk, string> = {
  "claude-agent": "Claude Agent SDK",
  codex: "Codex",
  opencode: "OpenCode",
  "deep-agents": "Deep Agents",
};

/**
 * The descriptor, as this component needs it.
 *
 * Mirrors the generated shapes rather than importing them one by one, because
 * every field here is drawn and none is interpreted: a `kind` this build has
 * never heard of renders as a row with a label and its own fields, which is
 * exactly what "the library describes and the host renders" is supposed to buy.
 */
interface Descriptor {
  sdks: Array<{ id: AgentSdk; label: string }>;
  kinds: Array<{
    id: GatewayKind;
    label: string;
    unverified?: string | null;
    fields: Array<{
      key: string;
      label: string;
      kind: string;
      required?: boolean;
      placeholder?: string | null;
      help?: string | null;
      default?: string | null;
    }>;
    routes: Partial<Record<AgentSdk, { protocol: string; note: string }>>;
  }>;
}

interface Props {
  descriptor: Descriptor;
  list: GatewayListResponse;
  /** The SDKs that actually have an adapter. Everything else is drawn greyed. */
  built: readonly AgentSdk[];
  onSave: (draft: AgentGatewayDraft) => Promise<void>;
  onDelete: (gatewayId: string) => Promise<void>;
  /**
   * §4.5 — a saved gateway, or the answers that would build one.
   *
   * Spec 44 §2 — and WHICH route, because a gateway holds one per agent and
   * they address different paths. Verifying a gateway without saying which
   * agent asked would answer about `/v1/messages` for a route that will knock
   * on `/v1/responses`.
   */
  onVerify: (target: GatewayCheckTarget, sdk: AgentSdk) => Promise<VerifyResult>;
  onTest: (
    target: GatewayCheckTarget,
    sdk: AgentSdk,
    model: string | null,
  ) => Promise<{ ok: boolean; detail: string }>;
  onDefault: (gatewayId: string) => Promise<void>;
  onHasEnv: (name: string) => Promise<boolean>;
  /**
   * Spec 47 §2.1 — where the `opencode` program is, and the override for it.
   *
   * Passed in rather than reached for, exactly as every other side effect on
   * this screen is: the panel is JSX and main is what looks at a disk.
   */
  onOpenCodeStatus: () => Promise<OpenCodeStatus>;
  onOpenCodeExecutable: (override: string) => Promise<OpenCodeStatus>;
  /** `buildRoutes` and `validateGateway`, handed in so this file stays JSX only. */
  buildRoutes: (kind: string, values: Record<string, string>) => Partial<Record<AgentSdk, unknown>>;
  validate: (
    kind: string,
    values: Record<string, string>,
  ) => Array<{ key: string; message: string }>;
  onClose: () => void;
}

/**
 * The bounds main enforces, restated here so the panel can draw them.
 *
 * They are not the authority — `ipc.ts` holds that, and a check ends there
 * whatever this file believes. These exist so the bar has a scale, and a
 * disagreement shows up as a bar that fills early rather than as a hang.
 */
const VERIFY_LIMIT_SECONDS = 30;
const TEST_LIMIT_SECONDS = 60;

/** What a check is about: a stored row, or the answers that would build one. */
export type GatewayCheckTarget =
  | { gatewayId: string }
  | { kind: GatewayKind; values: Record<string, string> };

/**
 * The one IPC failure that is not about gateways at all.
 *
 * `npm run dev` builds the main process ONCE and then only hot-reloads the
 * renderer, so a window can end up holding a new sheet and an old handler. This
 * sheet sends its own answers where the previous build expected a saved id, and
 * the previous build answers `No such gateway: undefined` — a sentence about
 * gateways that has nothing to do with the gateway on screen, and which cost
 * three rounds of debugging on 2026-09-04.
 *
 * The current build cannot produce it: that branch only runs when an id is
 * present, so an `undefined` in it can only have come from a REX whose halves
 * are out of step. Recognising it is the only place that can be said, because
 * the process that would know is the stale one.
 */
function staleMain(detail: string): string {
  if (!/No such gateway: undefined/.test(detail)) return detail;
  return (
    "This REX's main process is older than its window. `npm run dev` builds main once " +
    "and hot-reloads only the renderer, so restart it — nothing here is wrong."
  );
}

/** One model per line, blank lines dropped. The mirror of `parseModels` in main. */
function splitModels(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** One row being edited: the answers to the kind's fields, plus the routes. */
interface Editing {
  id?: string;
  name: string;
  kind: GatewayKind;
  values: Record<string, string>;
  routes: Partial<Record<AgentSdk, GatewayRouteDraft>>;
  /**
   * §4.3 — the models this route offers, as the reviewer typed them.
   *
   * Kept as raw text, one per line, and split only on the way out. A list that
   * round-tripped through an array on every keystroke would drop the blank line
   * the reviewer is in the middle of typing.
   *
   * They matter more than they look: **a gateway routes on the model name**, so
   * an empty list means the Test below has nothing to ask for and every send
   * later falls back to whatever the probe found, which is the account's own
   * Claude models and not this gateway's.
   */
  models: Partial<Record<AgentSdk, string>>;
  /**
   * §4.5 — whether the fields on screen actually describe the saved routes.
   *
   * False when a route was edited by hand, and then the fields are blank and the
   * stored routes are shown as they are. Typing turns `touched` on, and only
   * then is anything rebuilt.
   */
  recovered?: boolean;
  touched?: boolean;
}

function blank(descriptor: Descriptor): Editing {
  const kind = descriptor.kinds.find((entry) => entry.id !== "original") ?? descriptor.kinds[0];
  return {
    name: "",
    kind: kind?.id ?? "custom",
    // §4.5 — a field's own default is what the form starts on, so a reviewer
    // who types one host gets Envoy's `/anthropic` without having to know it.
    values: Object.fromEntries(
      (kind?.fields ?? []).map((field) => [field.key, field.default ?? ""]),
    ),
    routes: {},
    models: {},
    recovered: true,
    touched: true,
  };
}

/**
 * An existing gateway, opened for editing.
 *
 * §4.5 — the routes are what was saved, and `recoverValues` runs the templates
 * backwards to get the HOST back so it can be edited. It returns null for a
 * route somebody retyped by hand, and then there is nothing honest to put in the
 * fields: the routes stay as stored, and `touched` below is what decides whether
 * anything is ever rebuilt from them. Reopening and pressing Save changes
 * nothing at all.
 */
function editingOf(view: GatewayView): Editing {
  return {
    id: view.gateway.id,
    name: view.gateway.name,
    kind: view.gateway.kind,
    values: recoverValues(view.gateway.kind, view.gateway.routes) ?? {},
    recovered: recoverValues(view.gateway.kind, view.gateway.routes) !== null,
    touched: false,
    routes: { ...view.gateway.routes },
    models: Object.fromEntries(
      Object.entries(view.gateway.routes).map(([sdk, route]) => [
        sdk,
        (route?.models ?? []).join("\n"),
      ]),
    ),
  };
}

/**
 * Spec 43 §4.5 — one check, and the four things it can be.
 *
 * `idle` is drawn too, and that is deliberate: a row that appears only after a
 * result leaves the reviewer nothing to watch while they wait and no sign the
 * check exists. What it says while running is the elapsed time AND the bound,
 * because "12s" answers a different question from "12s of 60".
 */
function CheckRow({
  name,
  what,
  state,
  said,
  waited,
  limit,
}: {
  name: string;
  /** What this check does, shown until it has an answer of its own. */
  what: string;
  state: "idle" | "running" | "ok" | "warn" | "bad";
  said: string | null;
  waited: number;
  limit: number;
}): React.JSX.Element {
  const share = Math.min(1, waited / limit);
  return (
    <div className={`rex-check rex-check-${state}`}>
      <span className="rex-check-dot" />
      <span className="rex-check-name">{name}</span>
      {state === "running" ? (
        <span className="rex-check-said">Checking…</span>
      ) : (
        <span className="rex-check-said">{said ?? what}</span>
      )}
      {state === "running" ? (
        <span className="rex-check-clock">
          <span className="rex-check-bar">
            <span
              className={share > 0.5 ? "rex-check-fill rex-check-fill-late" : "rex-check-fill"}
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </span>
          {waited}s of {limit}
        </span>
      ) : null}
    </div>
  );
}

export function ManageGateways(props: Props): React.JSX.Element {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [verified, setVerified] = useState<VerifyResult | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Spec 44 §2 — which agent's route Verify and Test are about.
   *
   * Null until the reviewer picks one, and then it is resolved against the
   * routes this gateway actually has: a pick that survived from a gateway with
   * a Codex route to one without would check a route that is not there.
   */
  const [sdkPick, setSdkPick] = useState<AgentSdk | null>(null);
  /**
   * Seconds since the running check began, or null.
   *
   * §7.3's lesson, applied to a button: a control that says "Testing…" and
   * nothing else is indistinguishable from a hung app after the first few
   * seconds, and a local model can genuinely need tens of them.
   */
  const [waited, setWaited] = useState<number | null>(null);

  useEffect(() => {
    if (busy === null) {
      setWaited(null);
      return;
    }
    const since = Date.now();
    setWaited(0);
    const tick = setInterval(() => setWaited(Math.round((Date.now() - since) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [busy]);
  const [envSet, setEnvSet] = useState<Record<string, boolean>>({});
  /**
   * Spec 47 §2.1 — the detected `opencode`, and what the reviewer typed.
   *
   * Two pieces of state and not one: `openCode` is what main resolved and
   * `executableDraft` is the field being typed into. Binding the field to the
   * resolved value would rewrite what a reviewer was half way through typing
   * every time the answer came back.
   */
  const [openCode, setOpenCode] = useState<OpenCodeStatus | null>(null);
  const [executableDraft, setExecutableDraft] = useState<string | null>(null);

  const kind = useMemo(
    () => props.descriptor.kinds.find((entry) => entry.id === editing?.kind),
    [props.descriptor, editing?.kind],
  );

  /** §4.5 — the preview, computed here from the catalogue with no round trip. */
  const preview = useMemo((): Partial<Record<AgentSdk, GatewayRouteDraft>> => {
    if (!editing) return {};
    // A gateway opened for editing keeps the routes it was saved with; a new one
    // is previewed from its answers, live, as the reviewer types.
    // A saved gateway shows what it stored until the reviewer changes a field.
    // Then the answers on screen are the truth and the routes follow them —
    // which is the whole reason the fields are editable at all.
    const base =
      editing.id && !editing.touched
        ? editing.routes
        : (props.buildRoutes(editing.kind, editing.values) as Partial<
            Record<AgentSdk, GatewayRouteDraft>
          >);
    // The typed model list is the reviewer's, whichever way the route was built.
    const merged: Partial<Record<AgentSdk, GatewayRouteDraft>> = {};
    for (const [sdk, route] of Object.entries(base)) {
      if (!route) continue;
      const typed = editing.models[sdk as AgentSdk];
      merged[sdk as AgentSdk] =
        typed === undefined ? route : { ...route, models: splitModels(typed) };
    }
    return merged;
  }, [editing, props.buildRoutes]);

  /**
   * Spec 44 §2 — the route Verify and Test ask about.
   *
   * The first built agent this gateway actually offers, until the reviewer
   * picks another. Not a fixed `claude-agent`: a gateway configured only for
   * Codex would otherwise verify a route it does not have.
   */
  const checkable = SDK_ORDER.filter((id) => props.built.includes(id) && preview[id]);
  const checkSdk =
    sdkPick !== null && checkable.includes(sdkPick) ? sdkPick : (checkable[0] ?? "claude-agent");

  /** The model a Test asks for: the first one configured, or the SDK's default. */
  const testModel = preview[checkSdk]?.models?.[0] ?? null;

  const errors = useMemo(
    () =>
      editing && (!editing.id || editing.touched)
        ? props.validate(editing.kind, editing.values)
        : [],
    [editing, props.validate],
  );

  // §4.5 — the renderer may ask whether a named variable EXISTS. Main answers
  // true or false and never sends the value, which is the whole of §2.6 rule 4
  // as it reaches this screen.
  useEffect(() => {
    const names = new Set<string>();
    for (const route of Object.values(preview)) {
      if (route?.credentialEnv) names.add(route.credentialEnv);
    }
    for (const name of names) {
      if (name in envSet) continue;
      void props.onHasEnv(name).then((has) => setEnvSet((was) => ({ ...was, [name]: has })));
    }
  }, [preview, envSet, props.onHasEnv]);

  /**
   * §2.1 — the row appears when this gateway has an OpenCode route, and asks
   * main for the program only then.
   *
   * Every gateway kind has an `opencode` route in its template, so the question
   * is whether THIS gateway offers one — a `custom`-shaped gateway with only a
   * Claude URL filled in does not, and a row about a program it will never run
   * is a row that teaches the reviewer to ignore rows.
   */
  const showsOpenCode = editing !== null && preview.opencode !== undefined;

  useEffect(() => {
    if (!showsOpenCode || openCode !== null) return;
    void props.onOpenCodeStatus().then(setOpenCode);
  }, [showsOpenCode, openCode, props.onOpenCodeStatus]);

  const saveExecutable = async (): Promise<void> => {
    if (executableDraft === null) return;
    setBusy("opencode");
    try {
      setOpenCode(await props.onOpenCodeExecutable(executableDraft));
      setExecutableDraft(null);
    } finally {
      setBusy(null);
    }
  };

  const closeEditor = (): void => {
    setEditing(null);
    setVerified(null);
    setTested(null);
    setExecutableDraft(null);
  };

  /**
   * Verify or Test, on whatever is on screen.
   *
   * One function because the two differ only in which question they ask: both
   * need the same target, both are the reviewer asking "does this work", and
   * both must leave the form exactly as they found it.
   */
  const check = async (which: "verify" | "test"): Promise<void> => {
    if (!editing) return;
    const target = editing.id
      ? { gatewayId: editing.id }
      : { kind: editing.kind, values: editing.values };
    setBusy(which);
    // Only the row being run is cleared. They are two questions with two
    // answers now, and wiping the Test result because somebody pressed Verify
    // threw away the one that costs a turn to get back.
    if (which === "verify") setVerified(null);
    else setTested(null);
    try {
      if (which === "verify") setVerified(await props.onVerify(target, checkSdk));
      else setTested(await props.onTest(target, checkSdk, testModel));
    } catch (error) {
      const detail = staleMain(error instanceof Error ? error.message : String(error));
      if (which === "verify") {
        setVerified({
          ok: false,
          baseUrl: "",
          expected: null,
          document: null,
          published: [],
          status: null,
          note: detail,
        });
      } else setTested({ ok: false, detail });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Does the gateway being edited already have a stored key?
   *
   * Read from the list rather than passed in: `GatewayView.hasKey` is the
   * boolean main already sends, and §12's rule is that the renderer may learn
   * THAT a key exists and never what it is.
   */
  const editingHasKey =
    props.list.gateways.find((view) => view.gateway.id === editing?.id)?.hasKey === true;

  const save = async (): Promise<void> => {
    if (!editing) return;
    setBusy("save");
    try {
      await props.onSave({
        id: editing.id,
        name: editing.name.trim(),
        kind: editing.kind,
        routes: preview,
        // Spec 46 §7 — the key travels ONE way, and only when it was typed.
        // `undefined` leaves a stored key alone, which is what a rename must
        // do; a string replaces it. There is no third case here, because the
        // screen offers no "remove the key" that is not "remove the gateway".
        key: editing.values.key?.trim() ? editing.values.key.trim() : undefined,
      });
      closeEditor();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rex-modal" role="dialog" aria-modal="true" aria-label="Manage gateways">
      <div className="rex-dialog">
        <header className="rex-dialog-head">
          <div className="rex-dialog-title">
            <h2>Gateways</h2>
            <p>
              Where REX asks for inference. Every comment picks one, and every answer records the
              one that produced it.
            </p>
          </div>
        </header>

        <div className="rex-dialog-body">
          {editing === null ? (
            <>
              {props.list.gateways.map((view) => {
                const locked = view.gateway.id === ORIGINAL_GATEWAY_ID;
                return (
                  <div key={view.gateway.id} className="rex-gateway-row">
                    <div className="rex-gateway-name">
                      {view.gateway.name}
                      {props.list.defaults.gatewayId === view.gateway.id ? (
                        <span className="rex-gateway-tag">default</span>
                      ) : null}
                    </div>
                    <div className="rex-gateway-routes">
                      {props.built.map((sdk) => {
                        const route = view.gateway.routes[sdk];
                        return (
                          <div key={sdk} className="rex-gateway-route">
                            <span className="rex-gateway-sdk">
                              {props.descriptor.sdks.find((one) => one.id === sdk)?.label ?? sdk}
                            </span>
                            <span className="rex-gateway-url">
                              {route
                                ? (route.baseUrl ?? "the SDK's own endpoint")
                                : "no route for this agent"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="rex-gateway-acts">
                      <button
                        type="button"
                        className="rex-button"
                        disabled={locked}
                        title={
                          locked
                            ? "Original is what REX does with no gateway at all, so it cannot be edited."
                            : `Edit ${view.gateway.name}`
                        }
                        onClick={() => setEditing(editingOf(view))}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rex-button"
                        disabled={props.list.defaults.gatewayId === view.gateway.id}
                        title="New comments start on this gateway. Changing a control does not."
                        onClick={() => void props.onDefault(view.gateway.id)}
                      >
                        Use as default
                      </button>
                      <button
                        type="button"
                        className="rex-button rex-button-write"
                        disabled={locked}
                        title={
                          locked
                            ? "Original cannot be deleted."
                            : "Remove this gateway. Every answer it produced keeps its own record."
                        }
                        onClick={() => void props.onDelete(view.gateway.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className="rex-button rex-primary"
                onClick={() => setEditing(blank(props.descriptor))}
              >
                Add a gateway
              </button>
            </>
          ) : (
            <>
              <label className="rex-field">
                <span className="rex-label">NAME</span>
                <input
                  className="rex-field-input"
                  value={editing.name}
                  placeholder="LiteLLM"
                  onChange={(event) => setEditing({ ...editing, name: event.currentTarget.value })}
                />
              </label>

              <label className="rex-field">
                <span className="rex-label">KIND</span>
                <select
                  className="rex-field-input"
                  value={editing.kind}
                  disabled={editing.id !== undefined}
                  onChange={(event) => {
                    const next = event.currentTarget.value as GatewayKind;
                    const chosen = props.descriptor.kinds.find((entry) => entry.id === next);
                    setEditing({
                      ...editing,
                      kind: next,
                      values: Object.fromEntries(
                        (chosen?.fields ?? []).map((field) => [field.key, field.default ?? ""]),
                      ),
                    });
                    setVerified(null);
                    setTested(null);
                  }}
                >
                  {props.descriptor.kinds
                    .filter((entry) => entry.id !== "original")
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                </select>
              </label>

              {/*
                §2.3 — a kind that has not been measured against a live server
                says so, here, where the reviewer is deciding to trust it.
              */}
              {kind?.unverified ? (
                <p className="rex-gateway-unverified">{kind.unverified}</p>
              ) : null}

              {/*
                §4.5 — the fields are drawn for a SAVED gateway too. They were
                hidden, on the reasoning that a saved row stores routes rather
                than the answers behind them — which was true and left the
                reviewer unable to change the address at all. `recoverValues`
                runs the templates backwards, so there is something honest to
                put in them.
              */}
              {(kind?.fields ?? []).map((field) => {
                const problem = errors.find((error) => error.key === field.key);
                return (
                  <label key={field.key} className="rex-field">
                    <span className="rex-label">
                      {field.label.toUpperCase()}
                      {/*
                        Spec 46 §8 rule 4 — the screen never shows a key back,
                        not even masked-with-a-reveal. So a saved gateway's key
                        field is EMPTY with a note saying one is stored, and
                        typing replaces it. An empty box on a gateway that has a
                        key would otherwise read as "no key", which is why the
                        note is not optional.
                      */}
                      {field.kind === "password" && editingHasKey ? (
                        <span className="rex-gateway-tag">stored</span>
                      ) : null}
                    </span>
                    <input
                      className="rex-field-input"
                      type={field.kind === "password" ? "password" : "text"}
                      autoComplete={field.kind === "password" ? "new-password" : undefined}
                      value={editing.values[field.key] ?? ""}
                      placeholder={
                        field.kind === "password" && editingHasKey
                          ? "A key is stored. Type to replace it."
                          : (field.placeholder ?? "")
                      }
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          // Typing is what makes the fields authoritative.
                          // Until then a saved gateway shows what it stored.
                          touched: true,
                          values: {
                            ...editing.values,
                            [field.key]: event.currentTarget.value,
                          },
                        })
                      }
                    />
                    {field.help ? <span className="rex-meta">{field.help}</span> : null}
                    {problem ? <span className="rex-field-error">{problem.message}</span> : null}
                  </label>
                );
              })}

              {/*
                The one case where the fields cannot describe what is stored: a
                route somebody retyped. Saying so beats either lying about the
                host or hiding the fields again.
              */}
              {editing.id && editing.recovered === false ? (
                <p className="rex-gateway-unverified">
                  These routes were edited by hand, so no single host describes them. The addresses
                  below are what is stored. Fill in the fields to rebuild them from the kind instead
                  — that will replace every route.
                </p>
              ) : null}

              <div className="rex-gateway-preview">
                <span className="rex-label">REX WILL USE</span>
                {/*
                  §4.5 — a row per SDK the KIND names, not per SDK REX has built.
                  Rows for the three with no adapter yet are drawn greyed, with
                  the note that names the spec that will fill them: the reviewer
                  sees the shape and cannot save a route nothing can run.
                  Listing only the built one would make work that is scheduled
                  look like work nobody thought of.
                */}
                {SDK_ORDER.map((id) => {
                  const route = preview[id];
                  const unbuilt = !props.built.includes(id);
                  const note = kind?.routes[id];
                  if (!note) return null;
                  const label =
                    props.descriptor.sdks.find((sdk) => sdk.id === id)?.label ?? SDK_LABELS[id];
                  return (
                    <div
                      key={id}
                      className={
                        unbuilt ? "rex-gateway-route rex-gateway-later" : "rex-gateway-route"
                      }
                    >
                      {/*
                        Three cells and then the note underneath. The address is
                        what a reviewer came here to read, so it gets the row's
                        width and never wraps; the note is prose and wraps below
                        it. See `.rex-gateway-route`.
                      */}
                      <span className="rex-gateway-sdk">{label}</span>
                      <span className="rex-gateway-url">
                        {route?.baseUrl ?? (route ? "the SDK's own endpoint" : "—")}
                      </span>
                      <span className="rex-gateway-cred">
                        {route?.credentialEnv
                          ? `${route.credentialEnv}${
                              envSet[route.credentialEnv] === undefined
                                ? ""
                                : envSet[route.credentialEnv]
                                  ? " ✓ set"
                                  : " — NOT SET"
                            }`
                          : ""}
                      </span>
                      <span className="rex-gateway-note">{note?.note ?? ""}</span>
                    </div>
                  );
                })}
              </div>

              {/*
                §4.3 — the models this gateway offers, typed by the person who
                configured it, because a gateway's catalogue is its own business:
                LiteLLM's aliases are one edit per engine in a YAML file REX has
                never read, and no probe against the Claude CLI can know a new
                one exists.

                It is also what makes Test mean anything. A gateway ROUTES on the
                model name, so an empty list leaves the test turn asking for
                whatever the CLI would have asked for, and a working gateway
                answers 404.
              */}
              {/*
                Spec 44 §2 — one list per agent, because a gateway routes on the
                model name and the two agents reach different backends through
                it. LiteLLM's `-anthropic` aliases exist for the Claude route
                and mean nothing to the Codex one.
              */}
              {checkable.map((id) => (
                <label className="rex-field" key={id}>
                  <span className="rex-label">
                    {checkable.length > 1
                      ? `MODELS FOR ${(props.descriptor.sdks.find((sdk) => sdk.id === id)?.label ?? SDK_LABELS[id]).toUpperCase()} — one per line`
                      : "MODELS — one per line"}
                  </span>
                  <textarea
                    className="rex-field-area"
                    value={editing.models[id] ?? ""}
                    placeholder={
                      id === "claude-agent"
                        ? "lms-26b-anthropic\nlms-4b-anthropic"
                        : "lms-26b\nlms-4b"
                    }
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        models: { ...editing.models, [id]: event.currentTarget.value },
                      })
                    }
                  />
                  <span className="rex-meta">
                    The names this gateway answers to, not REX's. The first one is what Test asks
                    for.
                  </span>
                </label>
              ))}

              {/*
                Spec 47 §2.1 — the OpenCode server program.

                **App-wide, and deliberately not part of this gateway**, which
                is why it sits below the routes rather than among them: every
                OpenCode route must use the same server version, and a
                per-gateway override would let two gateways disagree about which
                program REX is talking to. It appears here because here is where
                a reviewer finds out they need one.

                No package contains it, so REX reports what it found and links
                nothing it would have to install — §2.1 is explicit that REX does
                not install software during a run.
              */}
              {showsOpenCode ? (
                <label className="rex-field">
                  <span className="rex-label">OPENCODE EXECUTABLE</span>
                  <input
                    className="rex-field-input"
                    type="text"
                    value={executableDraft ?? openCode?.override ?? ""}
                    placeholder="Auto-detect"
                    spellCheck={false}
                    onChange={(event) => setExecutableDraft(event.currentTarget.value)}
                    onBlur={() => void saveExecutable()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveExecutable();
                    }}
                  />
                  <span className="rex-meta">
                    {busy === "opencode"
                      ? "Looking…"
                      : (openCode?.problem ??
                        (openCode
                          ? `${openCode.version ?? "found"} · ${openCode.path ?? ""}${
                              openCode.source === "override" ? "" : " (auto-detected)"
                            }`
                          : "Looking…"))}
                  </span>
                </label>
              ) : null}

              {/*
                RED MEANS "THIS DOES NOT WORK", and `ok` is not that question.
                `ok` is "the server published a document naming this exact path",
                and §2.4 is explicit that a server publishing nothing is not a
                failure — so painting that note red said the opposite of what it
                says in words. Reported 2026-09-04.

                The one thing that is red is an address nothing answered on:
                `status` is null only when no request completed at all.
              */}
              {/*
                The answers, in a place of their own. See `.rex-checks`: a
                `ready` in the body text is a word among fifty, and a reviewer
                who pressed a button on purpose is owed somewhere to look.
              */}
              <div className="rex-checks">
                <CheckRow
                  name="VERIFY"
                  what="Ask the server what it publishes. Spends nothing."
                  state={
                    busy === "verify"
                      ? "running"
                      : verified === null
                        ? "idle"
                        : verified.ok
                          ? "ok"
                          : // §2.4 — "publishes nothing" is a result, not a
                            // failure, so it is amber rather than red. Only an
                            // address that answered nothing at all is red.
                            verified.status === null
                            ? "bad"
                            : "warn"
                  }
                  said={verified?.note ?? null}
                  waited={busy === "verify" ? (waited ?? 0) : 0}
                  limit={VERIFY_LIMIT_SECONDS}
                />
                <CheckRow
                  name="TEST"
                  what="Run one real turn. On a paid gateway it costs one."
                  state={
                    busy === "test"
                      ? "running"
                      : tested === null
                        ? "idle"
                        : tested.ok
                          ? "ok"
                          : "bad"
                  }
                  said={tested === null ? null : tested.ok ? `${tested.detail} ✓` : tested.detail}
                  waited={busy === "test" ? (waited ?? 0) : 0}
                  limit={TEST_LIMIT_SECONDS}
                />
              </div>
            </>
          )}
        </div>

        <footer className="rex-dialog-foot">
          {editing === null ? (
            <button type="button" className="rex-button" onClick={props.onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className="rex-button" onClick={closeEditor}>
                Cancel
              </button>
              {/*
                Neither of these needs the gateway saved first, and that was the
                whole complaint: a check you can only run on a row you have
                already committed to answers the wrong question. Main rebuilds
                the route from the kind and these answers, with the same
                catalogue the preview above used.

                THE TWO ARE DIFFERENT QUESTIONS and the tooltips have to say so:
                Verify asks the SERVER what it publishes and spends nothing;
                Test runs one real turn and can cost money.
              */}
              {/*
                Spec 44 §2 — WHICH route the two checks are about. Drawn only
                when there is more than one, for the reason the composer's agent
                control is: a picker with one row is a control that decides
                nothing.
              */}
              {checkable.length > 1 ? (
                <label className="rex-dialog-foot-pick">
                  <span className="rex-label">CHECK</span>
                  <select
                    className="rex-field-input"
                    value={checkSdk}
                    disabled={busy !== null}
                    onChange={(event) => setSdkPick(event.currentTarget.value as AgentSdk)}
                  >
                    {checkable.map((id) => (
                      <option key={id} value={id}>
                        {props.descriptor.sdks.find((sdk) => sdk.id === id)?.label ??
                          SDK_LABELS[id]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                className="rex-button"
                disabled={busy !== null || errors.length > 0}
                title={
                  "CHECK THE ADDRESS. Asks this server what paths it publishes and says whether " +
                  "the one this route needs is among them. Sends no prompt, spends nothing, and " +
                  "changes no route. A server that publishes no description is not a failure."
                }
                onClick={() => void check("verify")}
              >
                Verify
              </button>
              <button
                type="button"
                className="rex-button"
                disabled={busy !== null || errors.length > 0}
                title={
                  "CHECK THE WHOLE THING. Runs one short, read-only turn through the real agent, " +
                  `asking for ${testModel ?? "the SDK's own default model"}. It is the only check ` +
                  "that proves a model will actually answer — and on a paid gateway it costs one turn."
                }
                onClick={() => void check("test")}
              >
                Test
              </button>
              <button
                type="button"
                className="rex-button rex-primary"
                disabled={busy !== null || editing.name.trim().length === 0 || errors.length > 0}
                onClick={() => void save()}
              >
                Save
              </button>
            </>
          )}
          <span className="rex-dialog-foot-note">
            A gateway stores the NAME of a credential variable, never its value.
          </span>
        </footer>
      </div>
    </div>
  );
}
