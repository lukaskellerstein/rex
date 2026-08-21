// The stylesheet REX supplies for Markdown, which has none of its own.
//
// Moved out of `index.ts` at spec 03 §5.9, where it roughly doubled in size.
//
// This is the one document REX is entitled to set: the 620px measure at 15/1.68
// and the paper ground are its own typography, not the author's. HTML documents
// keep their styles untouched (spec 01 §5.4 point 3) and never see this, and a
// `<webview>` URL is untouchable — for both of those the pane supplies only the
// paper ground and the gutter.
//
// Light only, deliberately. The design draws documents on paper and REX's
// chrome in the dark around them; following the system into dark mode would
// make a Markdown file look nothing like the HTML file beside it in the
// explorer, and would put a review's two halves on different grounds.
//
// Every colour comes from `shared/tokens.ts` rather than from taste. The paper
// is written here in main and the anchor highlights painted on it are written
// in the renderer; a palette invented at the keyboard is how the two drift
// until a highlight can no longer be read against the page it sits on.
//
// ONE HARD RULE: no `<` anywhere in the string below, comments included.
//
// DOMPurify's mXSS guard deletes any element whose text content matches
// `/<[/\w!]/`, and a `style` element holding CSS is exactly that shape. Writing
// "a pre that is no longer holding code" with angle brackets round the tag name
// therefore deletes the whole stylesheet — measured on 2026-08-21, where the
// document rendered completely unstyled and nothing logged a word about it.
// `test/markdown.spec.ts` asserts this, because it is not the kind of thing
// anybody notices twice.

import { ALERT, CODE, MEASURE, PAPER } from "../../shared/tokens.ts";

/** One `blockquote[data-alert="…"]` pair per kind, generated from ALERT. */
function alertRules(): string {
  return Object.entries(ALERT)
    .map(
      ([kind, colour]) => `
  blockquote[data-alert="${kind}"] { border-color: ${colour.rule}; background: ${colour.bg}; }
  blockquote[data-alert="${kind}"]::before { content: "${colour.label}"; color: ${colour.rule}; }`,
    )
    .join("");
}

export const MARKDOWN_STYLESHEET = `
  :root { color-scheme: light; }
  body {
    margin: 0 auto;
    padding: 40px 24px 96px;
    max-width: ${MEASURE.width};
    background: ${PAPER.bg};
    color: ${PAPER.inkBody};
    font: ${MEASURE.fontSize}/${MEASURE.lineHeight} "IBM Plex Sans", system-ui, -apple-system, sans-serif;
  }
  h1, h2, h3, h4, h5, h6 { color: ${PAPER.ink}; line-height: 1.2; margin: 30px 0 12px; }
  h1 { font-size: 27px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.15; margin-top: 0; }
  h2 { font-size: 20px; font-weight: 600; }
  h3 { font-size: 17px; font-weight: 600; }
  h4, h5, h6 { font-size: 15px; font-weight: 600; }
  p, ul, ol, blockquote, table, figure, pre { margin: 0 0 18px; }
  a { color: ${PAPER.link}; }
  code {
    background: ${PAPER.wash};
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88em;
  }
  pre {
    background: ${PAPER.wash};
    padding: 14px 16px;
    border-radius: 5px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.55;
  }
  pre code { background: none; padding: 0; font-size: inherit; }
  blockquote {
    margin-left: 0;
    padding-left: 14px;
    border-left: 2px solid ${PAPER.rule};
    color: ${PAPER.inkMuted};
  }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  th, td { border: 1px solid ${PAPER.rule}; padding: 7px 10px; text-align: left; }
  th { background: ${PAPER.wash}; font-weight: 600; color: ${PAPER.ink}; }
  figure { padding: 9px; border-radius: 4px; background: ${PAPER.wash}; }
  figcaption { margin-top: 7px; font-size: 12.5px; color: ${PAPER.inkMuted}; }
  hr { border: none; border-top: 1px solid ${PAPER.rule}; margin: 30px 0; }
  img { max-width: 100%; }
  ::selection { background: #b6d0f2; }

  /* Alerts (§5.2) — the label is generated content, so it is never in the
     text index and never selectable. That is the point of the whole rule. */
  blockquote[data-alert] {
    margin-left: 0;
    padding: 10px 14px;
    border-left: 3px solid;
    border-radius: 0 4px 4px 0;
    color: ${PAPER.inkBody};
  }
  blockquote[data-alert]::before {
    display: block;
    margin-bottom: 4px;
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: inherit;
  }
  blockquote[data-alert] > :last-child { margin-bottom: 0; }${alertRules()}

  /* Task lists (§5.3) */
  ul.rex-task-list { list-style: none; padding-left: 20px; }
  li.rex-task { position: relative; }
  li.rex-task input[type="checkbox"] {
    position: absolute;
    left: -20px;
    top: 0.35em;
    margin: 0;
    accent-color: ${PAPER.link};
  }

  /* Figures (§5.4) — these rules existed before anything emitted a figure. */
  figure.rex-figure { margin: 0 0 18px; }

  /* Footnotes (§5.1) — markdown-it-footnote's own class names. */
  .footnotes { margin-top: 36px; padding-top: 12px; border-top: 1px solid ${PAPER.rule}; }
  .footnotes-list { padding-left: 20px; font-size: 13.5px; color: ${PAPER.inkMuted}; }
  .footnote-item p { margin: 0 0 8px; }
  .footnote-ref a { text-decoration: none; }
  .footnote-backref { text-decoration: none; }

  /* Headings carry an id (§5.5), so a table-of-contents jump should not put
     the target flush against the top of the pane. */
  h1[id], h2[id], h3[id], h4[id], h5[id], h6[id] { scroll-margin-top: 24px; }

  /* Code colour (§5.7) — highlight.js classes onto the paper palette. */
  .hljs-keyword, .hljs-built_in { color: ${CODE.keyword}; }
  .hljs-string, .hljs-regexp { color: ${CODE.string}; }
  .hljs-comment, .hljs-quote { color: ${CODE.comment}; font-style: italic; }
  .hljs-number, .hljs-literal { color: ${CODE.number}; }
  .hljs-title, .hljs-section { color: ${CODE.title}; }
  .hljs-attr, .hljs-attribute { color: ${CODE.attr}; }
  .hljs-meta { color: ${CODE.meta}; }

  /* Math (§5.6) — KaTeX's own stylesheet is linked separately. */
  .katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }

  /* Mermaid (§5.8) — a pre element that is no longer holding code. Until the
     pass draws it, the source stays visible as ordinary code, which is the
     fallback §4.2 rule 3 requires. */
  pre.rex-mermaid[data-rendered] {
    white-space: normal;
    font-family: inherit;
    text-align: center;
    background: none;
    padding: 0;
  }
  pre.rex-mermaid[data-rendered] svg { max-width: 100%; height: auto; }
`;
