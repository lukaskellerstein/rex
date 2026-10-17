// Spec 58 §7.1 — the effort control, between the model and the style.
//
// One component for the two rows that draw it, the comment card's composer and
// the selection panel, because what it shows is a function of the model beside
// it and the two rows must not disagree about that function.

import { type AgentChoices, DEFAULT_EFFORT } from "../../shared/types.ts";
import { ModelPick } from "./ModelPick.tsx";
import {
  effortFor,
  effortLevelsOf,
  effortName,
  effortRows,
  modelLabel,
  ownEffortOf,
} from "./modelChoices.ts";

interface Props {
  /** The model list of the route this send goes through. */
  models: AgentChoices;
  /** The model pick, or null for the default it follows — as `ModelPick` takes it. */
  model: string | null;
  /** The reviewer's level, before §6.2 checks it against the model. */
  effort: string;
  /** NOTE mode — the control is drawn dim, like every control in the row. */
  note: boolean;
  onEffort: (effort: string) => void;
}

export function EffortPick(props: Props): React.JSX.Element | null {
  // §3.2 — a route whose models carry no levels at all is a gateway with a URL,
  // or an agent with no such knob. Nothing to choose, so nothing is drawn.
  if (!props.models.models.some((row) => (row.effortLevels?.length ?? 0) > 0)) return null;

  const model = props.model ?? props.models.chosen;
  const levels = effortLevelsOf(props.models.models, model);
  const sent = effortFor(levels, props.effort);
  const name = modelLabel(props.models.models, model, model);
  const own = ownEffortOf(props.models.models, model);
  const rows = effortRows(levels, own);
  const picked = effortName(props.effort);
  const ownWords = own ? `, ${effortName(own)}` : "";

  return (
    <ModelPick
      models={rows}
      value={sent ?? DEFAULT_EFFORT}
      fallback={DEFAULT_EFFORT}
      allowDefault={false}
      disabled={
        props.note
          ? "A note runs nothing, so it thinks at no level."
          : sent === null
            ? `${name} takes no effort level.`
            : null
      }
      // §6.2 — the pick is kept, so it comes back on a model that takes it; this
      // send uses the model's own level, and the menu says why.
      error={
        sent !== null && sent !== props.effort
          ? `${name} does not take ${picked}, so this send uses the model's own level${ownWords}.`
          : null
      }
      onPick={(value) => {
        if (value !== null) props.onEffort(value);
      }}
    />
  );
}
