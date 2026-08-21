import { cx } from "../internal/cx";

export interface SegmentedOption {
  /** The value reported to `onChange`. */
  value: string;
  /** What the segment reads. */
  label: string;
  /** A count drawn after the label, in tabular figures. */
  count?: number;
  /** Dim and unclickable — an empty Selection tab, for instance. */
  disabled?: boolean;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  /** The value of the segment that is on. */
  value: string;
  onChange?: (value: string) => void;
  /** Names the group for a screen reader — `Workspace view`, `Sidebar`. */
  "aria-label"?: string;
  className?: string;
}

/**
 * REX has exactly one control that means "switch what this pane shows", and
 * this is it.
 *
 * It carries `Document | Graph | Facts` in the top bar and
 * `Selection | Comments` in the sidebar. Both are the same kind of choice, so
 * both wear the same control — a reader who has learnt one has learnt the
 * other.
 *
 * **It is not a mode switch.** A mode belongs where the mode acts:
 * `pick element` sits at the foot of the paper, not up here among facts about
 * the document. Putting a mode in this control was the fault the redesign
 * removed.
 *
 * **The bar stays put when it is empty.** An empty Selection tab dims and reads
 * `0`; it does not disappear. A control that comes and goes is its own kind of
 * confusing.
 */
export function Segmented({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps) {
  return (
    <div className={cx("rex-segment", className)} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          disabled={option.disabled}
          className={cx(option.value === value && "rex-on")}
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
          {option.count === undefined ? null : (
            <span className="rex-segment-count">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
