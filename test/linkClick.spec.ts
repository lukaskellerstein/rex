// Spec 53 §5.3 — what a clicked link resolves to.
//
// Spec 02's `resolveTarget()` is already pinned by `links.spec.ts`. This file
// tests only what a *click* adds to it: a file REX cannot render is refused
// rather than opened, and a URL scheme reaches the operating system only if it
// is on the list. The second of those is a guard, so the test is written as an
// attempt to get past it.
//
// Run: npm run test:link-click

import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkedExternalUrl,
  displayPath,
  EXTERNAL_SCHEMES,
  resolveForClick,
} from "../src/main/links.ts";

// The sample documents every test uses — read-only, see CLAUDE.md.
const DOCS = join(homedir(), "Projects/Github/lukaskellerstein/documentation-sample");
const DOCUMENT = join(DOCS, "one/sample-document.md");
const REPORT = join(DOCS, "two/sample-report.md");

test("a fragment is this document's own", () => {
  assert.deepEqual(resolveForClick(DOCUMENT, "#installation"), {
    kind: "self",
    fragment: "installation",
  });
  assert.deepEqual(resolveForClick(DOCUMENT, "#"), { kind: "self", fragment: null });
});

test("a sibling document resolves to its absolute path", () => {
  const answer = resolveForClick(REPORT, "sample-report.docx");
  assert.equal(answer.kind, "document");
  assert.equal(answer.kind === "document" && answer.path, join(DOCS, "two/sample-report.docx"));
  assert.equal(answer.kind === "document" && answer.fragment, null);
});

test("a document one level up, with a fragment, keeps both", () => {
  const answer = resolveForClick(REPORT, "../one/sample-document.md#quick-start");
  assert.equal(answer.kind, "document");
  assert.equal(answer.kind === "document" && answer.path, join(DOCS, "one/sample-document.md"));
  assert.equal(answer.kind === "document" && answer.fragment, "quick-start");
});

test("a file that is not there is refused by name, not opened", () => {
  // `sample-document.md` really links to this, and the file really is absent.
  const answer = resolveForClick(DOCUMENT, "./CONTRIBUTING.md");
  assert.equal(answer.kind, "refused");
  assert.equal(answer.kind === "refused" && answer.reason, "No such file: CONTRIBUTING.md");
});

test("a file REX cannot render is refused, and says which formats it does", () => {
  const answer = resolveForClick(DOCUMENT, "./scaling.png");
  assert.equal(answer.kind, "refused");
  assert.match(
    answer.kind === "refused" ? answer.reason : "",
    /^REX cannot open scaling\.png\. REX renders Markdown/,
  );
});

test("http, https and mailto go to the operating system", () => {
  for (const url of ["https://example.com/ci", "http://example.com", "mailto:a@example.com"]) {
    assert.deepEqual(resolveForClick(DOCUMENT, url), { kind: "external", url });
  }
});

test("a protocol-relative link is read as https", () => {
  assert.deepEqual(resolveForClick(DOCUMENT, "//example.com/x"), {
    kind: "external",
    url: "https://example.com/x",
  });
});

test("every other scheme is refused by name — the guard, tried on purpose", () => {
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vscode://file/etc/passwd",
    "ftp://example.com/x",
    "rex-doc://doc/etc/passwd",
  ]) {
    const answer = resolveForClick(DOCUMENT, url);
    assert.equal(answer.kind, "refused", `${url} must not become external`);
  }
});

test("the second check refuses the same set, whatever the renderer sends back", () => {
  assert.equal(checkedExternalUrl("https://example.com"), "https://example.com");
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
    assert.throws(() => checkedExternalUrl(url), /does not open|Not a URL/);
  }
});

test("the allow-list is three schemes and stays three", () => {
  assert.deepEqual([...EXTERNAL_SCHEMES].sort(), ["http:", "https:", "mailto:"]);
});

// ── Spec 53 §4.7 — what the hover tip is built from ────────────

test("a resolved document carries a path a person can read", () => {
  const answer = resolveForClick(REPORT, "../one/sample-document.md#quick-start");
  assert.equal(answer.kind, "document");
  const display = answer.kind === "document" ? answer.display : "";
  assert.equal(
    display,
    "~/Projects/Github/lukaskellerstein/documentation-sample/one/sample-document.md",
  );
  assert.ok(!display.includes(homedir()), "home is written ~, never spelled out");
});

test("displayPath leaves a path outside home alone", () => {
  assert.equal(displayPath("/etc/hosts"), "/etc/hosts");
  assert.equal(displayPath(homedir()), "~");
  // A sibling folder whose name merely STARTS with home's is not inside it.
  assert.equal(displayPath(`${homedir()}-backup/x.md`), `${homedir()}-backup/x.md`);
});

test("a refusal carries the path it would have opened, for the tip", () => {
  const missing = resolveForClick(DOCUMENT, "./CONTRIBUTING.md");
  assert.equal(missing.kind, "refused");
  assert.equal(
    missing.kind === "refused" && missing.display,
    "~/Projects/Github/lukaskellerstein/documentation-sample/one/CONTRIBUTING.md",
  );

  const picture = resolveForClick(DOCUMENT, "./scaling.png#top");
  assert.equal(picture.kind === "refused" && picture.fragment, "top");
});

test("a refused SCHEME has no path to show", () => {
  const answer = resolveForClick(DOCUMENT, "ftp://example.com/x");
  assert.equal(answer.kind, "refused");
  assert.equal(answer.kind === "refused" && answer.display, null);
});

test("whitespace around an href does not change the answer", () => {
  assert.deepEqual(resolveForClick(DOCUMENT, "  #installation  "), {
    kind: "self",
    fragment: "installation",
  });
});
