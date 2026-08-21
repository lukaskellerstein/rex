// §8.6 and spec 05 §5.5 — the Ask prompt, and what a comment about several
// places in several documents adds to it.
//
// A comment written against three rows is one question about three places. If
// the prompt carries only the first, the agent answers about the first and
// sounds confident doing it — a wrong answer, not a missing one. So every
// passage being in the prompt, under the document it came from, is worth an
// assertion.
//
// No browser, no database, no agent: `askPrompt` is a pure function of a
// thread.
//
// Run: npm run test:prompts

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { askPrompt } from "../src/main/agent/prompts.ts";
import type { Anchor, AnchorTarget, Thread } from "../src/shared/types.ts";

/** Spec 06 §7.1 needs a real source file — the section's range is computed. */
const work = mkdtempSync(join(tmpdir(), "rex-prompts-"));
after(() => rmSync(work, { recursive: true, force: true }));

const ROOT = "/tmp/rex-prompts-spec";
const DOCUMENT = `${ROOT}/does-not-exist.md`;
const OTHER = `${ROOT}/shared/components.md`;
const OUTSIDE = "/tmp/somewhere-else/api.md";

/** documentId → absolute path, as `ipc.ts` builds it from the document table. */
const PATHS = new Map([
  ["d1", DOCUMENT],
  ["d2", OTHER],
  ["d3", OUTSIDE],
]);

function anchorQuoting(exact: string): Anchor {
  return {
    quote: { exact, prefix: "", suffix: "" },
    position: null,
    element: null,
    region: null,
    source: null,
  };
}

function target(documentId: string, anchor: Anchor): AnchorTarget {
  return { documentId, anchor, state: "ok" };
}

function threadWith(targets: AnchorTarget[]): Thread {
  return {
    id: "t1",
    documentId: targets[0]?.documentId ?? "d1",
    kind: "anchored",
    status: "open",
    targets,
    note: "These three do not agree with each other.",
    sessionId: null,
    profile: "read",
    model: null,
    refThreadIds: [],
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    resolvedAt: null,
  };
}

function promptFor(targets: AnchorTarget[]): string {
  return askPrompt({
    thread: threadWith(targets),
    documentPaths: PATHS,
    repositoryRoot: ROOT,
  });
}

test("a one-document comment carries its passages and no per-file headings", () => {
  const prompt = promptFor([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d1", anchorQuoting("No retry is attempted.")),
  ]);

  assert.match(prompt, /## Highlighted passages/);
  assert.match(prompt, /1\. The retry budget is 3\./);
  assert.match(prompt, /2\. No retry is attempted\./);
  // One document is already named at the top; a lone `### file.md` would read
  // as if a second heading were missing.
  assert.equal(prompt.includes("###"), false);
  assert.match(prompt, /These three do not agree with each other\./);
});

test("targets in two documents are grouped, and keep their own numbers", () => {
  const prompt = promptFor([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d2", anchorQuoting("Retries are capped at five.")),
    target("d1", anchorQuoting("No retry is attempted.")),
  ]);

  assert.match(prompt, /### does-not-exist\.md/);
  assert.match(prompt, /### shared\/components\.md/);
  // The number is the target's position in the comment, not its position in its
  // group: it is the number the reviewer saw in the panel and on the outline.
  assert.match(prompt, /1\. The retry budget is 3\./);
  assert.match(prompt, /2\. Retries are capped at five\./);
  assert.match(prompt, /3\. No retry is attempted\./);
});

test("a target outside the repository root is written absolute", () => {
  const prompt = promptFor([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d3", anchorQuoting("The gateway retries twice.")),
  ]);

  // A relative path that climbs out of the tree tells the agent less than the
  // real one, so it is not written as `../somewhere-else/api.md`.
  assert.match(prompt, /### \/tmp\/somewhere-else\/api\.md/);
  assert.equal(prompt.includes("../somewhere-else"), false);
});

test("a target with no text is described rather than dropped", () => {
  const quoteless: Anchor = {
    quote: null,
    position: null,
    element: { css: "figure:nth-of-type(2)" },
    region: null,
    source: null,
  };
  const prompt = promptFor([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d1", quoteless),
  ]);

  // Spec 04 dropped these, so a comment about a table and a paragraph reached
  // the agent as a comment about a paragraph — and it answered confidently
  // about the half it could see.
  assert.match(prompt, /2\. \(no text — an element anchor: figure:nth-of-type\(2\)\)/);
});

// ── Spec 06 §7.1 — the two scopes that cover more than one element ──
//
// A scope the prompt does not explain is a scope that changes nothing. Both of
// these reach the agent as ordinary text targets, so what that text says is the
// whole of what the feature does at this end.

test("a document target says so, and asks to be read in full", () => {
  const wholeDocument: Anchor = {
    quote: null,
    position: null,
    element: null,
    region: null,
    source: null,
    extent: "document",
  };
  const prompt = promptFor([target("d1", wholeDocument)]);

  assert.match(prompt, /1\. the whole document/);
  assert.match(prompt, /Read the document in full before answering\./);
  // §7.1 — there is no line, and a wrong one sends the agent to the wrong
  // place. A document anchor carries no `source`, so the header cannot appear.
  assert.equal(/^Line:/m.test(prompt), false);
  // The surrounding section of the whole document is the whole document.
  assert.equal(prompt.includes("## Surrounding section"), false);
  // Without the extent it would read "(no text and no element — a stored
  // position only)", which is true of the anchor and useless about the comment.
  assert.equal(prompt.includes("no text and no element"), false);
});

test("a section names its line range on Markdown, and omits it on DOCX", () => {
  // A real file, because the range is *computed* from the source rather than
  // stored: `Anchor.source.line` is where the heading was, and where the run
  // ends is a question only the file can answer.
  const file = join(work, "roadmap.md");
  writeFileSync(
    file,
    [
      "# Tilecat", // 1
      "", // 2
      "## Roadmap", // 3
      "", // 4
      "Planned for v1.1.", // 5
      "", // 6
      "### Next quarter", // 7
      "", // 8
      "An h3 does not end an h2's run.", // 9
      "", // 10
      "## FAQ", // 11
      "", // 12
      "Does it?", // 13
    ].join("\n"),
  );

  const section = (line: number | null): Anchor => ({
    quote: { exact: "Roadmap", prefix: "", suffix: "" },
    position: null,
    element: { id: "roadmap" },
    region: null,
    source: line === null ? null : { file, line },
    extent: "section",
  });

  const withLine = askPrompt({
    thread: threadWith([target("d4", section(3))]),
    documentPaths: new Map([["d4", file]]),
    repositoryRoot: work,
  });
  // Lines 3 to 10: the heading, through the last line before `## FAQ`. The `###`
  // inside it does not end the run, because only a same-or-higher rank does.
  assert.match(withLine, /Section "Roadmap" — lines 3–10/);

  // DOCX carries no `data-src-line`, so there is no line to start from and the
  // section is named by its heading alone. A range that had to be guessed is
  // never printed.
  const withoutLine = askPrompt({
    thread: threadWith([target("d4", section(null))]),
    documentPaths: new Map([["d4", file]]),
    repositoryRoot: work,
  });
  assert.match(withoutLine, /1\. Section "Roadmap"$/m);
  assert.equal(withoutLine.includes("lines"), false);
});

test("a drawn comment carries its one line, and the agent never hears 'pen'", () => {
  const drawn: Thread = {
    ...threadWith([
      target("d1", anchorQuoting("The retry budget is 3.")),
      target("d1", anchorQuoting("No retry is attempted.")),
    ]),
    stroke: { paths: [[{ x: 0.1, y: 0.2 }]], width: 2.5 },
  };
  const prompt = askPrompt({ thread: drawn, documentPaths: PATHS, repositoryRoot: ROOT });

  assert.match(prompt, /The reviewer drew a circle around these, in this order\./);
  // §7.1 — the prompt stays text and the targets stay ordinary targets. That an
  // agent which never hears the word still answers correctly is the test of
  // whether §5.3 was designed properly.
  assert.equal(/\bpen\b/i.test(prompt), false);

  // And a comment that was not drawn says nothing about a circle.
  assert.equal(
    promptFor([target("d1", anchorQuoting("The retry budget is 3."))]).includes("circle"),
    false,
  );
});

test("a section target is named by its heading, not quoted as one", () => {
  const section: Anchor = {
    quote: { exact: "3. Findings", prefix: "", suffix: "" },
    position: null,
    element: { id: "findings" },
    region: null,
    source: null,
    extent: "section",
  };
  const prompt = promptFor([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d1", section),
  ]);

  // `Section "3. Findings"`, not a bare `3. Findings`: the anchor stores the
  // heading's text (§4.3), and printing it bare tells the agent the comment is
  // about a title rather than about everything under it.
  assert.match(prompt, /2\. Section "3\. Findings"/);
  // A section is not a document, so it gets no read-in-full instruction.
  assert.equal(prompt.includes("Read the document in full"), false);
});
