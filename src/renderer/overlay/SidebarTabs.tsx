// Spec 08 §3.1 — the sidebar does one job at a time.
//
// Selecting and reading are two jobs, and stacking them in one column read as
// one confusing thing. They are tabs now, drawn with the same segmented control
// the top bar uses for Document / Graph: REX has exactly one control that means
// "switch what this pane shows", and this is the same kind of choice.
//
// THE BAR IS FURNITURE. It is here on every screen that shows the comments
// column, whatever is in it — an empty selection dims its tab and reads 0
// rather than removing the bar. A control that comes and goes is its own kind
// of confusing, and that is the fault this set out to fix. The zoom chip in the
// top bar earns its disappearance because it is a *fact* about the document;
// this is navigation, and navigation that moves is worse than navigation that
// is sometimes empty.
//
// Each tab carries its own count, so the one you are not looking at still says
// how much is in it.

export type SidebarTab = "selection" | "comments";

interface Props {
  tab: SidebarTab;
  selectionCount: number;
  commentCount: number;
  onTab: (tab: SidebarTab) => void;
}

export function SidebarTabs(props: Props): React.JSX.Element {
  const tabs: { id: SidebarTab; label: string; count: number }[] = [
    { id: "selection", label: "Selection", count: props.selectionCount },
    { id: "comments", label: "Comments", count: props.commentCount },
  ];

  return (
    <nav className="rex-side-head rex-side-tabs">
      <div className="rex-segment rex-tabs">
        {tabs.map((tab) => {
          const on = props.tab === tab.id;
          // Dimmed, not disabled: the empty Selection tab still opens, and what
          // it shows is one line saying how picking starts.
          const empty = tab.count === 0 && !on;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={on}
              className={[on ? "rex-on" : "", empty ? "rex-tab-empty" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => props.onTab(tab.id)}
            >
              {tab.label}
              <span className="rex-chip-count">{tab.count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
