// Spec 38 §3 — the trace's blocks as data: the rows, their previews, their
// counts, and the diff that folds into its change.
//
// Run: npm run test:trace

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { placesByMessage } from "../src/renderer/overlay/placeLine.ts";
import {
  changeCounts,
  fieldsOf,
  foldSize,
  PREVIEW_MAX,
  previewOf,
  traceOf,
} from "../src/renderer/overlay/trace.ts";
import type { AnchorTarget, Message, ThreadWithMessages } from "../src/shared/types.ts";

/**
 * A thread, built in the order its messages arrive: `seq` is the position in
 * the list, which is what the walk sorts by. `traceOf` reads `messages` and
 * `profile` and nothing else of the thread.
 */
function thread(rows: Array<[Message["kind"], Partial<Message>]>): ThreadWithMessages {
  const messages = rows.map(([kind, extra], position) => ({
    id: `m${position + 1}`,
    threadId: "t",
    seq: position + 1,
    role: "assistant",
    kind,
    content: null,
    toolName: null,
    toolInput: null,
    isError: false,
    denied: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    model: null,
    style: null,
    mode: null,
    createdAt: "2026-09-02T13:06:00.000Z",
    ...extra,
  })) as Message[];
  return { messages, profile: "read" } as unknown as ThreadWithMessages;
}

const you = (text: string, extra: Partial<Message> = {}): [Message["kind"], Partial<Message>] => [
  "text",
  { role: "user", content: text, mode: "ask", ...extra },
];
const said = (text: string, extra: Partial<Message> = {}): [Message["kind"], Partial<Message>] => [
  "text",
  { content: text, ...extra },
];
const call = (
  toolName: string,
  input: Record<string, unknown> = {},
): [Message["kind"], Partial<Message>] => ["tool_call", { toolName, toolInput: input }];
const result = (
  content: string,
  extra: Partial<Message> = {},
): [Message["kind"], Partial<Message>] => ["tool_result", { content, ...extra }];
const diff = (path: string, lines: string[]): [Message["kind"], Partial<Message>] => [
  "diff",
  { content: [path, ...lines].join("\n") },
];

const PATH = "/Users/lukas/.rex/work/74a06aa7/lukas-feedback.new.md";

test("spec 38 §3.3 — a READ has an INPUT row: every field, strings as they are and the rest as JSON", () => {
  const entries = traceOf(
    thread([
      you("?"),
      call("Read", { file_path: PATH, offset: 495, limit: 130 }),
      result("   495→## 7b."),
    ]),
  );
  const read = entries[1];
  assert.equal(read.label, "READ");
  assert.equal(read.body, PATH, "the preview is the path");
  assert.deepEqual(read.fields, [
    ["file_path", PATH],
    ["offset", "495"],
    ["limit", "130"],
  ]);
  assert.equal(read.what, null, "a Read has no description");
  assert.equal(read.result, "   495→## 7b.");
});

test("spec 38 §3.3 — the head carries Bash's description, and INPUT lists it with the command", () => {
  const [, bash] = traceOf(
    thread([
      you("?"),
      call("Bash", {
        command: "sed -n '1582,1614p' components.md",
        description: "Verify cited line ranges in components.md",
      }),
      result("| `change_set_id` | string |"),
    ]),
  );
  assert.equal(bash.what, "Verify cited line ranges in components.md");
  assert.equal(bash.body, "sed -n '1582,1614p' components.md");
  assert.deepEqual(
    bash.fields.map(([key]) => key),
    ["command", "description"],
  );
});

test("spec 38 §3.3 — a row's preview is its first line with words in it, cut at 96", () => {
  assert.equal(previewOf("\n\n941:## 7b. Traceability\nmore"), "941:## 7b. Traceability");
  const long = "x".repeat(PREVIEW_MAX + 10);
  assert.equal(previewOf(long).length, PREVIEW_MAX);
  assert.ok(previewOf(long).endsWith("…"));
  assert.equal(previewOf(""), "");

  assert.equal(foldSize("one\ntwo\nthree"), "3 lines");
  assert.equal(foldSize("File does not exist."), "20 chars");
});

test("spec 38 §3.3 — fieldsOf prints a value that is not a string as JSON, and hides what it is told to", () => {
  assert.deepEqual(fieldsOf({ replace_all: false, paths: ["a", "b"], n: null }), [
    ["replace_all", "false"],
    ["paths", '["a","b"]'],
    ["n", "null"],
  ]);
  assert.deepEqual(fieldsOf({ a: "1", b: "2" }, new Set(["b"])), [["a", "1"]]);
  assert.deepEqual(fieldsOf(null), []);
  assert.deepEqual(fieldsOf("not an object"), []);
});

test("spec 38 §3.4 — a diff attaches to the Edit before it as its CHANGE, and the change fields leave INPUT", () => {
  const entries = traceOf(
    thread([
      you("?"),
      call("Edit", {
        replace_all: false,
        file_path: PATH,
        old_string: "key becomes ticket ID",
        new_string: "key becomes ticket ID\nand more\nand more",
      }),
      diff(PATH, [
        "- key becomes ticket ID",
        "+ key becomes ticket ID",
        "+ and more",
        "+ and more",
      ]),
      result(`The file ${PATH} has been updated.`),
      said("Done."),
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["you", "tool", "answer"],
    "no DIFF block follows the Edit",
  );
  const edit = entries[1];
  assert.equal(edit.label, "EDIT");
  assert.equal(
    edit.change,
    "- key becomes ticket ID\n+ key becomes ticket ID\n+ and more\n+ and more",
    "the path line is not part of the change",
  );
  assert.deepEqual(
    edit.fields.map(([key]) => key),
    ["replace_all", "file_path"],
    "old_string and new_string are the CHANGE row",
  );
  assert.deepEqual(changeCounts(edit.change ?? ""), { removed: 1, added: 3 });
  assert.equal(
    edit.result,
    `The file ${PATH} has been updated.`,
    "the result still lands on the call",
  );
});

test("spec 38 §3.4 — a Write's diff attaches the same way, and one with no change above stays a DIFF block", () => {
  const entries = traceOf(
    thread([
      you("?"),
      call("Write", { file_path: PATH, content: "# Title\n\nBody" }),
      diff(PATH, ["+ # Title", "+ ", "+ Body"]),
      result("File created successfully"),
      // A diff the rule cannot pair: nothing above it is a change without one.
      diff("/elsewhere.md", ["+ stray"]),
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["you", "tool", "diff"],
  );
  const write = entries[1];
  assert.equal(write.change, "+ # Title\n+ \n+ Body");
  assert.deepEqual(write.fields, [["file_path", PATH]], "content is the CHANGE row");

  const lone = entries[2];
  assert.equal(lone.label, "DIFF");
  assert.equal(lone.body, "/elsewhere.md", "a lone diff's preview is its path");
  assert.equal(lone.change, "+ stray");
});

test("spec 38 §3.4 — a refused Edit whose diff never came keeps old_string and new_string in INPUT", () => {
  const entries = traceOf(
    thread([
      you("?"),
      call("Edit", { file_path: PATH, old_string: "a", new_string: "b" }),
      result("Edit cannot be used in a read session.", { isError: true, denied: true }),
    ]),
  );
  const edit = entries[1];
  assert.equal(edit.kind, "denied");
  assert.equal(edit.status, "denied");
  assert.equal(edit.mode, "ask");
  assert.equal(edit.reason, "Edit cannot be used in a read session.");
  assert.equal(edit.change, null);
  assert.deepEqual(
    edit.fields.map(([key]) => key),
    ["file_path", "old_string", "new_string"],
  );
});

test("spec 38 §3.4 — a diff pairs with the most recent change that has none, not with a Read between", () => {
  const entries = traceOf(
    thread([
      you("?"),
      call("Edit", { file_path: PATH, old_string: "a", new_string: "b" }),
      diff(PATH, ["- a", "+ b"]),
      result("ok"),
      call("Read", { file_path: PATH }),
      result("b"),
      call("Edit", { file_path: PATH, old_string: "b", new_string: "c" }),
      diff(PATH, ["- b", "+ c"]),
      result("ok"),
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.change]),
    [
      ["YOU", null],
      ["EDIT", "- a\n+ b"],
      ["READ", null],
      ["EDIT", "- b\n+ c"],
    ],
  );
});

test("spec 38 §3.1 — a failed call keeps its tool's name and opens its output; the result lands on the call", () => {
  const [, read] = traceOf(
    thread([
      you("?"),
      call("Read", { file_path: "/missing.md" }),
      result("File does not exist.", { isError: true }),
    ]),
  );
  assert.equal(read.kind, "failed");
  assert.equal(read.label, "READ");
  assert.equal(read.status, "failed");
  assert.equal(read.result, "File does not exist.");
  assert.deepEqual(read.fields, [["file_path", "/missing.md"]]);
});

test("spec 38 §3.2 and §3.5 — YOU carries the mode it was sent in, the answer its model and style", () => {
  const entries = traceOf(
    thread([
      you("Before we update 7b…", { mode: "act", model: "fable[1m]", style: "Concise" }),
      call("Bash", { command: "ls" }),
      result(""),
      said("Rewriting 7b.", { model: "fable[1m]", style: "Concise" }),
      call("Edit", { file_path: PATH, old_string: "a", new_string: "b" }),
      diff(PATH, ["- a", "+ b"]),
      result("ok"),
      said("Rewrote 7b.", { model: "fable[1m]", style: "Concise" }),
    ]),
  );
  const [question, , aside, , answer] = entries;
  assert.equal(question.kind, "you");
  assert.equal(question.sent, "act");
  assert.equal(aside.kind, "aside");
  assert.equal(answer.kind, "answer");
  assert.equal(answer.model, "fable[1m]");
  assert.equal(answer.style, "Concise");

  // Written before the columns existed: nothing to draw.
  const [old] = traceOf(thread([you("old", { mode: null })]));
  assert.equal(old.sent, null);
  assert.equal(old.model, null);
});

test("spec 38 §3.1 — every block carries the clock, and a tool with no result yet has none", () => {
  const entries = traceOf(thread([you("?"), call("Bash", { command: "sleep 9" })]));
  assert.equal(entries[0].at, "2026-09-02T13:06:00.000Z");
  assert.equal(entries[1].result, null);
  assert.equal(entries[1].kind, "tool");
});

test("spec 37 §3 — placesByMessage: the places with no message are the first YOU's, the rest by their message", () => {
  const target = (messageId: string | null): AnchorTarget =>
    ({ documentId: "d", anchor: {}, state: null, messageId }) as unknown as AnchorTarget;
  const places = placesByMessage([
    target(null),
    target(null),
    target("m7"),
    target("m9"),
    target("m7"),
  ]);
  assert.deepEqual(places.startedWith, [0, 1]);
  assert.deepEqual(
    [...places.byMessage.entries()],
    [
      ["m7", [2, 4]],
      ["m9", [3]],
    ],
  );
  assert.deepEqual(placesByMessage([]), { startedWith: [], byMessage: new Map() });
});
