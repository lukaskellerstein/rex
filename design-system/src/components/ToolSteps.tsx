import { cx } from "../internal/cx";

export interface ToolStep {
  /** The tool's name — `Read`, `Bash`, `Grep`, `WebFetch`. */
  name: string;
  /** What it was called with. One line; it is clipped, never wrapped. */
  arg: string;
  /**
   * The gate refused this call. It stays visible in red and wraps in full: a
   * write-capable agent being told no is the single most worthwhile line in the
   * whole run.
   */
  denied?: boolean;
}

export interface ToolStepsProps {
  steps: ToolStep[];
  /** Unfolded. @default false */
  open?: boolean;
  onToggle?: () => void;
  /** Opens the full trace over the document pane. */
  onShowTrace?: () => void;
  className?: string;
}

/**
 * Every tool the agent called, collapsed into one row.
 *
 * The rule is **the answer outranks the machinery**, and this is the machinery.
 * It folds to a single 30px row so a reader who wants the answer never has to
 * scroll past a transcript, and it keeps its monospace register when open so it
 * can never be mistaken for the answer above it.
 *
 * A denied call stays in red and wraps rather than clipping. The `read` profile
 * cannot write, and the deny gate firing is the proof — hiding it would hide
 * the one thing that makes the profile split trustworthy.
 *
 * The name column is 76px, not the 34px the board drew. That column was drawn
 * against `Bash`, `Read` and `deny`; a real transcript also carries
 * `ToolSearch` and `WebFetch`, which at 34px printed straight over the argument
 * beside them.
 *
 * For the full thing — bash lines, paths, diffs — use the trace sheet over the
 * document pane. 384px of sidebar cannot hold a diff without wrapping it into
 * mush.
 */
export function ToolSteps({
  steps,
  open = false,
  onToggle,
  onShowTrace,
  className,
}: ToolStepsProps) {
  const denied = steps.filter((step) => step.denied).length;

  return (
    <div className={cx("rex-steps", open && "rex-steps-open", className)}>
      <div className="rex-steps-head">
        <button type="button" className="rex-steps-toggle" onClick={onToggle} aria-expanded={open}>
          <svg className="rex-icon-solid" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <path d={open ? "M0 2h8L4 7z" : "M2 0v8l5-4z"} />
          </svg>
          <span>
            {steps.length} {steps.length === 1 ? "step" : "steps"}
          </span>
          {denied > 0 ? <span className="rex-state-orphaned">{denied} denied</span> : null}
        </button>
        {onShowTrace ? (
          <button type="button" className="rex-steps-show" onClick={onShowTrace}>
            show trace ›
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="rex-steps-list">
          {steps.map((step, index) => (
            <div
              // Two calls to the same tool with the same argument are a real
              // transcript, so the index is the only stable key here.
              key={`${step.name}-${index}`}
              className={cx("rex-step", step.denied && "rex-step-deny")}
            >
              <span className="rex-step-name">{step.name}</span>
              <span className="rex-step-arg">{step.arg}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
