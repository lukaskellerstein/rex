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
import {
  askPrompt,
  documentHeader,
  followUpPrompt,
  passageSection,
  withEvents,
  writeInstructions,
} from "../src/main/agent/prompts.ts";
import { tagsFor } from "../src/main/agent/tags.ts";
import {
  eventsSinceLastAnswer,
  renderTranscript,
  replayPrompt,
} from "../src/main/agent/transcript.ts";
import type { Anchor, AnchorTarget, Message, Thread } from "../src/shared/types.ts";

/**
 * Spec 54 §5 — the tags a builder chooses when nothing in the thread spells
 * one. Every fixture below is ordinary prose, so this is what they all get, and
 * asserting the bare names keeps the assertions readable. `tags.spec.ts` owns
 * the collision case.
 */
const BARE = tagsFor("");

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

function target(documentId: string, anchor: Anchor, messageId: string | null = null): AnchorTarget {
  return { documentId, anchor, state: "ok", messageId };
}

function threadWith(targets: AnchorTarget[]): Thread {
  return {
    id: "t1",
    documentId: targets[0]?.documentId ?? "d1",
    kind: "anchored",
    status: "open",
    targets,
    note: "These three do not agree with each other.",
    title: null,
    groupId: null,
    position: 0,
    sessionId: null,
    profile: "read",
    style: null,
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

test("a one-document comment carries its places inside one document block", () => {
  const prompt = promptFor([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d1", anchorQuoting("No retry is attempted.")),
  ]);

  assert.match(prompt, /^<rex-document path="does-not-exist\.md">$/m);
  assert.match(prompt, /<rex-section n="1">\nThe retry budget is 3\.\n<\/rex-section>/);
  assert.match(prompt, /<rex-section n="2">\nNo retry is attempted\.\n<\/rex-section>/);
  // Spec 54 §4 — one tag per place, holding the pick itself. The list beside a
  // section is gone, and so are the two tags that wrapped it.
  assert.equal(prompt.includes("<rex-passages"), false);
  assert.equal(prompt.includes("<rex-file"), false);
  assert.match(prompt, /These three do not agree with each other\./);
  assert.equal((prompt.match(/<rex-document /g) ?? []).length, 1);
});

test("targets in two documents are grouped, and keep their own numbers", () => {
  const prompt = promptFor([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d2", anchorQuoting("Retries are capped at five.")),
    target("d1", anchorQuoting("No retry is attempted.")),
  ]);

  assert.match(prompt, /<rex-document path="does-not-exist\.md">/);
  assert.match(prompt, /<rex-document path="shared\/components\.md">/);
  // The number is the target's position in the comment, not its position in its
  // document: it is the number the reviewer saw in the panel and on the outline.
  // So document one holds 1 and 3 while document two holds 2.
  assert.match(prompt, /<rex-section n="1">\nThe retry budget is 3\./);
  assert.match(prompt, /<rex-section n="2">\nRetries are capped at five\./);
  assert.match(prompt, /<rex-section n="3">\nNo retry is attempted\./);
  assert.ok(prompt.indexOf('n="3"') < prompt.indexOf("shared/components.md"));
});

test("a target outside the repository root is written absolute", () => {
  const prompt = promptFor([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d3", anchorQuoting("The gateway retries twice.")),
  ]);

  // A relative path that climbs out of the tree tells the agent less than the
  // real one, so it is not written as `../somewhere-else/api.md`.
  assert.match(prompt, /<rex-document path="\/tmp\/somewhere-else\/api\.md">/);
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
  // Spec 54 §4 — no text and no way to get any, so the attributes are the whole
  // of what REX knows and there is no body to write.
  assert.match(prompt, /<rex-section n="2" element="figure:nth-of-type\(2\)"\/>/);
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

  // Spec 54 §4 — a whole-document pick is a fact about the document, so it is
  // an attribute on `rex-document` and there is nothing inside it.
  assert.match(prompt, /<rex-document path="does-not-exist\.md" whole="yes"\/>/);
  assert.match(prompt, /Read the document in full before answering\./);
  assert.equal(prompt.includes("<rex-section"), false);
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
  // Spec 54 §4 — the body is the section itself, read from the file, and the
  // range is an attribute. An h3 inside it does not end the run.
  assert.match(withLine, /<rex-section n="1" lines="3-10">/);
  assert.match(withLine, /## Roadmap\n\nPlanned for v1\.1\./);
  assert.match(withLine, /An h3 does not end an h2's run\./);
  assert.equal(withLine.includes("## FAQ"), false, "the run stops at the next h2");

  // DOCX carries no `data-src-line`, so there is no line to start from and the
  // section is named by its heading alone. A range that had to be guessed is
  // never printed.
  const withoutLine = askPrompt({
    thread: threadWith([target("d4", section(null))]),
    documentPaths: new Map([["d4", file]]),
    repositoryRoot: work,
  });
  // No `data-src-line`, so there is no range to compute and the stored heading
  // text is all there is. A range that had to be guessed is never printed.
  assert.match(withoutLine, /<rex-section n="1">\nRoadmap\n<\/rex-section>/);
  assert.equal(withoutLine.includes("lines="), false);
});

test("a drawn comment reads as any other — the pen leaves no trace in the prompt", () => {
  // Spec 06 §7.1 said the agent never hears the word "pen"; it now hears
  // nothing about the drawing at all. The circle is a way to fill the panel, so
  // once it has, the places ARE the comment and there is nothing else to say.
  // Reported on 2026-08-26.
  const drawn = threadWith([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d1", anchorQuoting("No retry is attempted.")),
  ]);
  const prompt = askPrompt({ thread: drawn, documentPaths: PATHS, repositoryRoot: ROOT });

  assert.equal(/\bpen\b/i.test(prompt), false);
  assert.equal(prompt.includes("circle"), false);
  assert.equal(prompt.includes("drew"), false);
  // The places themselves still arrive, in the order the panel left them in.
  assert.match(prompt, /<rex-section n="1">\nThe retry budget is 3\./);
  assert.match(prompt, /<rex-section n="2">\nNo retry is attempted\./);
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

  // The file cannot be read, so there is no range and the stored heading text
  // is the body. Spec 54 §4: the tag says it is a section, so the word does
  // not have to be written into REX's prose any more.
  assert.match(prompt, /<rex-section n="2">\n3\. Findings\n<\/rex-section>/);
  // A section is not a document, so it gets no read-in-full instruction.
  assert.equal(prompt.includes("Read the document in full"), false);
});

// ── Spec 12 §4.2 — the tail of an ACT prompt ────────────────────
//
// ACT sends the reviewer's own sentence as the instruction. Before spec 12 the
// instruction WAS the discussion: Apply read the whole transcript and inferred
// what to do from it, which is why it could not run until the agent had answered
// once, and why a reviewer who already knew what they wanted had to ask a
// question first.

test("§4.2 — the instruction and the discussion are two sections, never one", () => {
  const parts = writeInstructions(
    "YOU: is 1024 right?\nREX: it is the default.",
    "make it 2048",
    BARE,
  );
  const prompt = parts.join("\n");

  assert.match(prompt, /<rex-discussion>/);
  assert.match(prompt, /<rex-instruction>/);
  assert.match(prompt, /make it 2048/);
  // The conversation is still carried: ACT mid-thread means "yes, do that", and
  // "that" is only in the transcript.
  assert.match(prompt, /is 1024 right\?/);
});

/**
 * The order comes LAST, and that is the assertion worth keeping.
 *
 * A discussion can run to thousands of words of somebody thinking aloud, some
 * of it abandoned. The instruction is one sentence that supersedes all of it.
 * Put it first and it reads as the opening of a conversation that then changes
 * its mind.
 */
test("§4.2 — the instruction comes after the discussion, not before it", () => {
  const prompt = writeInstructions("YOU: what about 4096?", "make it 2048", BARE).join("\n");
  assert.ok(
    prompt.indexOf("<rex-instruction>") > prompt.indexOf("<rex-discussion>"),
    "the order must be the last thing the agent reads",
  );
});

test("§4.2 — an empty discussion is fine, because ACT no longer waits for one", () => {
  const prompt = writeInstructions("", "set the tile size to 2048", BARE).join("\n");
  // An empty discussion collapses to one self-closing tag (spec 54 §3).
  assert.match(prompt, /^<rex-discussion\/>/);
  assert.match(prompt, /<rex-instruction>\nset the tile size to 2048\n<\/rex-instruction>$/);
});

// ── Spec 24 §6 — a reply that points somewhere new ─────────────
//
// A comment can grow after it has been asked. The follow-up prompt has to name
// only the places this message added, with the numbers the reviewer saw on the
// chips — and the ACT prompt, which relists everything, has to say which places
// the discussion never had a chance to mention.

/** Three opening places, then two added with message `m2`. */
function grownThread(): Thread {
  return threadWith([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d1", anchorQuoting("No retry is attempted.")),
    target("d1", anchorQuoting("Back-off doubles each time.")),
    target("d2", anchorQuoting("Retries are capped at five."), "m2"),
    target("d3", anchorQuoting("The gateway retries twice."), "m2"),
  ]);
}

test("§6.1 — a follow-up lists only the new places, numbered on", () => {
  const prompt = followUpPrompt({
    thread: grownThread(),
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    from: 3,
    text: "Look — 4 says the opposite. Read it.",
  });

  assert.match(prompt, /^The reviewer has pointed at 2 more places/m);
  // The range the agent already knows, named, so `4.` reads as a continuation.
  assert.match(prompt, /1 to 3/);
  assert.match(prompt, /<rex-section n="4">\nRetries are capped at five\./);
  assert.match(prompt, /<rex-section n="5">\nThe gateway retries twice\./);
  // The opening three are NOT relisted: on a resumed session the agent has
  // them, and repeating them buries the two that matter.
  assert.equal(prompt.includes("The retry budget is 3."), false);
  assert.equal(prompt.includes("1."), false);
  assert.match(prompt, /<rex-comment>\nLook — 4 says the opposite\. Read it\.\n<\/rex-comment>$/);
  // The text comes last, after the places, as in the opening prompt.
  assert.ok(prompt.indexOf("<rex-comment>") > prompt.indexOf("The gateway retries twice."));
});

test("§6.1 — a single new document is still named, because nothing else names it", () => {
  const thread = threadWith([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d2", anchorQuoting("Retries are capped at five."), "m2"),
  ]);
  const prompt = followUpPrompt({
    thread,
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    from: 1,
    text: "Read this.",
  });
  // The opening prompt says `Document: …` at its top, so `passageSection` skips
  // a lone heading there. A follow-up has no such line.
  assert.match(prompt, /<rex-document path="shared\/components\.md">/);
  assert.match(prompt, /1 more place\b/);
  assert.match(prompt, /<rex-section n="2">\nRetries are capped at five\./);
});

test("§6.1 and spec 54 §4.3 — with nothing new the follow-up is the text, framed", () => {
  const prompt = followUpPrompt({
    thread: grownThread(),
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    from: 5,
    text: "Are you sure?",
  });
  // Spec 24 made this the bare text. Spec 54 §4.3 wraps it and nothing else:
  // if the reviewer's words are tagged on some turns and not on others, the
  // system prompt's "what the reviewer asks for is the text in <rex-comment>"
  // is false half the time. There is still no passage list and no prose.
  assert.equal(prompt, "<rex-comment>\nAre you sure?\n</rex-comment>");
});

test("§6.1 — a new whole-document place asks to be read in full", () => {
  const wholeDocument: Anchor = {
    quote: null,
    position: null,
    element: null,
    region: null,
    source: null,
    extent: "document",
  };
  const thread = threadWith([
    target("d1", anchorQuoting("The retry budget is 3.")),
    target("d2", wholeDocument, "m2"),
  ]);
  const prompt = followUpPrompt({
    thread,
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    from: 1,
    text: "Read it all.",
  });
  assert.match(prompt, /<rex-document path="shared\/components\.md" whole="yes"\/>/);
  assert.match(prompt, /Read the document in full before answering\./);
});

test("§6.2 — the ACT list marks the places this instruction added", () => {
  const lines = passageSection({
    thread: grownThread(),
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    tags: BARE,
    addedWith: "m2",
  }).join("\n");

  // Every place is listed — the ACT prompt is built fresh each run — and the
  // new ones say so, because `## The discussion` never mentions passages.
  assert.match(lines, /<rex-section n="1">\nThe retry budget is 3\./);
  assert.match(lines, /<rex-section n="4" added="yes">\nRetries are capped at five\./);
  assert.match(lines, /<rex-section n="5" added="yes">\nThe gateway retries twice\./);
  assert.equal((lines.match(/added="yes"/g) ?? []).length, 2);
});

test("§6.2 — a null `addedWith` marks nothing, not everything", () => {
  // `messageId` is null on every opening place. A null match would put the
  // marker on all three of them.
  const lines = passageSection({
    thread: grownThread(),
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    tags: BARE,
    addedWith: null,
  }).join("\n");
  assert.equal(lines.includes('added="yes"'), false);
});

// ── Spec 34 — the copy is permanent ──────────────────────────────

const COPY = "/tmp/rex-work/d1-id/does-not-exist.md";
const OTHER_COPY = "/tmp/rex-work/d2-id/components.md";

test("spec 34 §7 — the opening prompt names the document, and says once where to read it", () => {
  const prompt = askPrompt({
    thread: threadWith([target("d1", anchorQuoting("The retry budget is 3."))]),
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    readAt: new Map([["d1", COPY]]),
  });

  // The name is the reviewer's own path; the location is REX's copy.
  // The name is the reviewer's own path; the location is REX's copy, and both
  // are attributes of the one document block.
  assert.match(
    prompt,
    /<rex-document path="does-not-exist\.md" read-at="\/tmp\/rex-work\/d1-id\/does-not-exist\.md">/,
  );
  assert.match(prompt, /Each `read-at` is REX's copy and is the current version/);
});

test("spec 34 §7 — a second document's copy is listed too, and a deck's absence is not", () => {
  const prompt = askPrompt({
    thread: threadWith([
      target("d1", anchorQuoting("The retry budget is 3.")),
      target("d2", anchorQuoting("The gateway retries twice.")),
      target("d3", anchorQuoting("Retries are capped at five.")),
    ]),
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    // d3 has no copy — a deck, say — and so no line here.
    readAt: new Map([
      ["d1", COPY],
      ["d2", OTHER_COPY],
    ]),
  });

  // Spec 54 §4 — every document names its own copy, so `Also read at:` is gone
  // and with it the three lines it repeated. The sentence is said once.
  assert.match(
    prompt,
    /<rex-document path="shared\/components\.md" read-at="\/tmp\/rex-work\/d2-id\/components\.md">/,
  );
  // d3 has no copy — a deck, say — so it carries no `read-at` at all.
  assert.match(prompt, /<rex-document path="\/tmp\/somewhere-else\/api\.md">/);
  assert.equal(prompt.includes("Also read at"), false);
  assert.equal((prompt.match(/Each `read-at`/g) ?? []).length, 1);
});

test("spec 34 §7 — without a copy the opening prompt is exactly what it was", () => {
  const before = promptFor([target("d1", anchorQuoting("The retry budget is 3."))]);
  assert.equal(before.includes("read-at"), false);
  assert.equal(before.includes("Also read at"), false);
});

function message(partial: Partial<Message> & Pick<Message, "role" | "kind">): Message {
  return {
    id: "m",
    threadId: "t1",
    seq: 0,
    mode: null,
    model: null,
    style: null,
    // Spec 43 §5.3 — the evidence a run leaves. Null here is what a fixture
    // that was never produced by one honestly is.
    sdk: null,
    gatewayName: null,
    baseUrl: null,
    runId: null,
    content: null,
    toolName: null,
    toolInput: null,
    isError: false,
    denied: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    createdAt: "2026-09-02T00:00:00.000Z",
    ...partial,
  };
}

const APPROVED = "The reviewer approved the change. The file now holds it.";
const DISCARDED = "The reviewer discarded the change. The document is back to what the file holds.";

test("spec 34 §6.2 — a transcript carries the reviewer's act where it happened", () => {
  const transcript = renderTranscript([
    message({ role: "user", kind: "text", content: "Make it shorter." }),
    message({ role: "assistant", kind: "text", content: "Done — I cut the second paragraph." }),
    message({ role: "system", kind: "event", content: DISCARDED }),
    message({ role: "user", kind: "text", content: "Try again, but keep the example." }),
  ]);

  const lines = transcript.split("\n\n");
  assert.equal(lines[1], "Assistant: Done — I cut the second paragraph.");
  assert.equal(lines[2], DISCARDED, "between the answer and the next question, not at the end");
  assert.equal(lines[3], "User: Try again, but keep the example.");
});

test("spec 34 §6.2 — the events since the agent last spoke, and nothing older", () => {
  const events = eventsSinceLastAnswer([
    message({ role: "system", kind: "event", content: "The reviewer undid the last run." }),
    message({ role: "assistant", kind: "text", content: "An answer." }),
    message({ role: "system", kind: "event", content: APPROVED }),
    message({ role: "system", kind: "event", content: DISCARDED }),
    message({ role: "user", kind: "text", content: "The reply being sent." }),
  ]);
  assert.deepEqual(events, [APPROVED, DISCARDED], "oldest first, and only since the answer");
});

test("spec 34 §7 — a replayed session is told where the document is, once, at the top", () => {
  const header = documentHeader({
    thread: threadWith([target("d1", anchorQuoting("The retry budget is 3."))]),
    documentPaths: PATHS,
    repositoryRoot: ROOT,
    readAt: new Map([["d1", COPY]]),
  });
  const prompt = replayPrompt("User: earlier.\n\nAssistant: yes.", "And now?", header);

  assert.match(
    prompt,
    /^<rex-document path="does-not-exist\.md" read-at="\/tmp\/rex-work\/d1-id\/does-not-exist\.md"\/>/,
  );
  assert.match(prompt, /\n\nThis conversation continues an earlier discussion/);
  // Spec 54 §5.1 — the transcript is framed, and the message is not wrapped
  // again: it arrives already carrying its own tags.
  assert.match(prompt, /<rex-discussion>\nUser: earlier\.\n\nAssistant: yes\.\n<\/rex-discussion>/);
  assert.match(prompt, /The user now asks:\n\nAnd now\?$/);
  // Without a header the replay is exactly what it was.
  assert.match(replayPrompt("t", "m"), /^This conversation continues/);
});

test("spec 34 §6.2 — a reply says what happened once, and says nothing when nothing did", () => {
  assert.equal(withEvents([], "Is this better?"), "Is this better?", "the bare text, as always");

  const prefixed = withEvents([DISCARDED], "Is this better?");
  assert.match(prefixed, /^Since your last turn:\n- The reviewer discarded/);
  assert.match(prefixed, /\n\nIs this better\?$/);
});
