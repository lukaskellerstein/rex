// §8.6 — the Ask prompt, and what a multi-target comment adds to it.
//
// A comment written against three rows is one question about three places. If
// the prompt carries only the first, the agent answers about the first and
// sounds confident doing it — a wrong answer, not a missing one. So the second
// and third passages being in the prompt is worth an assertion.
//
// No browser, no database, no agent: `askPrompt` is a pure function of a
// thread.
//
// Run: npm run test:prompts

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { askPrompt } from "../src/main/agent/prompts.ts";
import type { Anchor, Thread } from "../src/shared/types.ts";

const DOCUMENT = "/tmp/rex-prompts-spec/does-not-exist.md";

function anchorQuoting(exact: string): Anchor {
  return {
    quote: { exact, prefix: "", suffix: "" },
    position: null,
    element: null,
    region: null,
    source: null,
  };
}

function threadWith(anchor: Anchor | null, extraAnchors: Anchor[]): Thread {
  return {
    id: "t1",
    documentId: "d1",
    kind: "anchored",
    status: "open",
    anchor,
    extraAnchors,
    anchorState: "ok",
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

test("a one-target comment carries its passage and no 'also' section", () => {
  const prompt = askPrompt({
    thread: threadWith(anchorQuoting("The retry budget is 3."), []),
    documentPath: DOCUMENT,
    repositoryRoot: "/tmp/rex-prompts-spec",
  });

  assert.match(prompt, /## Highlighted passage/);
  assert.match(prompt, /The retry budget is 3\./);
  assert.equal(prompt.includes("## Also highlighted"), false);
  assert.match(prompt, /These three do not agree with each other\./);
});

test("every extra anchor's passage reaches the agent", () => {
  const prompt = askPrompt({
    thread: threadWith(anchorQuoting("The retry budget is 3."), [
      anchorQuoting("Retries are capped at five."),
      anchorQuoting("No retry is attempted."),
    ]),
    documentPath: DOCUMENT,
    repositoryRoot: "/tmp/rex-prompts-spec",
  });

  assert.match(prompt, /## Also highlighted/);
  assert.match(prompt, /1\. Retries are capped at five\./);
  assert.match(prompt, /2\. No retry is attempted\./);
  // The primary still leads: it is the one Apply writes back through.
  assert.ok(prompt.indexOf("The retry budget is 3.") < prompt.indexOf("## Also highlighted"));
});

test("an extra anchor with no quote is left out rather than listed blank", () => {
  const quoteless: Anchor = {
    quote: null,
    position: null,
    element: { css: "figure:nth-of-type(2)" },
    region: null,
    source: null,
  };
  const prompt = askPrompt({
    thread: threadWith(anchorQuoting("The retry budget is 3."), [quoteless]),
    documentPath: DOCUMENT,
    repositoryRoot: "/tmp/rex-prompts-spec",
  });

  assert.equal(prompt.includes("## Also highlighted"), false);
});
