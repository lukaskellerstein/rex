// Spec 25 §7.1 — the model this send will run on, chosen where it is used.
//
// A button and a menu, not a segmented control. Spec 12 §3.1 rejected a
// dropdown for the mode and was right to: three options, all always relevant,
// and the unpicked ones matter. There are five models today and the number is
// not REX's to fix — it comes from the CLI — so the same argument turns over.
// A five-segment control is a toolbar, and the option a reviewer wants is
// named, not positional.
//
// One component for all three surfaces (the reply row, the panel foot, the top
// bar), the way `ModeSwitch` is one component for two. There is one way to
// choose a model in REX.

import { useEffect, useRef, useState } from "react";
import type { ModelChoice } from "../../shared/types.ts";
import { modelLabel, modelRows, styleRows } from "./modelChoices.ts";

// Re-exported so every existing import of these two keeps working — they are
// pure data helpers and live in a `.ts` file the test runner can load.
export { modelLabel, styleRows };

/**
 * The tick column, so every row's text starts at the same x.
 *
 * A figure space rather than two ordinary ones: it is exactly one digit wide in
 * every font, so an unpicked row lines up with a picked one instead of drifting
 * left by a hair on each redraw.
 */
const TICK = "\u2713 ";
const SPACE = "\u2007 ";

interface Props {
  models: ModelChoice[];
  /**
   * The pick, or null for "follow the app-wide default".
   *
   * The two are genuinely different and the menu shows both: a comment set to
   * null moves when the default moves, and one set to `sonnet` does not.
   */
  value: string | null;
  /** §6 — the app-wide default, which is what `value: null` resolves to. */
  fallback: string;
  /**
   * §7.1 — whether the menu offers `Default — …` as a row of its own.
   *
   * On for the model and off for the gateway and the style, which have no
   * app-wide default to follow (spec 31 §7.3). It was also off for the top
   * bar's own picker, which set the default and would have looped; that picker
   * was removed on 2026-09-04.
   */
  allowDefault: boolean;
  /** §2.3 — why the model cannot be chosen here, or null when it can. */
  disabled: string | null;
  /** §3.4 — the probe failed, and this says so. */
  error: string | null;
  onPick: (value: string | null) => void;
  /**
   * Spec 43 §4.2 — why one ROW cannot be chosen, or null when it can.
   *
   * **Impossible combinations are shown, not hidden.** A greyed row with the
   * reason on hover says "this is configuration you have not done"; a row that
   * is simply absent says "REX cannot do this", which is a different and false
   * claim.
   */
  rowDisabled?: (value: string) => string | null;
  /** An action at the foot of the menu — `Manage gateways…`, and nothing else yet. */
  action?: { label: string; title: string; onPick: () => void };
}

export function ModelPick(props: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  /**
   * Which way the menu grows, decided when it opens.
   *
   * Not a constant, because the same component sits at the top of the window
   * and at the bottom of it. Opening downward from the composer put the whole
   * menu below the window's edge — the button worked and appeared to do
   * nothing, which is the worst way for a control to fail. Measured 2026-08-31.
   */
  const [up, setUp] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  /*
    The same close rule the tree's menu follows (`Explorer.tsx`): anything that
    is not choosing from it closes it. `composedPath()` rather than
    `contains()`, because the overlay is inside a shadow root and the event's
    `target` outside it is the host element, not the node that was pressed.
  */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event): void => {
      const inside = hostRef.current && event.composedPath().includes(hostRef.current);
      if (!inside) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const models = modelRows(props.models);
  const label = modelLabel(models, props.value, props.fallback);
  const off = props.disabled !== null;
  const current = models.find((model) => model.value === (props.value ?? props.fallback));

  const title = off
    ? props.disabled
    : (props.error ?? current?.description ?? "The model this send runs on");

  return (
    <div className="rex-modelpick" ref={hostRef}>
      <button
        type="button"
        className={`rex-modelbutton${open ? " rex-modelbutton-open" : ""}`}
        disabled={off}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? undefined}
        onClick={() => {
          // Measured on the press, not on render: the panel is resizable and
          // the composer moves with the length of the conversation above it.
          const box = hostRef.current?.getBoundingClientRect();
          if (box) setUp(box.bottom > window.innerHeight / 2);
          setOpen((was) => !was);
        }}
      >
        <span className="rex-modelcaret">⌄</span>
        {label}
      </button>

      {open ? (
        <div
          className={`rex-menu rex-menu-right rex-modelmenu${up ? " rex-modelmenu-up" : ""}`}
          role="menu"
        >
          {props.error ? <div className="rex-modelnote">{props.error}</div> : null}

          {props.allowDefault ? (
            <button
              type="button"
              className="rex-menu-item"
              // §7.1 — picking "the default" and picking the model it happens
              // to be are different acts, so the row names both.
              title="Follow the app-wide default. This comment moves when that does."
              onClick={() => {
                props.onPick(null);
                setOpen(false);
              }}
            >
              {props.value === null ? TICK : SPACE}
              Default — {modelLabel(models, null, props.fallback)}
            </button>
          ) : null}

          {props.allowDefault && models.length > 0 ? <div className="rex-menu-rule" /> : null}

          {models.map((model) => {
            const blocked = props.rowDisabled?.(model.value) ?? null;
            return (
              <button
                key={model.value}
                type="button"
                className="rex-menu-item"
                disabled={blocked !== null}
                title={blocked ?? model.description}
                onClick={() => {
                  props.onPick(model.value);
                  setOpen(false);
                }}
              >
                {props.value === model.value ? TICK : SPACE}
                {model.displayName}
              </button>
            );
          })}

          {/*
            Spec 43 §4.5 — `Manage gateways…`, at the foot of the list it
            manages. The one place the sheet is opened from, so a reviewer who
            wants a gateway that is not in the menu finds the door in the menu.
          */}
          {props.action ? (
            <>
              <div className="rex-menu-rule" />
              <button
                type="button"
                className="rex-menu-item"
                title={props.action.title}
                onClick={() => {
                  props.action?.onPick();
                  setOpen(false);
                }}
              >
                {SPACE}
                {props.action.label}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
