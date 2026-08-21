import * as React from "react";
import { cx } from "../internal/cx";

export type PanelTone = "panel" | "sunk" | "well";

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Which of the three surfaces above the shell ground this is.
   *
   * `panel` is a column — the explorer, the comments. `sunk` is an inset field
   * — a button face, a tree row under the cursor. `well` is the deepest, used
   * where something is being composed rather than read: the selection panel and
   * the reply box.
   * @default 'panel'
   */
  tone?: PanelTone;
  /** Drop the border and the radius — for a panel that spans a whole column. */
  flush?: boolean;
  /** Add the standard 12px/14px inset. */
  padded?: boolean;
  children?: React.ReactNode;
}

/**
 * A surface one step up from the shell ground.
 *
 * REX has four depths and no shadows between them: `--bg` is the ground,
 * `--panel` a column, `--sunk` an inset, `--well` the deepest. Depth is carried
 * by value alone, so the whole chrome stays flat and nothing on screen competes
 * with the document for attention.
 *
 * The one lift in the design (`--lift`) belongs to a selected card, not to a
 * panel.
 */
export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { tone = "panel", flush = false, padded = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      {...rest}
      ref={ref}
      className={cx(
        "rex-panel",
        tone !== "panel" && `rex-panel-${tone}`,
        flush && "rex-panel-flush",
        padded && "rex-panel-pad",
        className,
      )}
    >
      {children}
    </div>
  );
});
