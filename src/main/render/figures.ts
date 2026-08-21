// Spec 03 §5.4 — an image-only paragraph becomes a <figure>, and an italic
// paragraph right after it becomes its <figcaption>.
//
// The rule works by *retagging* tokens rather than replacing them, and that is
// the whole point: `data-src-line` is stamped by the renderer rules in
// `markdown.ts` from `token.map`, and `map` survives a tag change. Building the
// figure by emitting raw HTML would produce an `html_block` token, which
// carries no `map` — so `data-src-line` would disappear and Apply would lose
// the line for every image in the document.

import type { MarkdownIt, StateCore, Token } from "markdown-it";

function isLone(token: Token | undefined, childType: string): boolean {
  return token?.children?.length === 1 && token.children[0].type === childType;
}

/** An inline token whose children are exactly one `<em>` wrapping everything. */
function isItalicOnly(token: Token | undefined): boolean {
  const children = token?.children;
  if (!children || children.length < 2) return false;
  return children[0].type === "em_open" && children[children.length - 1].type === "em_close";
}

export function figures(md: MarkdownIt): void {
  md.core.ruler.after("inline", "rex_figures", (state: StateCore): void => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "paragraph_open") continue;
      if (!isLone(tokens[i + 1], "image")) continue;

      tokens[i].tag = "figure";
      tokens[i + 2].tag = "figure"; // the paragraph_close
      tokens[i].attrJoin("class", "rex-figure");

      const c = i + 3;
      const caption = tokens[c + 1];
      if (tokens[c]?.type !== "paragraph_open" || !isItalicOnly(caption)) continue;

      // The caption keeps its OWN data-src-line, so a comment on the caption
      // resolves to the caption's line in the Markdown, not the image's.
      tokens[c].tag = "figcaption";
      tokens[c + 2].tag = "figcaption";
      const children = caption.children;
      if (children) caption.children = children.slice(1, -1); // drop the <em>

      // Move figure_close past the caption, so the caption sits inside the
      // figure. Removing it at i+2 shifts everything after down by one, so the
      // caption now ends at i+4 and the reinsertion point is i+5 — which is
      // c+2. Getting this wrong nests figcaption outside figure, and the
      // browser silently reparents it.
      const [close] = tokens.splice(i + 2, 1);
      tokens.splice(c + 2, 0, close);
    }
  });
}
