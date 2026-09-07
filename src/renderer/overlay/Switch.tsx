// The on/off switch. Not a checkbox.
//
// A checkbox means "tick this to agree" — it is for choosing several out of a
// list, where nothing happens until you save. A switch means "this is running,
// or it is not", and flipping it acts NOW. REX's settings hold both, and the
// first version of the Settings sheet used a checkbox for the gateway, which
// read as a consent tick rather than a power switch.
//
// **The knob's position IS the state.** The word beside it only confirms it —
// which is why the two can never disagree here, unlike a checkbox with a label
// that says "off" while the box is ticked.
//
// It is the one control in REX with a pill radius. Everything else is 2px, and
// that is deliberate: a switch that is not pill-shaped is not read as a switch.
//
// A real `<button role="switch">`, not a styled `<input type="checkbox">`:
// `aria-checked` is what a screen reader needs, Space and Enter come free, and
// there is no native box to fight for the appearance.

interface Props {
  on: boolean;
  disabled?: boolean;
  /** What this switch turns on. Read out instead of the visible word. */
  label: string;
  /**
   * §4.3 — a change can wait for an in-flight run before it takes effect.
   *
   * The knob sits mid-travel and the switch stops answering. It is a third
   * state and not a disabled one: disabled means "you cannot", and this means
   * "you did, and REX is getting there".
   */
  working?: boolean;
  onChange: (on: boolean) => void;
}

export function Switch(props: Props): React.JSX.Element {
  const state = props.working ? "working" : props.on ? "on" : "off";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      className="rex-switch"
      data-state={state}
      disabled={props.disabled || props.working}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="rex-switch-knob" />
    </button>
  );
}

/**
 * A switch with its word beside it, which is how every row in Settings uses one.
 *
 * The word is `on`/`off` and never the thing being switched — the row's own
 * text says what it is, and repeating it beside the control is the noise that
 * made the first version read as a form.
 */
export function SwitchRow(props: Props & { word?: string }): React.JSX.Element {
  return (
    <span className="rex-switch-row">
      <span className="rex-switch-word">
        {props.working ? "…" : (props.word ?? (props.on ? "on" : "off"))}
      </span>
      <Switch {...props} />
    </span>
  );
}
