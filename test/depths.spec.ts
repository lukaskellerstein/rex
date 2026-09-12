// Spec 51 — the claims about the four depths that live in a stylesheet and in a
// source file rather than in a function.
//
// Two of them, and both are the kind that fails silently:
//
//   - **A10, the mode pill.** ASK and ACT must be REX's own `.rex-sent`, drawn
//     from the same rule the chat draws. A second pill that merely looks like it
//     is how the two start disagreeing after the next colour change, and
//     nothing would report it — the screen would simply be wrong.
//   - **§9.5, the tokens.** The artboards inline resolved colours because a
//     `.dc.html` cannot import the stylesheet. The direction of that rule is
//     that the CSS keeps tokens, so a literal copied back out of an artboard is
//     a token that stopped being one.
//
// Run: npm run test:depths

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const css = read("src/renderer/overlay/overlay.css");

/** Every screen that draws a mode, and the reason it has to be the same pill. */
const DRAWS_A_MODE = [
  "src/renderer/overlay/TrafficChat.tsx",
  "src/renderer/overlay/TrafficTurn.tsx",
];

// ── A10 — the mode pill ─────────────────────────────────────────

test("A10 — every mode pill is `.rex-sent`, and no screen invents a second one", () => {
  for (const path of DRAWS_A_MODE) {
    const source = read(path);
    assert.match(
      source,
      /className=\{`rex-sent rex-sent-\$\{[a-zA-Z.]+\}`\}/,
      `${path} draws the pill from the shared class`,
    );
    assert.equal(
      /rex-mode-pill|rex-turns-mode|rex-tt-mode/.test(source),
      false,
      `${path} does not carry a pill of its own`,
    );
  }
});

/**
 * Spec 51 — the trace sheet is NOT one of the traffic screens.
 *
 * The first build folded depth 3 into it and the reviewer rejected the result
 * on 2026-09-09: the sheet is REX's record of what the agent did on one
 * comment, and Traffic is what went over the wire. This is the check that they
 * stay two things — a `rex-tt-` class or a traffic import in the sheet means
 * the hybrid has grown back.
 */
test("the chat's trace sheet is not the traffic feature", () => {
  const sheet = read("src/renderer/overlay/TraceSheet.tsx");
  assert.equal(/rex-tt-|rex-tp-|GatewayTrafficRow|TraceMessageResult/.test(sheet), false);
  assert.equal(/turnsOf|stepsOfTurn/.test(sheet), false, "it does not group by run either");
});

/**
 * Spec 51 §5.3 — WHERE the shape reading lives, and where it is checked.
 *
 * The behaviour belongs to `test/wire.spec.ts`, which drives every shape all
 * three APIs send. These two pin only what a behaviour test cannot: that both
 * screens take their words from that one reader, and that depth 4 never
 * re-labels the record.
 *
 * The split exists because the first version put the reading inside the
 * component, where only a browser could see it — and a Codex turn drew a column
 * of `?` for a whole round with every test passing.
 */
test("both screens read a message through the one reader", () => {
  for (const path of [
    "src/renderer/overlay/TrafficTurn.tsx",
    "src/renderer/overlay/TrafficMessage.tsx",
  ]) {
    // The module, not one symbol in it: spec 55 put the system prompt in front
    // of the messages, so both screens now enter through `wireEntries` and
    // `readWire` is what that calls. The rule is that the reading happens in
    // `wire.ts`, and a rename inside it must not fail this test.
    assert.match(read(path), /from "\.\/wire\.ts"/, `${path} uses the shared reader`);
    assert.equal(
      /tool_calls|tool_result|function_call|reasoning_content/.test(read(path)),
      false,
      `${path} does not read a shape of its own`,
    );
  }
});

/**
 * Spec 51 §5.4, amended 2026-09-11 — all four depths are pages.
 *
 * Depth 4 was a dialog over the turn, pinned at `min(760px, 94vw)`, because its
 * artboard is the narrow one. A request body is tens of kilobytes of JSON and
 * that column read it four words at a time. The width is the feature, so this
 * pins the two things that produce it: the page container, and no width rule
 * putting a box back inside it.
 */
test("every depth is a page, and depth 4 carries no dialog", () => {
  for (const path of [
    "src/renderer/overlay/TrafficPage.tsx",
    "src/renderer/overlay/TrafficChat.tsx",
    "src/renderer/overlay/TrafficTurn.tsx",
    "src/renderer/overlay/TrafficMessage.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /className="rex-page rex-traffic"/, `${path} is a page`);
    assert.equal(/rex-modal|rex-dialog|aria-modal/.test(source), false, `${path} is not a dialog`);
  }
  assert.equal(/\.rex-message-sheet/.test(css), false, "and the sheet's size rule is gone");
});

/**
 * The turn is UNMOUNTED behind depth 4, which is what makes the width real — a
 * wider dialog would still be a box on a backdrop. It is also what gives
 * `Escape` one listener: both screens bound the key before, and the walk back to
 * depth 3 worked only because the turn registered its handler first.
 */
test("depth 4 replaces the turn rather than covering it", () => {
  const app = read("src/renderer/overlay/App.tsx");
  const branch = app.slice(app.indexOf("traffic?.depth === 4"));
  const end = branch.indexOf(") : null}");
  assert.ok(end > 0, "the branch is there to check");
  assert.equal(
    /<TrafficTurn/.test(branch.slice(0, end)),
    false,
    "the turn is not mounted under the message",
  );
  // And the two ways out are two handlers: back walks, × leaves.
  assert.match(read("src/renderer/overlay/TrafficMessage.tsx"), /props\.onBack\(\)/);
});

/**
 * Spec 51 §5.4, amended 2026-09-11 — Readable and JSON are one screen.
 *
 * They answered two halves of one question: JSON has the keys and shows a
 * 1 200-character value as one escaped run, Readable has the prose and threw
 * the keys away. Switching between them made the reader hold a place in their
 * head. The pane is now beside the tree, and picking a row is what fills it.
 */
test("depth 4 is a split, and picking a row is what fills the pane", () => {
  const message = read("src/renderer/overlay/TrafficMessage.tsx");
  assert.match(message, /type Layout = "split" \| "json" \| "readable"/);
  assert.match(message, /useState<Layout>\("split"\)/, "the split is what opens");
  assert.match(message, /rex-json-pick/, "the row is a control");
  assert.match(message, /<Splitter/, "and the divider is the one REX already has");
});

/**
 * **Plain is the default, and the Markdown goes through `prose.tsx`.**
 *
 * Two claims, and the second is the one that would fail silently. This pane
 * draws untrusted model output inside REX's own chrome (invariant I2), and
 * `prose.tsx` is the renderer that was built for exactly that: `html: false`,
 * then DOMPurify over a tag allow-list with no attributes. A second
 * `markdown-it` here would be a second thing to get wrong, and nothing would
 * report it.
 */
test("depth 4 opens on the record, and renders Markdown through the safe renderer", () => {
  const message = read("src/renderer/overlay/TrafficMessage.tsx");
  assert.match(message, /useState<Face>\("plain"\)/, "the record is what opens");
  assert.match(message, /import \{ Prose \} from "\.\/prose\.tsx"/);
  // The IMPORTS, not the words: this file's own header explains why it borrows
  // that renderer, and a check that reads prose fails on its own explanation.
  assert.equal(
    /from "markdown-it"|from "dompurify"|dangerouslySetInnerHTML/.test(message),
    false,
    "depth 4 renders no markup of its own",
  );
  // And the renderer it borrows still carries both layers.
  const prose = read("src/renderer/overlay/prose.tsx");
  assert.match(prose, /html: false/);
  assert.match(prose, /ALLOWED_ATTR: \[\]/);
});

/**
 * Spec 51 §5.4 — TWO places carry a copy, and no others.
 *
 * The reviewer counted five on 2026-09-11 and called the one beside the size
 * "extremely too much". The rule that replaced them: **the copy belongs on the
 * thing being copied.** A row of the tree carries the forms a row has, and a
 * card in the pane carries one for what that card shows. A bar carries none,
 * because a bar is not a thing you copy.
 */
test("a copy sits on a row or on a card, and nowhere else", () => {
  const message = read("src/renderer/overlay/TrafficMessage.tsx");
  // A row: the structure, and on a string the words as well.
  assert.match(message, /label="JSON"/, "the structure");
  assert.match(message, /label="Text"/, "and the words");
  // A card: one copy, unlabelled, for what it is showing.
  assert.match(message, /what="block"/, "a block of a message");
  assert.match(message, /rex-value-card/, "and a picked value, which is a card too");

  // The two bars carry none. `rex-meta` is the size, and a copy used to follow
  // it; the head's two labelled copies were the reviewer's other count.
  const head = message.slice(message.indexOf("rex-value-head"), message.indexOf("rex-value-body"));
  assert.equal(/CopyText/.test(head), false, "the pane's head has no copy");
  const bar = message.slice(
    message.indexOf("rex-message-bar"),
    message.indexOf("rex-message-body"),
  );
  assert.equal(/CopyText/.test(bar), false, "and neither does the toolbar");
});

/**
 * A copy on this screen has to be TOLD to appear.
 *
 * `.rex-copy` is `opacity: 0` until a named ancestor is hovered, and the names
 * are listed one by one: `.rex-turn`, `.rex-trace-entry`. Depth 4 is neither,
 * so leaving it out made every copy here invisible and keyboard-only, which
 * shipped on 2026-09-11. A driver that clicks a locator never notices, because
 * a click does not need to see.
 */
test("both places that carry a copy reveal it on hover", () => {
  assert.match(css, /\.rex-json-line:hover \.rex-copy,\s*\n\.rex-readable-block:hover \.rex-copy/);
  // And the two that no longer carry one are not still revealing it.
  assert.equal(/\.rex-value-head \.rex-copy/.test(css), false);
  assert.equal(/\.rex-message-bar \.rex-copy/.test(css), false);
});

test("a labelled copy is the same button, not a second one", () => {
  // One clipboard implementation: the flash, the failure path, and the reset
  // when the text under the button changes. A second copy button would have to
  // get all three right again, and nothing would report it if it did not.
  const copy = read("src/renderer/overlay/CopyText.tsx");
  assert.match(copy, /label\?: string/);
  assert.match(copy, /rex-copy-named/);
  assert.equal(
    /navigator\.clipboard/.test(read("src/renderer/overlay/TrafficMessage.tsx")),
    false,
    "depth 4 writes to no clipboard of its own",
  );
});

test("depth 4 shows the record, and never re-labels it", () => {
  // The screen says `tool` where Anthropic's field says `user`. Depth 4 is
  // where a reader checks that claim, so it has to show the field.
  const message = read("src/renderer/overlay/TrafficMessage.tsx");
  assert.equal(/kind: "tool"|"tool_result"/.test(message), false);
});

/**
 * §5.3 — the exchange rail is gone, and it must not grow back.
 *
 * Measured on the reviewer's own log: one turn of six exchanges sent 27, 29,
 * 31, 33, 36 and 38 messages — nested prefixes, so picking one showed the same
 * list two rows longer. The wait each exchange cost is on the message it
 * stopped at instead.
 */
test("depth 3 draws one conversation, not a rail of exchanges", () => {
  const turn = read("src/renderer/overlay/TrafficTurn.tsx");
  assert.equal(/rex-tt-rail|rex-tt-stop|onPick/.test(turn), false, "no rail");
  assert.match(turn, /rex-tt-took/, "and the timing is on the messages");
  assert.equal(/rex-tt-rail|rex-tt-stop/.test(read("src/renderer/overlay/overlay.css")), false);
});

/**
 * Spec 51 — the two API surfaces, aligned but never conflated.
 *
 * Spec 46 §4.5 gives one `model_name` three doors, and the two that matter
 * describe one conversation differently: a tool call is a `tool_use` block on
 * Anthropic and an entry in `tool_calls` on OpenAI; its result is a **user**
 * message on one and a **tool** message on the other. Depth 3 reads both into
 * one shape so two agents can be compared — and says which door it read, so
 * the reader is never comparing two things under one name.
 */
test("depth 3 names which API surface it read", () => {
  // The reading itself is `test/wire.spec.ts`'s job. This is that the answer
  // reaches the screen — a fact cell, and a chip on the message list.
  const turn = read("src/renderer/overlay/TrafficTurn.tsx");
  assert.match(turn, /label: "API"/);
  assert.match(turn, /rex-tt-api/);
});

test("depth 2 says the API on every turn", () => {
  assert.match(read("src/renderer/overlay/TrafficChat.tsx"), /<Fact label="api"/);
});

test("the API surface is RECORDED, not sniffed from the body", () => {
  // A real body overflows to a file, so a reader that had to open one to learn
  // the shape would open every one of them to draw a list — the same lesson the
  // message count taught on 2026-09-09.
  const py = read("local-gateway/src/local_gateway/rex_trace.py");
  assert.match(py, /"api": _api_of\(kwargs\)/);
  assert.match(py, /anthropic_messages/);
  assert.match(py, /\/v1\/chat\/completions/);
  // And the reader takes the row's word for it.
  assert.match(read("src/main/gateway/traffic.ts"), /api: apiOf\(line\.api\)/);
});

test("one word per surface, in one place", () => {
  // Two screens naming the same surface differently is the bug `mode.ts` exists
  // to prevent, and `API_LABEL` is the same idea for the same reason.
  const mode = read("src/renderer/overlay/mode.ts");
  assert.match(mode, /export const API_LABEL/);
  assert.match(mode, /anthropic: "Anthropic"/);
  assert.match(mode, /"openai-chat": "OpenAI chat"/);
  for (const path of [
    "src/renderer/overlay/TrafficTurn.tsx",
    "src/renderer/overlay/TrafficChat.tsx",
  ]) {
    assert.match(read(path), /API_LABEL/, `${path} takes the word from one place`);
  }
});

test("one name per screen: Traffic is Traffic, and the sheet is the chat's", () => {
  // Two screens called the same thing is how a reviewer opens the wrong one.
  assert.match(read("src/renderer/overlay/TrafficPage.tsx"), /<h1>Traffic<\/h1>/);
  assert.match(read("src/renderer/overlay/TopBar.tsx"), /data-tip="Traffic — every chat/);
  assert.match(read("src/renderer/overlay/TraceSheet.tsx"), /className="rex-label">CHAT</);
});

test("A10 — the pill's own rule is the one spec 33 §3.3 set, unchanged", () => {
  // ASK is #4d84e8; ACT took the write agent's red (`--lost`) and the amber went
  // to NOTE. A rail cannot also carry the mode, because ACT's colour IS the
  // failure red — which is why the rails in this spec are neutral.
  const rule = css.match(/\.rex-sent \{[^}]+\}/)?.[0] ?? "";
  assert.match(rule, /padding: 1px 6px/);
  assert.match(rule, /border-radius: 999px/);
  assert.match(rule, /color: var\(--bg\)/);
  assert.match(rule, /font-size: 9px/);
  assert.match(rule, /font-weight: 700/);
  assert.match(rule, /letter-spacing: 0\.09em/);

  assert.match(css, /\.rex-sent-ask \{\s*background: #4d84e8;\s*\}/);
  assert.match(css, /\.rex-sent-act \{\s*background: var\(--lost\);\s*\}/);
});

// ── §9.5 — the artboards inline; the stylesheet does not ────────

test("the new depths' styles use tokens, never a colour copied out of an artboard", () => {
  const start = css.indexOf("/* ── Spec 51 — the trace, at four depths");
  assert.ok(start > 0, "the block is there to check");
  const block = css.slice(start);

  // `#ffffff` is allowed: the JSON tab's text on the action blue is white and
  // there is no token for it. Everything else must be `var(--…)`.
  const literals = [...block.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]);
  assert.deepEqual(
    literals.filter((one) => one.toLowerCase() !== "#ffffff"),
    [],
    "a hex colour in this block is a token that stopped being one",
  );
});

// ── the join key, said in both languages ────────────────────────

test("the two sides of the join name the same header", () => {
  // §9.3's warning: `attribution.py` sends `x-rex-run` and `rex_trace.py` files
  // it as the row's `run`. If the database stored anything else, depth 3 would
  // join nothing and draw an empty grid rather than an error.
  assert.match(read("agent-runner/src/agent_runner/attribution.py"), /"x-rex-run", run_id/);
  assert.match(
    read("local-gateway/src/local_gateway/rex_trace.py"),
    /"run": headers\.get\("x-rex-run"\)/,
  );
  // And REX mints it in exactly one place, which is what makes both true.
  assert.match(read("src/main/agent/bridge.ts"), /export function nextRunId\(\)/);
  assert.match(read("src/main/ipc.ts"), /const runId = nextRunId\(\)/);
});
