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
import { test } from "node:test";
import { askPrompt } from "../src/main/agent/prompts.ts";
import type { Anchor, AnchorTarget, Thread } from "../src/shared/types.ts";

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
