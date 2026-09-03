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

interface Props {
  models: ModelChoice[];
  /**
   * The pick, or null for "follow the app-wide default".
   *
   * The two are genuinely different and the menu shows both: a comment set to
   * null moves when the default moves, and one set to `sonnet` does not. The
   * top bar passes a concrete value and never null — it IS the default.
   */
  value: string | null;
  /** §6 — the app-wide default, which is what `value: null` resolves to. */
  fallback: string;
  /** §7.1 — offered by the composer, never by the top bar, which would loop. */
  allowDefault: boolean;
  /** §2.3 — why the model cannot be chosen here, or null when it can. */
  disabled: string | null;
  /** §3.4 — the probe failed, and this says so. */
  error: string | null;
  onPick: (value: string | null) => void;
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
              title="Follow the default in the top bar. This comment moves when that does."
              onClick={() => {
                props.onPick(null);
                setOpen(false);
              }}
            >
              {props.value === null ? "✓ " : "  "}
              Default — {modelLabel(models, null, props.fallback)}
            </button>
          ) : null}

          {props.allowDefault && models.length > 0 ? <div className="rex-menu-rule" /> : null}

          {models.map((model) => (
            <button
              key={model.value}
              type="button"
              className="rex-menu-item"
              title={model.description}
              onClick={() => {
                props.onPick(model.value);
                setOpen(false);
              }}
            >
              {props.value === model.value ? "✓ " : "  "}
              {model.displayName}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
