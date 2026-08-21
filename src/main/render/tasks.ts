// Spec 03 §5.3 — GitHub task lists, as a local rule.
//
// `markdown-it-task-lists` was last published in 2022 and is CommonJS in an ESM
// project. The rule is thirty lines, so it is written here.
//
// A checkbox is an `<input>`, which holds no text, so the anchor text index is
// untouched — the `[x]` the author wrote leaves it, and nothing replaces it.

import type { MarkdownIt, StateCore } from "markdown-it";

const BOX = /^\[([ xX])\]\s+/;

export function tasks(md: MarkdownIt): void {
  md.core.ruler.after("inline", "rex_tasks", (state: StateCore): void => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "list_item_open") continue;
      if (tokens[i + 1].type !== "paragraph_open") continue;

      const inline = tokens[i + 2];
      if (inline.type !== "inline" || !inline.children?.length) continue;

      const first = inline.children[0];
      if (first.type !== "text") continue;
      const match = BOX.exec(first.content);
      if (!match) continue;

      // `[X]` uppercase counts as done. GitHub accepts it and real documents
      // use it.
      const done = match[1] !== " ";
      first.content = first.content.slice(match[0].length);
      inline.content = inline.content.slice(match[0].length);

      // `html_inline` is the token type that emits raw markup; `md` is created
      // with `html: true`, so it renders. A `text` token would escape the tag
      // and print it.
      const box = new state.Token("html_inline", "", 0);
      box.content = `<input type="checkbox" disabled${done ? " checked" : ""}> `;
      inline.children.unshift(box);

      tokens[i].attrJoin("class", "rex-task");

      // The parent <ul> drops its bullet. It is the token before the item —
      // but only on the *first* item: later ones are preceded by the previous
      // `list_item_close`, which is what makes this guard the safety.
      const list = tokens[i - 1];
      if (list?.type === "bullet_list_open") list.attrJoin("class", "rex-task-list");
    }
  });
}
