// Spec 03 §5.2 — GitHub alerts, as a local rule rather than a dependency.
//
// `markdown-it-github-alerts` works, and is not used: it emits the label as
// real text (`<p class="markdown-alert-title">Tip</p>`). That word enters the
// anchor text index, so every offset after it shifts by a word REX invented,
// and every comment below the alert moves. It is the same reason
// `data-rex-overlay` exists — REX's own text is never in the index.
//
// So the label is an attribute here, and the stylesheet draws it with
// `::before`. Generated content is never in the DOM text, never selectable, and
// therefore never in the index.

import type { MarkdownIt, StateCore } from "markdown-it";

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/;

export function alerts(md: MarkdownIt): void {
  // After "inline", never after "block": after `block` an inline token has its
  // `content` but its `children` is still null — the `inline` rule is what
  // parses them. A rule hooked after `block` reads null, matches nothing, and
  // fails silently.
  md.core.ruler.after("inline", "rex_alerts", (state: StateCore): void => {
    const tokens = state.tokens;
    // `tokens.length` is re-read every pass because the splice below shortens it.
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "blockquote_open") continue;
      if (tokens[i + 1].type !== "paragraph_open") continue;

      const inline = tokens[i + 2];
      if (inline.type !== "inline" || !inline.children?.length) continue;

      const first = inline.children[0];
      if (first.type !== "text") continue;
      const match = MARKER.exec(first.content.trim());
      if (!match) continue;

      // `blockquote_open`'s other attributes are untouched, so data-src-line
      // survives and Apply still knows which line to edit.
      tokens[i].attrSet("data-alert", match[1].toLowerCase());

      // Drop the marker, and the line break that followed it.
      const drop = inline.children[1]?.type === "softbreak" ? 2 : 1;
      inline.children.splice(0, drop);
      inline.content = inline.content.slice(first.content.length).replace(/^\n/, "");

      // An alert whose whole first paragraph was the marker leaves an empty
      // paragraph behind. Remove the triple, not just the text.
      if (inline.children.length === 0) tokens.splice(i + 1, 3);
    }
  });
}
