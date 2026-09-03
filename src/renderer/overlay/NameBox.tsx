// Spec 14 §3.3 — the inline box that renames a comment or a group.
//
// One component for both, because renaming is one act. The panel should not
// have two boxes that behave almost the same: Enter saves, Escape cancels and
// writes nothing, and blur saves what is there — a reviewer who clicks away
// from a rename has finished, not given up.

import { useEffect, useRef, useState } from "react";

interface Props {
  /** What the box opens with — the current name, never blank (§3.3). */
  value: string;
  label: string;
  /**
   * Whether clearing the box means anything.
   *
   * True for a comment: empty is the reset, and writes NULL so the note comes
   * back (§3.1). False for a group, which has no note to fall back to (§7.1).
   */
  allowEmpty: boolean;
  /**
   * Spec 23 §5.2 — how much of the name the box opens selected.
   *
   * `all` for a comment or a group, whose name is prose. `stem` for a file,
   * where the extension is not part of what is being renamed: every file
   * manager selects `components` and leaves `.md`, and typing over the dot is
   * how a document silently stops being one REX can open.
   */
  selection?: "all" | "stem";
  /** Null only ever reaches this when `allowEmpty` is true. */
  onSave: (name: string | null) => void;
  onCancel: () => void;
}

/** The last dot that is not the first character — `.gitignore` has no stem. */
function stemEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

export function NameBox(props: Props): React.JSX.Element {
  const [draft, setDraft] = useState(props.value);
  const input = useRef<HTMLInputElement>(null);
  // Selected, not just focused: the box opens on the note, and the first thing
  // a rename does is replace most of it. Typing over a selection is one
  // keystroke; clearing 97 characters by hand is not.
  useEffect(() => {
    input.current?.focus();
    if (props.selection === "stem") input.current?.setSelectionRange(0, stemEnd(props.value));
    else input.current?.select();
  }, [props.selection, props.value]);

  /**
   * Enter and Escape both close the box, and closing it blurs the input — so
   * without this every rename would be written twice, and an Escape would be
   * followed by the save it was meant to prevent.
   */
  const settled = useRef(false);

  const save = (): void => {
    if (settled.current) return;
    settled.current = true;
    const trimmed = draft.trim();
    if (!trimmed) {
      if (props.allowEmpty) props.onSave(null);
      else props.onCancel();
      return;
    }
    props.onSave(trimmed);
  };

  const cancel = (): void => {
    if (settled.current) return;
    settled.current = true;
    props.onCancel();
  };

  return (
    <input
      ref={input}
      type="text"
      className="rex-name-box"
      aria-label={props.label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      // The row underneath is a click target and a drag source. Neither should
      // fire because somebody put the caret in the middle of a word.
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={save}
      onKeyDown={(event) => {
        // Every REX shortcut is off while the caret is in a text field, and this
        // is the field: the keys that move rows (§4.5) must not fire here.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}
