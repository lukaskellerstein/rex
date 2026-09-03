// Spec 08 §3.1 — the one control that means "switch what this pane shows".
//
// Lifted out of `SidebarTabs` by spec 28 §5.7, because the explorer's column
// switches between its tree and its search results with the same choice, and
// two columns drawing the same control from two copies is how they drift.
// `SidebarTabs` keeps its `⋮` menu and draws this for the row.
//
// A count is optional. A tab with one says how much is in it, and reads dimmed
// at zero when it is not the one open; a tab without one is never dimmed —
// there is nothing for it to be empty of.

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  count?: number;
  /**
   * Spec 30 §4.3 — the whole label, for one that has to truncate.
   *
   * A file name is the only label here that is not chosen to fit, and the scope
   * row's middle column is 88px narrower on each side than the row. Absent
   * everywhere else, because a tab whose label always fits has nothing to say
   * on hover that it is not already saying.
   */
  title?: string;
}

interface Props<T extends string> {
  tabs: TabSpec<T>[];
  on: T;
  onTab: (tab: T) => void;
}

export function Tabs<T extends string>(props: Props<T>): React.JSX.Element {
  return (
    <div className="rex-segment rex-tabs">
      {props.tabs.map((tab) => {
        const on = props.on === tab.id;
        // Dimmed, not disabled: the empty tab still opens, and what it shows
        // is one line saying how it fills.
        const empty = tab.count === 0 && !on;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={on}
            className={[on ? "rex-on" : "", empty ? "rex-tab-empty" : ""].filter(Boolean).join(" ")}
            title={tab.title}
            onClick={() => props.onTab(tab.id)}
          >
            {/*
              The label is its own element so it can be truncated on its own.
              A bare text node beside the count cannot: `text-overflow` needs a
              box, and clipping the button clipped BOTH ends of a centred label —
              `sample-document.md` came out as `le-document.m`, with no ellipsis
              to say it had been cut. Measured 2026-09-02.
            */}
            <span className="rex-tab-label">{tab.label}</span>
            {tab.count !== undefined ? <span className="rex-chip-count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
