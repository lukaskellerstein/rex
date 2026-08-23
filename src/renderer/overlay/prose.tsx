// An agent's answer, rendered as the Markdown it is written in.
//
// The agent writes Markdown because it is a language model and that is what
// they write: `**Passage 1**`, `## What the block does`, ```` ```console ````,
// `- ` bullets, and backticked citations like `one/sample-document.md:32-42`.
// Shown verbatim in a `pre-wrap` paragraph, every one of those markers is
// noise sitting between the reviewer and the sentence — and the citations,
// which are the most useful thing in a REX answer, are the worst affected: a
// path in backticks reads as a path in backticks rather than as code.
//
// DELIBERATELY NOT `src/main/render/markdown.ts`. That renderer exists to turn
// a *document under review* into something anchors can be resolved against, and
// it carries the machinery for it: `data-src-line` on every block, KaTeX,
// highlight.js, footnotes, alert callouts, GitHub heading slugs. None of that
// belongs on a chat message — the answer has no source file, nothing anchors
// into it, and its headings must not mint ids that collide with the document's.
//
// So this is a second, much smaller renderer with a different job, and its
// settings are chosen for a surface that shows untrusted model output inside
// REX's own chrome (invariant I2):
//
//   · `html: false` — raw HTML in the source is ESCAPED, never passed through.
//     This is the primary defence, and it runs before DOMPurify sees anything.
//   · DOMPurify with an explicit tag allow-list and NO attributes at all, as
//     the independent second layer. Same belt-and-braces reasoning as
//     `sanitise.ts`, which pairs DOMPurify with a scriptless iframe.
//   · No `<a>`. A link in REX's overlay is not a document link — the overlay
//     is the app's own window, so following one would navigate the whole of REX
//     away from the document under review. DOMPurify drops the tag and keeps
//     its text, so the words survive and the navigation cannot happen.
//   · `linkify: false`, so a bare URL in an answer does not silently become one
//     of the anchors that were just ruled out.

import DOMPurify from "dompurify";
import createMarkdownIt from "markdown-it";
import { useMemo } from "react";

const md = createMarkdownIt({
  html: false,
  linkify: false,
  // A model's single newline is a line break, not the paragraph continuation
  // CommonMark would fold it into. Answers are written to be read as typed.
  breaks: true,
  typographer: false,
});

/**
 * What an answer is allowed to contain. Structure and emphasis only: nothing
 * here loads a resource, runs anything, or navigates.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

/** Markdown → HTML safe to put inside REX's own shadow root. */
export function renderProse(text: string): string {
  return DOMPurify.sanitize(md.render(text), {
    ALLOWED_TAGS,
    // No attribute is needed to render an answer, so none is permitted. That
    // includes `class`: the language on a fence is dropped, because nothing
    // here highlights and an attribute allowed "just in case" is an attribute
    // nobody is checking.
    ALLOWED_ATTR: [],
  });
}

/**
 * One block of agent prose.
 *
 * Memoised on the text: a card re-renders whenever a place is hovered or the
 * resolution sweep runs, and re-parsing a long answer on a mouse move is work
 * nobody asked for.
 */
export function Prose({ text }: { text: string }): React.JSX.Element {
  const html = useMemo(() => renderProse(text), [text]);
  // `renderProse` is markdown-it with `html: false`, then DOMPurify with a tag
  // allow-list and no attributes at all — the two independent layers this
  // file's header describes. Turning Markdown into markup is the module's
  // whole purpose, so the warning is answered rather than avoidable.
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by renderProse — see above
    <div className="rex-prose" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
