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
  stepsOfTurn,
  textOf,
  traceOf,
  turnsOf,
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

test("spec 41 §3.1 — a spoken block copies its words and nothing else", () => {
  const entries = traceOf(
    thread([
      you("Rewrite 7b so it names the table.", { mode: "act" }),
      ["thinking", { content: "The table is in components.md." }],
      said("Rewrote 7b.", { model: "fable[1m]", style: "Concise" }),
      ["text", { role: "system", content: "The write agent was denied." }],
      ["stopped", { content: "You stopped this run." }],
      ["error", { content: "The run ended: rate limited." }],
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => [entry.kind, textOf(entry)]),
    [
      ["you", "Rewrite 7b so it names the table."],
      ["thinking", "The table is in components.md."],
      ["answer", "Rewrote 7b."],
      ["note", "The write agent was denied."],
      ["stopped", "You stopped this run."],
      ["error", "The run ended: rate limited."],
    ],
    "no label, no clock, no mode word",
  );
});

test("spec 41 §3.2 — a failed call copies its head, its description, its INPUT and its OUTPUT", () => {
  const [, bash] = traceOf(
    thread([
      you("?"),
      call("Bash", { command: "npm test -- --run", description: "Run the unit tests" }),
      result("(eval):1: == not found", { isError: true }),
    ]),
  );
  assert.equal(
    textOf(bash),
    [
      "BASH · FAILED",
      "Run the unit tests",
      "",
      "INPUT",
      "command: npm test -- --run",
      "description: Run the unit tests",
      "",
      "OUTPUT",
      "(eval):1: == not found",
    ].join("\n"),
  );
});

test("spec 41 §3.2 — a change copies its CHANGE row, folded or not, and a call with no output names no OUTPUT", () => {
  const entries = traceOf(
    thread([
      you("?"),
      call("Edit", { file_path: PATH, old_string: "a", new_string: "b" }),
      diff(PATH, ["- a", "+ b"]),
      call("Bash", { command: "sleep 9" }),
    ]),
  );
  assert.equal(
    textOf(entries[1]),
    ["EDIT", "", "INPUT", `file_path: ${PATH}`, "", "CHANGE", "- a", "+ b"].join("\n"),
    "old_string and new_string are the CHANGE row, so INPUT does not repeat them",
  );
  assert.equal(
    textOf(entries[2]),
    ["BASH", "", "INPUT", "command: sleep 9"].join("\n"),
    "a call still running has no OUTPUT to name",
  );
});

test("spec 41 §3.2 — a denied call copies the gate's reason, above the input it refused", () => {
  const [, edit] = traceOf(
    thread([
      you("?"),
      call("Edit", { file_path: PATH, old_string: "a", new_string: "b" }),
      result("Edit cannot be used in a read session.", { isError: true, denied: true }),
    ]),
  );
  assert.equal(
    textOf(edit),
    [
      "EDIT · DENIED",
      "",
      "Edit cannot be used in a read session.",
      "",
      "INPUT",
      `file_path: ${PATH}`,
      "old_string: a",
      "new_string: b",
    ].join("\n"),
  );
});

test("spec 41 §3.2 — a lone diff copies its path, which is the only line saying what changed", () => {
  const [, lone] = traceOf(thread([you("?"), diff("/elsewhere.md", ["+ stray"])]));
  assert.equal(lone.kind, "diff");
  assert.equal(textOf(lone), ["DIFF", "/elsewhere.md", "", "CHANGE", "+ stray"].join("\n"));
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

// ── Spec 51 §5.2 — turns ────────────────────────────────────────
//
// **A turn is `message.run_id` and nothing else.** Not a time window, not "from
// one user message to the next": both of those are guesses that look exactly as
// confident as the truth, and the id is on the row.

test("blocks group into turns by their run id, oldest first", () => {
  // Every row a run produces carries the run — the reviewer's send, the tool
  // calls, the results and the answer. That is `model` and `style`'s rule, and
  // it is what makes the group complete rather than a subset.
  const turns = turnsOf(
    thread([
      you("what does this mean?", { runId: "r-1" }),
      ["tool_call", { runId: "r-1", toolName: "Read", toolInput: { file_path: PATH } }],
      ["tool_result", { runId: "r-1", content: "30 lines" }],
      said("it means the deadline moved.", { runId: "r-1" }),
      you("change it then", { runId: "r-2", mode: "act" }),
      said("done.", { runId: "r-2" }),
    ]),
  );

  assert.equal(turns.length, 2);
  assert.deepEqual(
    turns.map((turn) => [turn.runId, turn.number]),
    [
      ["r-1", 1],
      ["r-2", 2],
    ],
  );
  // The reviewer's own send is the only row that carries a mode, and the turn
  // takes its pill from it.
  assert.equal(turns[0]?.mode, "ask");
  assert.equal(turns[1]?.mode, "act");
  assert.equal(turns[0]?.toolCalls, 1);
});

test("rows written before the column group together, and are not hidden", () => {
  // A chat from last week has real machinery in it. A sheet that dropped it
  // would say REX had never run.
  const turns = turnsOf(thread([you("older"), said("answer"), call("Read", { path: PATH })]));
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.runId, null);
  assert.equal(turns[0]?.number, 0, "it is not the first turn of anything");
  assert.equal(turns[0]?.entries.length, 3);
});

test("a turn's cost stays null until a row reports one", () => {
  // Spec 43 §8.1 — a missing cost is drawn as unknown, never as `$0.00`. A sum
  // seeded at zero would make "the SDK said nothing" and "the SDK said zero"
  // the same value.
  const quiet = turnsOf(thread([you("hello", { runId: "r-1" })]));
  assert.equal(quiet[0]?.costUsd, null);

  const priced = turnsOf(
    thread([
      you("hello", { runId: "r-1" }),
      ["completed", { runId: "r-1", costUsd: 0, durationMs: 120 }],
    ]),
  );
  assert.equal(priced[0]?.costUsd, 0, "a reported zero IS a number");
  assert.equal(priced[0]?.durationMs, 120);
});

test("the step list is one line per block, and never JSON", () => {
  // At depth 2 a message is 40 KB and the question is only "what did it do".
  const turn = turnsOf(
    thread([
      you("check it", { runId: "r-1" }),
      [
        "tool_call",
        { runId: "r-1", toolName: "Read", toolInput: { file_path: PATH, offset: 140 } },
      ],
      ["tool_result", { runId: "r-1", content: "30 lines" }],
    ]),
  )[0];
  const steps = stepsOfTurn(turn as NonNullable<typeof turn>);
  assert.deepEqual(
    steps.map((step) => step.role),
    ["you", "read"],
  );
  for (const step of steps) {
    assert.equal(step.text.includes("\n"), false, "one line");
    assert.ok(step.text.length <= PREVIEW_MAX, "and a cut one");
  }
});

test("a refused or failed step is marked, and says failed instead of a size", () => {
  const turn = turnsOf(
    thread([
      you("do it", { runId: "r-1" }),
      ["tool_call", { runId: "r-1", toolName: "Bash", toolInput: { command: "rm -rf /" } }],
      [
        "tool_result",
        { runId: "r-1", content: "The read profile cannot write.", denied: true, isError: true },
      ],
    ]),
  )[0];
  const steps = stepsOfTurn(turn as NonNullable<typeof turn>);
  assert.equal(steps[1]?.failed, true);
  assert.equal(steps[1]?.size, "failed");
  assert.equal(turn?.failed, 1);
});
