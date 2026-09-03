// The stylesheet REX supplies for Markdown, which has none of its own.
//
// Moved out of `index.ts` at spec 03 §5.9, where it roughly doubled in size.
//
// This is the one document REX is entitled to set: the 620px measure at 15/1.68
// and the paper ground are its own typography, not the author's. HTML documents
// keep their styles untouched (spec 01 §5.4 point 3) and never see this — for
// those the pane supplies only the paper ground and the gutter.
//
// TWO GROUNDS AND TWO WIDTHS SINCE SPEC 27, and the rule that decides both is
// narrow. REX may offer to change how it typesets a page it typeset itself; it
// never restyles a page whose styles are somebody else's. So Markdown gets the
// switches and every other format gets none — spec 27 §4.2.
//
// This file used to say "light only, deliberately", and the reasoning under it
// still stands: a Markdown file that FOLLOWED THE SYSTEM would look nothing
// like the HTML file beside it in the explorer, and would put a review's two
// halves on different grounds. What spec 27 changes is only the conclusion. A
// switch the reviewer presses is not the system deciding: both panes read the
// one setting, so they cannot disagree, and the Markdown file differs from its
// neighbour only for as long as the reviewer asked it to. **Nothing here ever
// reads `prefers-color-scheme`** — spec 27 §8, and the refusal this comment was
// originally written to make.
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

import {
  ALERT,
  ALERT_DARK,
  CODE,
  CODE_DARK,
  MEASURE,
  PAPER,
  PAPER_DARK,
  SELECT,
} from "../../shared/tokens.ts";

// The three palettes, by shape rather than by value. `as const` gives every
// token a literal type, so `typeof PAPER` would accept only PAPER itself and
// the dark twin could not be passed to the same function.
type PaperTones = { [K in keyof typeof PAPER]: string };
type CodeTones = { [K in keyof typeof CODE]: string };
/** The five callout tones, without the label — which is the same on both grounds. */
type AlertTones = Record<string, { rule: string; bg: string }>;

/**
 * Spec 27 §5.2 — one palette, written as custom properties.
 *
 * The switch is an attribute on the page's own root, so the dark values are a
 * second block of the SAME names rather than a second stylesheet. Nothing below
 * this function names a colour: every rule reads a property, which is what lets
 * `data-rex-dark` repaint the document without main rendering it again and
 * without the frame reloading.
 */
function paperVariables(
  paper: PaperTones,
  alerts: AlertTones,
  code: CodeTones,
  select: string,
): string {
  const alertVariables = Object.keys(alerts)
    .map(
      (kind) => `
  --alert-${kind}-rule: ${alerts[kind].rule};
  --alert-${kind}-bg: ${alerts[kind].bg};`,
    )
    .join("");

  return `
  --paper-bg: ${paper.bg};
  --paper-ink: ${paper.ink};
  --paper-ink-body: ${paper.inkBody};
  --paper-ink-muted: ${paper.inkMuted};
  --paper-rule: ${paper.rule};
  --paper-wash: ${paper.wash};
  --paper-link: ${paper.link};
  --paper-select: ${select};
  --code-keyword: ${code.keyword};
  --code-string: ${code.string};
  --code-comment: ${code.comment};
  --code-number: ${code.number};
  --code-title: ${code.title};
  --code-attr: ${code.attr};
  --code-meta: ${code.meta};${alertVariables}`;
}

/** One `blockquote[data-alert="…"]` pair per kind, generated from ALERT. */
function alertRules(): string {
  return Object.entries(ALERT)
    .map(
      ([kind, colour]) => `
  blockquote[data-alert="${kind}"] { border-color: var(--alert-${kind}-rule); background: var(--alert-${kind}-bg); }
  blockquote[data-alert="${kind}"]::before { content: "${colour.label}"; color: var(--alert-${kind}-rule); }`,
    )
    .join("");
}

export const MARKDOWN_STYLESHEET = `
  :root {
    color-scheme: light;
    /* Spec 27 §4.3 — the default measure. \`data-rex-wide\` removes it, and
       nothing else does. 620px is about 75 characters at 15px, which is the
       measure continuous prose wants; a wide table is what the switch is for. */
    --paper-measure: ${MEASURE.width};
    /* §4.5 — a picture is the author's and REX does not invert it, so the
       figure card is a property of its own rather than the paper's wash. On
       the dark ground it keeps these light values. */
    --figure-bg: ${PAPER.wash};
    --figure-caption: ${PAPER.inkMuted};${paperVariables(PAPER, ALERT, CODE, SELECT.light)}
  }

  /* Spec 27 §4.4 — the dark paper. Same hues, mirrored lightness.

     \`color-scheme\` here is on the PAGE, and that is the whole difference from
     the warning in \`DocumentView.tsx\`: set on the iframe ELEMENT it decides
     what \`prefers-color-scheme\` resolves to inside the frame, which broke a
     self-theming HTML document. Set on the page's own root it decides the
     scrollbar and the form controls, and feeds nothing. */
  :root[data-rex-dark] {
    color-scheme: dark;${paperVariables(PAPER_DARK, ALERT_DARK, CODE_DARK, SELECT.dark)}
  }

  /* §4.3 — the whole of the width switch. */
  :root[data-rex-wide] { --paper-measure: none; }

  /* Spec 16 §9.1 — the side margin is the bar lane's paper as well as the
     page's. The renderer sets \`--rex-lane\` to what the lane needs in the
     PANE's pixels divided by the zoom, so the reserve survives zooming out;
     24px is the floor, for the zoom that makes the lane cost less than that. */
  body {
    margin: 0 auto;
    padding: 40px max(24px, var(--rex-lane, 24px)) 96px;
    max-width: var(--paper-measure);
    background: var(--paper-bg);
    color: var(--paper-ink-body);
    font: ${MEASURE.fontSize}/${MEASURE.lineHeight} "DM Sans", system-ui, -apple-system, sans-serif;
  }
  h1, h2, h3, h4, h5, h6 { color: var(--paper-ink); line-height: 1.2; margin: 30px 0 12px; }
  h1 { font-size: 27px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.15; margin-top: 0; }
  h2 { font-size: 20px; font-weight: 600; }
  h3 { font-size: 17px; font-weight: 600; }
  h4, h5, h6 { font-size: 15px; font-weight: 600; }
  p, ul, ol, blockquote, table, figure, pre { margin: 0 0 18px; }
  a { color: var(--paper-link); }
  code {
    background: var(--paper-wash);
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88em;
  }
  pre {
    background: var(--paper-wash);
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
    border-left: 2px solid var(--paper-rule);
    color: var(--paper-ink-muted);
  }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  th, td { border: 1px solid var(--paper-rule); padding: 7px 10px; text-align: left; }
  th { background: var(--paper-wash); font-weight: 600; color: var(--paper-ink); }
  figure { padding: 9px; border-radius: 4px; background: var(--figure-bg); }
  figcaption { margin-top: 7px; font-size: 12.5px; color: var(--figure-caption); }
  hr { border: none; border-top: 1px solid var(--paper-rule); margin: 30px 0; }
  img { max-width: 100%; }
  ::selection { background: var(--paper-select); }

  /* Alerts (§5.2) — the label is generated content, so it is never in the
     text index and never selectable. That is the point of the whole rule. */
  blockquote[data-alert] {
    margin-left: 0;
    padding: 10px 14px;
    border-left: 3px solid;
    border-radius: 0 4px 4px 0;
    color: var(--paper-ink-body);
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
    accent-color: var(--paper-link);
  }

  /* Figures (§5.4) — these rules existed before anything emitted a figure. */
  figure.rex-figure { margin: 0 0 18px; }

  /* Footnotes (§5.1) — markdown-it-footnote's own class names. */
  .footnotes { margin-top: 36px; padding-top: 12px; border-top: 1px solid var(--paper-rule); }
  .footnotes-list { padding-left: 20px; font-size: 13.5px; color: var(--paper-ink-muted); }
  .footnote-item p { margin: 0 0 8px; }
  .footnote-ref a { text-decoration: none; }
  .footnote-backref { text-decoration: none; }

  /* Headings carry an id (§5.5), so a table-of-contents jump should not put
     the target flush against the top of the pane. */
  h1[id], h2[id], h3[id], h4[id], h5[id], h6[id] { scroll-margin-top: 24px; }

  /* Code colour (§5.7) — highlight.js classes onto the paper palette. */
  .hljs-keyword, .hljs-built_in { color: var(--code-keyword); }
  .hljs-string, .hljs-regexp { color: var(--code-string); }
  .hljs-comment, .hljs-quote { color: var(--code-comment); font-style: italic; }
  .hljs-number, .hljs-literal { color: var(--code-number); }
  .hljs-title, .hljs-section { color: var(--code-title); }
  .hljs-attr, .hljs-attribute { color: var(--code-attr); }
  .hljs-meta { color: var(--code-meta); }

  /* Math (§5.6) — KaTeX's own stylesheet is linked separately. */
  .katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }

  /* Mermaid (§5.8) — a pre element that is no longer holding code. Until the
     pass draws it, the source stays visible as ordinary code, which is the
     fallback §4.2 rule 3 requires.

     Spec 27 §4.5 — no card, on either ground. A drawn diagram is REX's own
     drawing, so on the dark paper REX draws it again in Mermaid's dark theme
     rather than sitting it on a light patch. */
  pre.rex-mermaid[data-rendered] {
    white-space: normal;
    font-family: inherit;
    text-align: center;
    background: none;
    padding: 0;
  }
  pre.rex-mermaid[data-rendered] svg { max-width: 100%; height: auto; }
`;
