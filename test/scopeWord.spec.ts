// Spec 26 §7 milestone 0 — one vocabulary, as a unit.
//
// `scopeWord` is what the path bar's crumbs and the panel's chips both print,
// and the whole reason it exists is that they used to compute it separately and
// disagree: the bar said `td` where the chip said `cell`. A disagreement is
// invisible in a screenshot of either one alone, so it is asserted here rather
// than looked at.
//
// No DOM. A `PickScope` is a plain serialisable object by design — `pick.ts`
// keeps the live elements in a `ScopeChain` beside it, precisely so the
// described half can cross a process boundary.
//
// Run: npm run test:scope-word

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type PickScope, scopeWord } from "../src/renderer/anchor/pick.ts";

/** Everything `scopeWord` does not read, filled once. */
function scope(fields: Partial<PickScope>): PickScope {
  return {
    index: 0,
    kind: "element",
    label: "p",
    title: "Paragraph",
    detail: "",
    quote: null,
    strength: "fair",
    strengthNote: "",
    rect: { x: 0, y: 0, w: 0, h: 0 },
    regionCapable: false,
    ...fields,
  };
}

test("a tag becomes the word a reviewer chooses in", () => {
  const words: Array<[string, string]> = [
    ["td", "cell"],
    ["th", "cell"],
    ["tr", "row"],
    ["table", "table"],
    ["p", "paragraph"],
    ["li", "item"],
    ["ul", "list"],
    ["ol", "list"],
    ["pre", "code"],
    ["blockquote", "quote"],
    ["figure", "figure"],
    ["img", "image"],
    ["svg", "drawing"],
    ["div", "block"],
    ["h2", "heading"],
  ];
  for (const [label, expected] of words) {
    assert.equal(scopeWord(scope({ label })), expected, label);
  }
});

test("a tag with no word of its own keeps its tag", () => {
  // `dl` is not in the table. Falling through is the honest answer — inventing
  // a word for every element is how a chip ends up lying about what it takes.
  assert.equal(scopeWord(scope({ label: "dl" })), "dl");
});

test("a PDF's own labels pass through, because they are already words", () => {
  // `labelOf` refuses to call a page `div` and a line `span`, and this must not
  // undo that: neither string has a tag to look up.
  assert.equal(scopeWord(scope({ label: "page 2" })), "page 2");
  assert.equal(scopeWord(scope({ label: "line" })), "line");
});

test("a stable id survives, because it is what makes the anchor durable", () => {
  assert.equal(scopeWord(scope({ label: "section#retry-policy" })), "section #retry-policy");
  assert.equal(scopeWord(scope({ label: "p#intro" })), "paragraph #intro");
});

test("a long id is clipped rather than dropped", () => {
  const long = "a-very-long-hand-written-slug-nobody-would-type";
  assert.equal(scopeWord(scope({ label: `p#${long}` })), "paragraph #a-very-long-hand-written…");
});

test("text is text, whatever it encloses", () => {
  // A text scope has no element, so its label is the literal `text` — the word
  // is not read off a tag and must not try to be.
  assert.equal(scopeWord(scope({ kind: "text", label: "text" })), "text");
});

test("a section carries its heading, clipped", () => {
  assert.equal(
    scopeWord(scope({ extent: "section", label: "section “3. Findings”", quote: "3. Findings" })),
    "section “3. Findings”",
  );
  const long = scopeWord(
    scope({
      extent: "section",
      label: "section",
      quote: "3. Findings about the retry budget and its limits",
    }),
  );
  assert.equal(long, "section “3. Findings about the re…”");
});

test("a section with no heading text is still a section", () => {
  assert.equal(
    scopeWord(scope({ extent: "section", label: "section “”", quote: null })),
    "section",
  );
});

test("the whole document has nothing to identify it by", () => {
  // Spec 06 §4.3 — it names nothing inside the file, which is the entire point.
  assert.equal(scopeWord(scope({ extent: "document", label: "document" })), "document");
});

test("a gap keeps its own word", () => {
  // Spec 16 §6.2 — a gap has no tag and nothing to widen to.
  assert.equal(scopeWord(scope({ label: "gap" })), "gap");
});
