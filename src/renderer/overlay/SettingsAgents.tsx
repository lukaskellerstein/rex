// Spec 60 §5 — Settings → Agents: what a new comment starts on, per agent.
//
// The reviewer's ask of 2026-10-17: *"If you want to have some configuration
// where a user can set it up, what is the default one? It would make sense to
// me."* Before this page the one writer was *Use as default*, three clicks deep
// in the gateway sheet, and it set one model for every agent.
//
// The same two menus the send row draws, so a default is chosen exactly the way
// a send is, and reads back the same way.

import type { AgentSdk } from "../../shared/agent-protocol.ts";
import type { AgentChoices } from "../../shared/types.ts";
import { EffortPick } from "./EffortPick.tsx";
import { ModelPick } from "./ModelPick.tsx";

interface Props {
  /** The agents that actually have an adapter. */
  agents: ReadonlyArray<{ id: AgentSdk; label: string }>;
  /** One agent's list on the gateway a new comment starts on, and its defaults. */
  choicesFor: (sdk: AgentSdk) => AgentChoices;
  /** That gateway's name, because the lists are its. */
  gatewayName: string;
  /** Null leaves that field as it is (spec 60 §5). */
  onPick: (sdk: AgentSdk, choice: { model: string | null; effort: string | null }) => void;
}

export function SettingsAgents(props: Props): React.JSX.Element {
  return (
    <section className="rex-set-card">
      <div className="rex-set-head">
        <div className="rex-set-name">
          <strong>New comments</strong>
          <span className="rex-set-dim">
            A new comment starts on these, through {props.gatewayName}. A comment already sent keeps
            its own.
          </span>
        </div>
      </div>
      <ul className="rex-set-rows">
        {props.agents.map((agent) => {
          const choices = props.choicesFor(agent.id);
          return (
            <li key={agent.id} className="rex-set-row rex-set-row-act">
              <span className="rex-set-row-name">{agent.label}</span>
              <span className="rex-set-picks">
                <ModelPick
                  models={choices.models}
                  value={choices.chosen}
                  fallback={choices.chosen}
                  // No `Default (…)` row: this row IS the default.
                  allowDefault={false}
                  disabled={
                    choices.models.length === 0
                      ? `${props.gatewayName} lists no models for ${agent.label}.`
                      : null
                  }
                  error={choices.error}
                  onPick={(model) => {
                    if (model !== null) props.onPick(agent.id, { model, effort: null });
                  }}
                />
                <EffortPick
                  models={choices}
                  model={choices.chosen}
                  effort={choices.effort}
                  note={false}
                  onEffort={(effort) => props.onPick(agent.id, { model: null, effort })}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
