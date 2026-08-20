// SPEC.md §5.3 — Markdown → HTML with `data-src-line` on every block.
//
// The stamped line number is what makes Apply precise: an anchor records the
// source line it came from, so the write agent edits the right place in the
// Markdown rather than searching the rendered output for prose.

import type { MarkdownIt, RendererRule } from "markdown-it";
import createMarkdownIt from "markdown-it";

/** Block tokens whose `_open` tag carries the attribute directly. */
const OPEN_RULES = [
  "paragraph_open",
  "heading_open",
  "blockquote_open",
  "list_item_open",
  "table_open",
] as const;

/**
 * `fence` and `code_block` have no `_open` token — they render a whole
 * `<pre><code>` in one go, and markdown-it puts token attributes on the inner
 * `<code>`. §5.3 wants the block-level element stamped, so these two are
 * handled by rewriting the emitted `<pre>` instead.
 */
const WHOLE_ELEMENT_RULES = ["fence", "code_block"] as const;

const SRC_LINE_ATTR = "data-src-line";

function createRenderer(): MarkdownIt {
  const md = createMarkdownIt({ html: true, linkify: true });

  for (const rule of OPEN_RULES) {
    const base: RendererRule | undefined = md.renderer.rules[rule];
    md.renderer.rules[rule] = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      // token.map is [startLine, endLine], zero-indexed.
      if (token.map) token.attrSet(SRC_LINE_ATTR, String(token.map[0] + 1));
      return base ? base(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
    };
  }

  for (const rule of WHOLE_ELEMENT_RULES) {
    const base: RendererRule | undefined = md.renderer.rules[rule];
    md.renderer.rules[rule] = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      const html = base ? base(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
      if (!token.map) return html;
      return html.replace(/^<pre/, `<pre ${SRC_LINE_ATTR}="${token.map[0] + 1}"`);
    };
  }

  return md;
}

const renderer = createRenderer();

/** Renders Markdown to a fragment of HTML — no document wrapper. */
export function renderMarkdown(source: string): string {
  return renderer.render(source);
}

/**
 * Spec 02 §5.1 — every link in the document, with the source line it sits on.
 *
 * The token stream rather than a regular expression, because it already knows
 * that a link inside a fenced code block is not a link, that a reference-style
 * link resolves to its definition, and that an autolink is one too. The line
 * comes from the enclosing block token's `map`, the same source of truth
 * `data-src-line` uses.
 */
export function parseMarkdownLinks(source: string): Array<{ href: string; line: number | null }> {
  const links: Array<{ href: string; line: number | null }> = [];

  for (const token of renderer.parse(source, {})) {
    if (token.type !== "inline" || !token.children) continue;
    const line = token.map ? token.map[0] + 1 : null;
    for (const child of token.children) {
      if (child.type !== "link_open") continue;
      const href = child.attrGet("href");
      if (href) links.push({ href: String(href), line });
    }
  }

  return links;
}

/** The first ATX/setext heading, used as the document title. */
export function markdownTitle(source: string): string | null {
  const match = source.match(/^\s{0,3}#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : null;
}
