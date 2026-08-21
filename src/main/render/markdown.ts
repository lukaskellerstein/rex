// SPEC.md §5.3 — Markdown → HTML with `data-src-line` on every block, and
// spec 03 §5 — the plugins that make a real README render as itself.
//
// The stamped line number is what makes Apply precise: an anchor records the
// source line it came from, so the write agent edits the right place in the
// Markdown rather than searching the rendered output for prose.
//
// Everything assembled here is synchronous. KaTeX renders a string, highlight.js
// renders a string, and the three local rules are token-stream transforms — so
// `renderMarkdown` stays a plain function. The two things that cannot be
// strings, Mermaid and PDF, are drawn in the renderer instead (spec 03 §4).

import katexPluginModule from "@vscode/markdown-it-katex";
import hljs from "highlight.js";
import type { MarkdownIt, RendererRule } from "markdown-it";
import createMarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import { alerts } from "./alerts.ts";
import { figures } from "./figures.ts";
import { tasks } from "./tasks.ts";

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

/**
 * `@vscode/markdown-it-katex` is CommonJS with `exports.default`. Node's ESM
 * interop hands back `module.exports` itself, so the plugin function sits one
 * level below where the package's own `.d.ts` says it does; a bundler that
 * unwraps `__esModule` hands back the function directly. Accept either, rather
 * than depending on which loader ran — `node --test` and the electron-vite
 * build do not have to agree for this to keep working.
 */
const katexPlugin = (
  typeof katexPluginModule === "function"
    ? katexPluginModule
    : (katexPluginModule as { default: typeof katexPluginModule }).default
) as typeof katexPluginModule;

/**
 * GitHub's heading slug (spec 03 §5.5).
 *
 * markdown-it-anchor's default is `encodeURIComponent(lowercased-with-hyphens)`,
 * which does not strip punctuation. GitHub does — so `## What's next?` becomes
 * `what's-next%3F` by default where GitHub writes `whats-next`, and every
 * table-of-contents link in a real README stays dead.
 *
 * `\p{L}` and `\p{N}` rather than `a-z0-9`, so a heading in Czech keeps its
 * diacritics. GitHub does the same, and this repo's corpus is not all English.
 */
function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/ /g, "-");
}

function createRenderer(): MarkdownIt {
  const md = createMarkdownIt({
    html: true,
    linkify: true,
    highlight: (code: string, language: string): string => {
      // A mermaid fence is a drawing program, not code — §5.8 owns it.
      if (language === "mermaid") return "";
      // Never guess a grammar. An unknown language falls back to no colour;
      // guessing colours the code confidently and wrongly.
      if (!language || !hljs.getLanguage(language)) return "";
      return hljs.highlight(code, { language }).value;
    },
  })
    // Collisions need no handling: markdown-it-anchor tracks the slugs it has
    // emitted and appends -1, -2 itself. `permalink` stays off — a clickable
    // link beside each heading would add text to the anchor index (§5.1) and
    // put a control in a document REX must not make interactive.
    .use(anchor, { tabIndex: false, slugify: githubSlug })
    .use(footnote)
    // `throwOnError: false`: a malformed formula renders as its own source in
    // red, so one bad \frac never costs the reviewer the page.
    .use(katexPlugin, { throwOnError: false })
    // All three hook after "inline" — see the comment in alerts.ts.
    .use(alerts)
    .use(tasks)
    .use(figures);

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
      const line = token.map ? token.map[0] + 1 : 0;

      // §5.8 — a mermaid fence emits a different <pre>, so it is handled in the
      // same rule and carries both attributes at once. The id is derived from
      // the source line, which is what makes it stable across reloads: a
      // layer-3 element anchor on #mermaid-155 is only worth anything if it is
      // the same #mermaid-155 next time.
      if (token.info.trim() === "mermaid") {
        return `<pre class="rex-mermaid" id="mermaid-${line}" ${SRC_LINE_ATTR}="${line}">${md.utils.escapeHtml(
          token.content,
        )}</pre>\n`;
      }

      const html = base ? base(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
      if (!token.map) return html;
      return html.replace(/^<pre/, `<pre ${SRC_LINE_ATTR}="${line}"`);
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
