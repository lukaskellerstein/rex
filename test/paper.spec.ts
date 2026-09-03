// Spec 27 §7 milestone 0 — the dark paper, checked where a person cannot check it.
//
// Two of the three things below are the kind nobody notices by looking. A
// missing dark twin shows up as one heading that stayed near-black on a
// near-black ground, in one document, three weeks later. A contrast failure
// shows up as "that page is a bit hard to read" and never as a bug report. So
// both are arithmetic here rather than opinions in a review.
//
// The third is the extension test that decides whether the switches are drawn
// at all (§4.2). It is asserted against `node:path` — the module main uses and
// the renderer cannot — so the copy that both processes share cannot drift from
// what the dispatch actually does.
//
// No browser and no database: three pure modules.
//
// Run: npm run test:paper

import { strict as assert } from "node:assert";
import { extname } from "node:path";
import { test } from "node:test";
import { MARKDOWN_STYLESHEET } from "../src/main/render/stylesheet.ts";
import { extensionOf, isMarkdownPath } from "../src/shared/formats.ts";
import {
  ALERT,
  ALERT_DARK,
  CODE,
  CODE_DARK,
  PAPER,
  PAPER_DARK,
  SELECT,
} from "../src/shared/tokens.ts";

/** WCAG 2.x relative luminance, which is what a contrast ratio is built from. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(one: string, two: string): number {
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// ── The twins (§4.4) ────────────────────────────────────────────

test("every paper role has a dark twin, and no twin is the light value", () => {
  for (const role of Object.keys(PAPER) as Array<keyof typeof PAPER>) {
    assert.equal(typeof PAPER_DARK[role], "string", `PAPER_DARK is missing ${role}`);
    assert.notEqual(PAPER_DARK[role], PAPER[role], `${role} was never darkened`);
  }
  assert.equal(Object.keys(PAPER_DARK).length, Object.keys(PAPER).length);
});

test("every code class has a dark twin", () => {
  for (const role of Object.keys(CODE) as Array<keyof typeof CODE>) {
    assert.equal(typeof CODE_DARK[role], "string", `CODE_DARK is missing ${role}`);
  }
  assert.equal(Object.keys(CODE_DARK).length, Object.keys(CODE).length);
});

test("every callout has a dark twin, and keeps its word", () => {
  for (const kind of Object.keys(ALERT) as Array<keyof typeof ALERT>) {
    const dark = ALERT_DARK[kind];
    assert.ok(dark, `ALERT_DARK is missing ${kind}`);
    assert.notEqual(dark.rule, ALERT[kind].rule, `${kind}'s rule was never lifted`);
    assert.notEqual(dark.bg, ALERT[kind].bg, `${kind}'s wash was never darkened`);
  }
  assert.equal(Object.keys(ALERT_DARK).length, Object.keys(ALERT).length);
});

// ── Contrast (§4.4) ─────────────────────────────────────────────
//
// 4.5:1 is WCAG AA for body text. The washes are grounds rather than inks, so
// they are tested the other way round: a ground has to stay CLOSE to the paper,
// or a table header reads as a box drawn round itself.

test("every dark ink reads on the dark paper", () => {
  for (const role of ["ink", "inkBody", "inkMuted", "link"] as const) {
    const ratio = contrast(PAPER_DARK[role], PAPER_DARK.bg);
    assert.ok(ratio >= 4.5, `PAPER_DARK.${role} is ${ratio.toFixed(2)}:1 on the dark paper`);
  }
});

test("every callout rule reads on its own dark wash", () => {
  for (const kind of Object.keys(ALERT_DARK) as Array<keyof typeof ALERT_DARK>) {
    const tone = ALERT_DARK[kind];
    const ratio = contrast(tone.rule, tone.bg);
    assert.ok(ratio >= 4.5, `${kind} is ${ratio.toFixed(2)}:1 against its own wash`);
  }
});

test("every callout wash reads as paper rather than as a panel", () => {
  for (const kind of Object.keys(ALERT_DARK) as Array<keyof typeof ALERT_DARK>) {
    const ratio = contrast(ALERT_DARK[kind].bg, PAPER_DARK.bg);
    assert.ok(ratio < 2, `${kind}'s wash is ${ratio.toFixed(2)}:1 off the paper`);
  }
});

test("body text reads on a callout wash and on the code wash", () => {
  for (const kind of Object.keys(ALERT_DARK) as Array<keyof typeof ALERT_DARK>) {
    const ratio = contrast(PAPER_DARK.inkBody, ALERT_DARK[kind].bg);
    assert.ok(ratio >= 4.5, `body text is ${ratio.toFixed(2)}:1 on ${kind}`);
  }
  const onWash = contrast(PAPER_DARK.inkBody, PAPER_DARK.wash);
  assert.ok(onWash >= 4.5, `body text is ${onWash.toFixed(2)}:1 on the code wash`);
});

test("every dark code colour reads on the code wash", () => {
  for (const role of Object.keys(CODE_DARK) as Array<keyof typeof CODE_DARK>) {
    const ratio = contrast(CODE_DARK[role], PAPER_DARK.wash);
    assert.ok(ratio >= 4.5, `CODE_DARK.${role} is ${ratio.toFixed(2)}:1 on the code wash`);
  }
});

test("the dark paper is a sheet on the desk, not the desk", () => {
  // `--bg: #0e1012` and `--panel: #191c1f`, both from `overlay.css`. A paper
  // that matched either would stop being a separate surface — and two dark
  // greys are exactly the pair a person cannot judge by looking at one of them.
  // The shell's own ground-to-panel step is 1.11:1, so the paper must clear it.
  assert.ok(contrast(PAPER_DARK.bg, "#0e1012") >= 1.15, "the paper melts into the shell");
  assert.ok(contrast(PAPER_DARK.bg, "#191c1f") >= 1.05, "the paper melts into the sidebar");
});

test("a selection is visible on both grounds", () => {
  assert.ok(contrast(PAPER.ink, SELECT.light) >= 4.5);
  assert.ok(contrast(PAPER_DARK.inkBody, SELECT.dark) >= 4.5);
});

// ── The stylesheet (§5.2) ───────────────────────────────────────

test("the stylesheet carries both grounds and both widths", () => {
  assert.match(MARKDOWN_STYLESHEET, /:root\[data-rex-dark\]/);
  assert.match(MARKDOWN_STYLESHEET, /:root\[data-rex-wide\] \{ --paper-measure: none; \}/);
  assert.ok(MARKDOWN_STYLESHEET.includes(PAPER_DARK.bg), "the dark ground is not in the sheet");
  assert.ok(MARKDOWN_STYLESHEET.includes(ALERT_DARK.caution.rule), "the dark callouts are not");
  assert.ok(MARKDOWN_STYLESHEET.includes(CODE_DARK.keyword), "the dark code colours are not");
});

test("no rule names a colour that only one ground has", () => {
  // Every colour is a custom property, which is what lets one attribute repaint
  // the page. A literal left behind in a rule would be a value the dark block
  // cannot reach — and it would look right until somebody pressed T.
  const rules = MARKDOWN_STYLESHEET.slice(MARKDOWN_STYLESHEET.indexOf("  body {"));
  const literals = rules.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  assert.deepEqual(literals, [], `a rule still names ${literals.join(", ")}`);
});

test("the figure card stays light on the dark paper", () => {
  // §4.5 — an image is the author's and REX does not invert it, so `--figure-bg`
  // is defined once and never redefined in the dark block.
  const dark = MARKDOWN_STYLESHEET.slice(MARKDOWN_STYLESHEET.indexOf(":root[data-rex-dark]"));
  const block = dark.slice(0, dark.indexOf("\n  }"));
  assert.ok(!block.includes("--figure-bg"), "the dark block overrides the figure card");
  assert.match(MARKDOWN_STYLESHEET, /--figure-bg: #f2f0ec;/);
});

test("the stylesheet still holds no angle bracket", () => {
  // The rule at the top of `stylesheet.ts`: DOMPurify's mXSS guard deletes any
  // element whose text matches `/</[\w!]/`, and a `style` element holding CSS is
  // that shape. `test/markdown.spec.ts` asserts this too; spec 27 rewrote most
  // of the file, which is exactly when it would have been reintroduced.
  assert.ok(!MARKDOWN_STYLESHEET.includes("<"));
});

// ── The extension test (§5.2) ───────────────────────────────────

test("the shared extension test agrees with node:path", () => {
  const paths = [
    "/docs/a.md",
    "/docs/a.MD",
    "/docs/a.markdown",
    "/docs/a.mdown",
    "/docs/a.mkd",
    "/docs/a.html",
    "/docs/a.pdf",
    "/docs/a.docx",
    "/docs/a.pptx",
    "/docs/notes.md/a.pdf",
    "/docs/no-extension",
    "/docs/.md",
    "/a folder, renamed/report.md",
  ];
  for (const path of paths) {
    assert.equal(extensionOf(path), extname(path).toLowerCase(), path);
  }
});

test("only Markdown gets the switches", () => {
  assert.ok(isMarkdownPath("/docs/a.md"));
  assert.ok(isMarkdownPath("/docs/A.MARKDOWN"));
  assert.ok(!isMarkdownPath("/docs/a.html"));
  assert.ok(!isMarkdownPath("/docs/a.docx"));
  assert.ok(!isMarkdownPath("/docs/a.pdf"));
  assert.ok(!isMarkdownPath("/docs/a.pptx"));
  // The directory is not the document: a PDF inside `notes.md/` is a PDF.
  assert.ok(!isMarkdownPath("/docs/notes.md/a.pdf"));
});
