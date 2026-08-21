// Spec 02 §5.1 and §5.2 — link extraction and resolution.
//
// This is the half of the graph that has a right answer, so it is tested
// without a browser, a database or a layout engine. The drawing is judged by
// eye; this is judged by assertion.
//
// Run: npm run test:links

import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { extractLinks, indexByBasename, resolveTarget } from "../src/main/workspace/links.ts";

const DOCS = join(homedir(), "Projects/Github/redhat/ProtoBot/docs");
const COMPONENTS = join(DOCS, "architecture/components.md");

test("markdown links come from the token stream, not a pattern", () => {
  const source = [
    "# Title",
    "",
    "A real [link](overview.md) in prose.",
    "",
    "```md",
    "A [decoy](should-not-count.md) inside a fence.",
    "```",
    "",
    "    An [indented decoy](also-not.md) code block.",
    "",
    "[ref]: reference-style.md",
    "A [reference link][ref].",
  ].join("\n");

  const hrefs = extractLinks("/tmp/doc.md", source).map((link) => link.href);

  assert.ok(hrefs.includes("overview.md"), "prose link found");
  assert.ok(
    hrefs.includes("reference-style.md"),
    "reference-style link resolved to its definition",
  );
  // The whole reason for using markdown-it rather than a regular expression.
  assert.ok(!hrefs.includes("should-not-count.md"), "fenced code block is not a link");
  assert.ok(!hrefs.includes("also-not.md"), "indented code block is not a link");
});

test("markdown links carry the source line", () => {
  const source = ["# Title", "", "", "See [there](there.md).", ""].join("\n");
  const [link] = extractLinks("/tmp/doc.md", source);
  assert.equal(link.href, "there.md");
  assert.equal(link.line, 4);
});

test("html hrefs are extracted with their line", () => {
  const source = ["<p>one</p>", '<a href="sibling.html">two</a>'].join("\n");
  const [link] = extractLinks("/tmp/doc.html", source);
  assert.equal(link.href, "sibling.html");
  assert.equal(link.line, 2);
});

test("wikilinks are extracted, with and without a label", () => {
  const hrefs = extractLinks("/tmp/doc.md", "See [[Overview]] and [[Components|the parts]].").map(
    (link) => link.href,
  );
  assert.deepEqual(hrefs, ["Overview", "Components"]);
});

test("a scheme means it is a URL, and is never a node", () => {
  for (const href of [
    "https://example.com",
    "http://example.com",
    "mailto:a@b.c",
    "//cdn.example",
  ]) {
    assert.equal(resolveTarget(COMPONENTS, href).kind, "url", href);
  }
});

test("a bare fragment is a link to the same document", () => {
  assert.equal(resolveTarget(COMPONENTS, "#content-storage-model").kind, "self");
  assert.equal(resolveTarget(COMPONENTS, "").kind, "self");
});

test("a relative link resolves against the linking file and keeps its fragment", () => {
  const target = resolveTarget(COMPONENTS, "user-interaction-flow.md#phase-3-building-autonomous");
  assert.equal(target.kind, "file");
  if (target.kind !== "file") return;
  assert.equal(target.path, join(DOCS, "architecture/user-interaction-flow.md"));
  assert.equal(target.fragment, "phase-3-building-autonomous");
  assert.equal(target.exists, true);
});

test("a link that leaves the folder still resolves to the file it names", () => {
  const review = join(DOCS, "review/2026-08-20-architecture-explained.html");
  const target = resolveTarget(review, "../../comparison.html");
  assert.equal(target.kind, "file");
  if (target.kind !== "file") return;
  // Whether this counts as "external" is the graph's decision, not this file's.
  assert.equal(target.path, join(homedir(), "Projects/Github/redhat/ProtoBot/comparison.html"));
});

test("a target that does not exist is reported as not existing", () => {
  const target = resolveTarget(COMPONENTS, "no-such-document.md");
  assert.equal(target.kind, "file");
  if (target.kind !== "file") return;
  assert.equal(target.exists, false);
});

test("a link to a directory resolves to its index, or is broken", () => {
  const withIndex = resolveTarget(join(DOCS, "architecture/components.md"), ".");
  assert.equal(withIndex.kind, "file");
  if (withIndex.kind !== "file") return;
  // docs/architecture has no index.md or README.md, so a link to it is broken
  // rather than silently resolving to the directory itself.
  assert.equal(withIndex.exists, false);
});

test("a wikilink resolves by basename, and a tie is left broken", () => {
  const index = indexByBasename([
    "/w/docs/overview.md",
    "/w/a/duplicate.md",
    "/w/b/duplicate.md",
    "/w/shallow.md",
  ]);

  const unique = resolveTarget("/w/start.md", "Overview", index);
  assert.equal(unique.kind, "file");
  if (unique.kind === "file") assert.equal(unique.path, "/w/docs/overview.md");

  // Same depth on both sides: §5.1 says report it rather than pick one.
  const tie = resolveTarget("/w/start.md", "duplicate", index);
  assert.equal(tie.kind, "file");
  if (tie.kind === "file") assert.equal(tie.exists, false);
});

test("a PDF or a DOCX yields no links, whatever its bytes look like", () => {
  // A DOCX is a zip. Read as UTF-8 it becomes mojibake, and the mojibake still
  // matches `href="…"` and `[[…]]` — which put a node labelled with
  // replacement characters into the reference graph, linked from the DOCX.
  // Measured on 2026-08-21 against `sample-files/sample-document.docx`.
  const noise = `PK href="��t3C" [[��z=h]] href="real.md"`;

  assert.deepEqual(extractLinks("/w/report.docx", noise), []);
  assert.deepEqual(extractLinks("/w/report.pdf", noise), []);

  // The same bytes in a file REX *can* read as text are still read.
  assert.equal(extractLinks("/w/notes.html", noise).length, 3);
});
