// Spec 14 §7.1 — a group's header: the twisty, the folder, the name, the badge.
//
// A folder, open or closed. The spec first argued against one, because the
// explorer's folders are directories and these are not — and the first build
// drew a pair of brackets that read as nothing at all. An unreadable glyph is
// the worse problem: a folder is what "a place I put things in" looks like to
// everybody, and what these are NOT is a sentence the spec can carry (§2.1).

import {
  FolderClosed,
  FolderOpen,
  Pencil,
  Plus,
  Trash,
  TriangleDown,
  TriangleRight,
} from "./Icons.tsx";
import { NameBox } from "./NameBox.tsx";

interface Props {
  name: string;
  /** Comments beneath it, at every depth, of the ones the filter is showing. */
  count: number;
  collapsed: boolean;
  /** True while this row is the one a drag would drop *into*. */
  dropInside: boolean;
  renaming: boolean;
  onToggle: () => void;
  onRename: () => void;
  onName: (name: string | null) => void;
  onCancelRename: () => void;
  /** Spec 14 §7.4 — a group inside this one. */
  onAddChild: () => void;
  onDelete: () => void;
}

export function GroupRow(props: Props): React.JSX.Element {
  // The indent is the wrapper's, so the tree beside it can start at zero.
  return (
    <div className={`rex-group ${props.dropInside ? "rex-group-into" : ""}`}>
      <button
        type="button"
        className="rex-group-twisty"
        aria-expanded={!props.collapsed}
        aria-label={props.collapsed ? `Open ${props.name}` : `Close ${props.name}`}
        onClick={props.onToggle}
      >
        {props.collapsed ? <TriangleRight /> : <TriangleDown />}
      </button>

      {props.collapsed ? <FolderClosed size={13} /> : <FolderOpen size={13} />}

      {props.renaming ? (
        <NameBox
          value={props.name}
          label={`Name for the group ${props.name}`}
          // §7.1 — a group's name can never be emptied. Unlike a comment there
          // is no note to fall back to, so Enter on an empty box keeps the old
          // name rather than writing one.
          allowEmpty={false}
          onSave={props.onName}
          onCancel={props.onCancelRename}
        />
      ) : (
        <>
          {/*
            The count is a badge ON the name, not a number at the far end of the
            row. At the far end it belonged to the row rather than to the group,
            and the eye had to travel the whole width to pair them up.
          */}
          <button type="button" className="rex-group-name" onClick={props.onToggle}>
            <span className="rex-group-label">{props.name}</span>
            <span className="rex-group-count">{props.count}</span>
          </button>
          <span className="rex-spacer" />
          <button
            type="button"
            className="rex-row-pen"
            aria-label={`Rename ${props.name}`}
            data-tip="Rename"
            onClick={props.onRename}
          >
            <Pencil size={12} />
          </button>
          {/*
            Three buttons rather than the `…` menu §7.1 first described. REX has
            no popup menu component, and building one for two commands is more
            surface than the commands are worth — the reviewer sees all three at
            once instead of learning where they are hidden.
          */}
          <button
            type="button"
            className="rex-row-pen"
            aria-label={`New folder inside ${props.name}`}
            data-tip="New folder"
            onClick={props.onAddChild}
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            className="rex-row-bin"
            aria-label={`Delete the folder ${props.name}`}
            data-tip="Delete"
            onClick={props.onDelete}
          >
            <Trash size={12} />
          </button>
        </>
      )}
    </div>
  );
}
