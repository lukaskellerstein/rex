// Spec 46 §8 — Settings, as a PAGE.
//
// It was a modal sheet, and that was wrong in three ways the reviewer named on
// 2026-09-06: a dialog is for one decision and then dismissal, not for a place
// you go to set things up; a tab strip runs out of width where a sidebar does
// not; and a `Close` text button in the middle of a bar is not where a hand
// goes to leave. So this fills the window, has a sidebar, and closes with an ×
// in the corner.
//
// **It is not modal**: no backdrop, no `aria-modal`, no centred box. It is a
// view that covers the shell, the way a document does — which is what makes
// "different sections in the future" a sidebar row rather than a redesign.
//
// The composer's existing **Manage gateways…** item and the top bar's gear both
// open it, so the gesture people already have keeps working.

import { useCallback, useEffect, useState } from "react";
import type { AgentSdk } from "../../shared/agent-protocol.ts";
import type {
  BuiltinState,
  GatewayDiscovery,
  GatewayProviderDraft,
  GatewayProviderView,
  GatewayStorageHealth,
  GatewayTrafficSize,
  GatewayView,
  ProviderDescriptor,
} from "../../shared/channels.ts";
import { Cog, Cross, Layers, Plus } from "./Icons.tsx";
import { builtinSummary, SECTIONS, type SettingsTab, sizeLabel } from "./providers.ts";
import { SettingsModels } from "./SettingsModels.tsx";
import { SwitchRow } from "./Switch.tsx";

/** The one gateway REX runs itself. Mirrors `BUILTIN_GATEWAY_ID` in main. */
export const BUILTIN_GATEWAY_ID = "rex-builtin";
export const ORIGINAL_GATEWAY_ID = "rex-original";

interface Props {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  gateways: readonly GatewayView[];
  builtin: BuiltinState | null;
  catalogue: readonly ProviderDescriptor[];
  providers: readonly GatewayProviderView[];
  health: GatewayStorageHealth | null;
  traffic: GatewayTrafficSize | null;
  busy: boolean;
  /** The agents that actually have an adapter, for the Original row. */
  agents: ReadonlyArray<{ id: AgentSdk; label: string }>;
  /** §4.1 — flips the switch and starts or stops the child. Deletes nothing. */
  onEnable: (enabled: boolean) => Promise<void>;
  onProviderSave: (draft: GatewayProviderDraft) => Promise<void>;
  onProviderRemove: (providerId: string) => Promise<void>;
  onDiscover: (providerId: string) => Promise<GatewayDiscovery>;
  onModels: (
    providerId: string,
    models: Array<{ model: string; context: number | null; tools: boolean | null }>,
  ) => Promise<void>;
  onSecret: (providerId: string, value: string) => Promise<void>;
  onSecretClear: (providerId: string) => Promise<void>;
  onBodies: (capture: boolean) => Promise<void>;
  onClearTraffic: () => Promise<void>;
  /** Opens the older sheet, for an external LiteLLM. */
  onManageExternal: () => void;
  onClose: () => void;
}

export function Settings(props: Props): React.JSX.Element {
  // Escape leaves, the way it leaves every other full view in REX.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  const section = SECTIONS.find((entry) => entry.id === props.tab);

  return (
    <div className="rex-page" aria-label="Settings">
      <header className="rex-page-head">
        <h1>Settings</h1>
        <span className="rex-page-crumb">{section?.label}</span>
        <span className="rex-spacer" />
        <button
          type="button"
          className="rex-icon-button"
          data-tip="Close settings — esc"
          aria-label="Close settings"
          onClick={props.onClose}
        >
          <Cross />
        </button>
      </header>

      <div className="rex-page-body">
        {/*
          A LIST, not a tab strip. A seventh section is a row; a seventh tab is
          a width problem — which is the whole reason the reviewer asked for
          "room for future sections".
        */}
        <nav className="rex-page-nav" aria-label="Settings sections">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={
                props.tab === entry.id ? "rex-set-nav-row rex-set-nav-row-on" : "rex-set-nav-row"
              }
              aria-current={props.tab === entry.id ? "page" : undefined}
              onClick={() => props.onTab(entry.id)}
            >
              <span className="rex-set-nav-icon">
                {entry.id === "gateways" ? <Cog size={14} /> : <Layers size={14} />}
              </span>
              {entry.label}
            </button>
          ))}
        </nav>

        <main className="rex-page-pane">
          <div className="rex-page-column">
            <div className="rex-page-lede">
              <h2>{section?.label}</h2>
              <p>{section?.blurb}</p>
            </div>

            {props.tab === "gateways" ? (
              <GatewaysSection {...props} />
            ) : (
              <SettingsModels
                catalogue={props.catalogue}
                providers={props.providers}
                health={props.health}
                busy={props.busy}
                onSave={props.onProviderSave}
                onRemove={props.onProviderRemove}
                onDiscover={props.onDiscover}
                onModels={props.onModels}
                onSecret={props.onSecret}
                onSecretClear={props.onSecretClear}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Original, the built-in gateway, and whatever somebody else runs. */
function GatewaysSection(props: Props): React.JSX.Element {
  const builtin = props.builtin;
  const external = props.gateways.filter(
    (view) => view.gateway.id !== ORIGINAL_GATEWAY_ID && view.gateway.id !== BUILTIN_GATEWAY_ID,
  );
  const original = props.gateways.find((view) => view.gateway.id === ORIGINAL_GATEWAY_ID);

  return (
    <>
      {/*
        Spec 46 §15's retired-gateway notice was here, and spec 51 §6 removes
        it: **it has been seen.** It existed to say once that `envoy` and
        `custom` had gone, and a sentence that has done its job is a sentence
        that is only taking up the top of the screen now. The setting it read
        stays, so nothing has to be migrated to take it away.
      */}

      {/*
        Original. **Not Claude's** — spec 43 §2.5 gives every SDK a route here,
        each on its own official endpoint and its own login: `claude login`
        today, the Codex subscription since spec 44, `opencode auth login` in
        spec 47. The first version of this card led with "Your own Claude
        login", which was wrong the day the second adapter landed.

        The per-agent list is what earns the card a place at all: it cannot be
        configured, so the only reason to draw it is to answer the one question
        nothing else in REX answers — which credential is each agent using?
      */}
      <section className="rex-set-card">
        <div className="rex-set-head">
          <div className="rex-set-name">
            <strong>Original — no gateway</strong>
            <span className="rex-set-dim">
              Each agent talks to its own vendor directly, with the login you already have. Nothing
              to configure.
            </span>
          </div>
          <span className="rex-set-tag rex-set-tag-ok">always on</span>
        </div>
        <ul className="rex-set-rows">
          {props.agents.map((agent) => (
            <li key={agent.id} className="rex-set-row">
              <span className="rex-set-row-name">{agent.label}</span>
              <code className="rex-set-mono">
                {original?.gateway.routes[agent.id]
                  ? CREDENTIALS[agent.id]
                  : "no route for this agent"}
              </code>
            </li>
          ))}
        </ul>
      </section>

      {/* The built-in gateway. */}
      <section className="rex-set-card">
        <div className="rex-set-head">
          <div className="rex-set-name">
            <strong>Built-in</strong>
            <span className="rex-set-dim">LiteLLM, running inside REX</span>
          </div>
          <SwitchRow
            label="Run the built-in gateway"
            on={builtin?.enabled === true}
            disabled={props.busy || builtin === null}
            onChange={(on) => void props.onEnable(on)}
          />
        </div>

        {/*
          §4.1 — "enabled means running", and the screen shows the LIVE port,
          which needs a live process. A switch that says "on" while nothing runs
          is a switch that lies, so the two states are drawn apart.
        */}
        <div className="rex-set-body">
          {builtin?.enabled ? (
            builtin.running ? (
              <p className="rex-set-live">
                <span className="rex-set-live-dot" />
                Running on <code>http://127.0.0.1:{builtin.port}</code>
              </p>
            ) : (
              <p className="rex-set-warn">{builtin.down ?? "Starting…"}</p>
            )
          ) : (
            <p className="rex-set-dim">
              Stopped. Nothing you configured is lost — turning it on again uses the same providers,
              models and keys. It costs about 296 MB and 1.6 seconds to start.
            </p>
          )}
        </div>

        {/*
          What it serves. A ROW with a real button, because the first version
          buried "configure them in Models" as a link inside a sentence, after
          a stray middle dot.
        */}
        {builtin ? (
          <div className="rex-set-row rex-set-row-act">
            <span className="rex-set-row-name">
              {builtinSummary(builtin.models, builtin.providers)}
            </span>
            <button type="button" className="rex-button" onClick={() => props.onTab("models")}>
              Manage models
            </button>
          </div>
        ) : null}

        {/*
          §8 rule 5 — the traffic log. Its own row with its own switch, so the
          two switches on this card are the same control at the same size.
        */}
        <div className="rex-set-row rex-set-row-act">
          <div className="rex-set-row-name">
            <div>Record questions and answers</div>
            <div className="rex-set-dim">
              Timings, tokens and cost are always kept. This adds the prompts and replies, in{" "}
              <code>~/.rex/gateway/traffic/</code>, for 30 days.
            </div>
            <div className="rex-set-dim">
              {props.traffic
                ? `${sizeLabel(props.traffic.bytes)} over ${props.traffic.days} day${props.traffic.days === 1 ? "" : "s"}`
                : "—"}{" "}
              <button
                type="button"
                className="rex-link"
                disabled={props.busy}
                onClick={() => void props.onClearTraffic()}
              >
                Clear it
              </button>
            </div>
          </div>
          <SwitchRow
            label="Record questions and answers in the traffic log"
            on={props.traffic?.bodies !== false}
            disabled={props.busy || props.traffic === null}
            onChange={(on) => void props.onBodies(on)}
          />
        </div>
      </section>

      {/* Somebody else's. */}
      <section className="rex-set-card">
        <div className="rex-set-head">
          <div className="rex-set-name">
            <strong>Other gateways</strong>
            <span className="rex-set-dim">A LiteLLM somebody else runs</span>
          </div>
          <button type="button" className="rex-button" onClick={props.onManageExternal}>
            <Plus size={12} />
            {external.length > 0 ? "Manage" : "Add"}
          </button>
        </div>
        {external.length === 0 ? (
          <div className="rex-set-body">
            <p className="rex-set-dim">None yet.</p>
          </div>
        ) : (
          <ul className="rex-set-rows">
            {external.map((view) => (
              <li key={view.gateway.id} className="rex-set-row">
                <span className="rex-set-row-name">{view.gateway.name}</span>
                <code className="rex-set-mono">
                  {view.gateway.routes["claude-agent"]?.baseUrl ?? "no route"}
                </code>
                <span
                  className={
                    view.hasKey ? "rex-set-tag rex-set-tag-ok" : "rex-set-tag rex-set-tag-off"
                  }
                >
                  {view.hasKey ? "key set" : "no key"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * What each agent signs in with, in its own words.
 *
 * REX's own strings, never a server's — the same rule the catalogue keeps. It
 * says which credential, and deliberately NOT whether it is valid: REX does not
 * check, and a status that lies is worse than none. When `verify` learns to
 * answer that, the row has a place for it.
 */
const CREDENTIALS: Record<AgentSdk, string> = {
  "claude-agent": "claude login",
  codex: "your Codex subscription",
  opencode: "opencode auth login",
  "deep-agents": "the provider's own environment",
};

/** The tab a caller should open on, given where they came from. */
export function useSettings(): {
  open: boolean;
  tab: SettingsTab;
  show: (tab?: SettingsTab) => void;
  hide: () => void;
  setTab: (tab: SettingsTab) => void;
} {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("gateways");
  const show = useCallback((next: SettingsTab = "gateways") => {
    setTab(next);
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, tab, show, hide, setTab };
}
