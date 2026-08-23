// ⌘↵ / ctrl↵ in a message box does what that box's primary button does.
//
// REX has three message boxes — the selection's note (spec 05 §3), a thread's
// reply (spec 01 §7) and the synthesis note (spec 05 §5) — and each has its own
// primary button with its own guard. The chord lives here rather than in each
// of them so the three cannot drift: one place decides which keys count and
// that a disabled button is never fired by a keystroke.
//
// BOTH modifiers, deliberately. ⌘↵ is the platform-standard send on macOS and
// is what a reviewer's hands already know from every chat and mail client;
// ctrl↵ is the same chord everywhere else and is what was asked for. Neither
// costs the other anything.
//
// This is not spec 08 §4.2's warning about `ctrl`. That one is about ctrl-CLICK,
// which macOS takes as a right-click before the page ever sees it. A keyboard
// chord is not a pointer gesture and the OS does not claim it.

/**
 * A `keydown` handler for a textarea whose primary button is `send`.
 *
 * Plain ↵ is left alone — these boxes are multi-line and a bare Enter has to go
 * on writing a newline. Only the modified chord is taken, and it is taken even
 * when `canSend` is false, so the chord never types a stray newline on its way
 * to doing nothing.
 */
export function onSendChord(
  canSend: boolean,
  send: () => void,
): (event: React.KeyboardEvent) => void {
  return (event) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (canSend) send();
  };
}

/** What a primary button's `title` says about its chord, on every platform. */
export const SEND_CHORD_HINT = "⌘↵ or ctrl↵";

/**
 * The chord, drawn on the button it fires.
 *
 * A shortcut nobody can see is a shortcut nobody uses, and the `title` only
 * pays out to someone who already suspected it was there. This is the same
 * `.rex-key` cap the path bar and the pen bar already use to say which key does
 * what, so REX has one way of drawing a key rather than two.
 *
 * `ctrl↵` and not `⌘↵` because both work and this is the one that reads the
 * same on every platform. The `title` names both.
 */
export function SendChord(): React.JSX.Element {
  // Hidden from the accessible name, which would otherwise read "Ask about
  // 3ctrl↵". The button's `title` carries the shortcut for anyone not reading
  // the pixels, and that is the string that belongs in a description rather
  // than in the name of the control.
  return (
    <kbd className="rex-key rex-key-primary" aria-hidden="true">
      ctrl↵
    </kbd>
  );
}
