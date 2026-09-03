// The `⋮` at the end of the list's header — the commands that act on the WHOLE
// list rather than on one comment.
//
// **This file was `SidebarTabs.tsx` and spec 30 §8.1 took the tabs out of it.**
// Spec 08 §3.1 made Selection and Comments two tabs and argued the bar was
// furniture: *"navigation that moves is worse than navigation that is sometimes
// empty."* It was right about navigation and wrong about what it was
// navigating. A tab bar says "two destinations, pick one", and only one of the
// two was a destination — the other is a form you fill in and leave, which is
// what `CommentCard` has always been for a comment that exists. The composer is
// a screen with a back arrow now (spec 30 §3), and the menu is all that is left
// of the row.
//
// It sits in the scope row rather than the filter row below it, and the reason
// survived the rewrite intact: the filters narrow what is DRAWN, and these do
// not care what is drawn. The scope row is the list's own header, and the count
// they act on is right beside them.

import { useEffect, useRef, useState } from "react";
import { Kebab } from "./Icons.tsx";

interface Props {
  commentCount: number;
  /** Removes every comment in the workspace. This menu confirms first. */
  onDeleteAllComments: () => void;
}

/** Where the menu hangs: the button's right edge, and just under it. */
interface MenuAt {
  x: number;
  y: number;
}

export function ListMenu(props: Props): React.JSX.Element {
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * The menu closes on anything that is not choosing from it.
   *
   * Copied from the tree's context menu (`Explorer.tsx`), and the two subtle
   * parts are copied with it. Capture phase, so a press elsewhere closes this
   * before that control's own handler runs — with THE MENU ITSELF excepted,
   * because a native capture listener beats React's delegated handlers and
   * without the exception every item is inert: the press closes the menu,
   * React unmounts the button, and the `click` lands on nothing.
   *
   * `composedPath()` rather than `contains(target)`: the overlay is inside a
   * shadow root, so an event crossing it is retargeted to the host and a
   * containment test answers no for every click, the ones inside included.
   *
   * THE BUTTON IS EXCEPTED TOO, and unlike the tree's menu this one needs it,
   * because this menu has a button and a right-click has none. Measured on
   * 2026-08-28 with real mouse events: pressing `⋮` a second time closed the
   * menu on `pointerdown`, React re-rendered in the gap before `click`, and
   * the button's handler — now reading `menu` as null — opened it again. The
   * menu never shut. Skipping the button here leaves the toggle to `onClick`,
   * which is the one place that knows the menu is already open.
   */
  useEffect(() => {
    if (!menu) return;
    const closeUnlessInside = (event: Event): void => {
      const path = event.composedPath();
      const mine =
        (menuRef.current && path.includes(menuRef.current)) ||
        (buttonRef.current && path.includes(buttonRef.current));
      if (!mine) setMenu(null);
    };
    const close = (): void => setMenu(null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", closeUnlessInside, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeUnlessInside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  /**
   * The confirm lives here, next to the control that was pressed, and it names
   * the count: "delete all" is only frightening in proportion to how much all
   * is, and the number is the one thing the reviewer cannot see from the
   * dialog.
   */
  const deleteAll = (): void => {
    setMenu(null);
    const many = props.commentCount;
    const plural = many === 1 ? "comment" : "comments";
    if (window.confirm(`Delete all ${many} ${plural} in this workspace? This cannot be undone.`)) {
      props.onDeleteAllComments();
    }
  };

  // A fragment, not a `<nav>`. It is one button inside the scope row now rather
  // than a row of its own, and wrapping it would give the header two headers.
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="rex-icon-button rex-tabs-menu"
        aria-label="Comment list commands"
        aria-expanded={menu !== null}
        aria-haspopup="menu"
        data-tip="List commands"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: box.right, y: box.bottom + 4 });
        }}
      >
        <Kebab />
      </button>

      {/*
        Fixed to the viewport and drawn here rather than in a portal, for the
        reason the tree's menu is: the overlay has no portal host, and a second
        menu does not justify inventing one.
      */}
      {menu ? (
        <div
          ref={menuRef}
          className="rex-menu rex-menu-right"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="rex-menu-item rex-menu-danger"
            disabled={props.commentCount === 0}
            title="Delete every comment in this workspace. Folders stay."
            onClick={deleteAll}
          >
            Delete all comments
          </button>
        </div>
      ) : null}
    </>
  );
}
