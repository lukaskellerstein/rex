// Spec 64 — the overview ruler's marks, and the band.
//
// Two halves, like `lane.spec.ts`:
//
//   - the arithmetic in `rulerMarks.ts`: one mark per thing the page already
//     draws, at its height in the whole document, in the colour it already has;
//   - two browser questions that cannot be reasoned about: whether
//     `scrollHeight` stays in `scrollY`'s units under the root's CSS `zoom`, so
//     the band reaches the bottom of the strip exactly when the page does; and
//     whether every bar state still wins over the ruler's own blue, so the
//     strip and the bars wear one table of colours (§3.1).
//
// Run: npm run test:ruler-marks

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright";
import type { ScopeRect } from "../src/renderer/anchor/pick.ts";
import type { CheckedTarget, ResolvedThread } from "../src/renderer/overlay/anchoring.ts";
import type { ChangeBox } from "../src/renderer/overlay/changes.ts";
import { bandOf, changeMarks, commentMarks } from "../src/renderer/overlay/rulerMarks.ts";
import { markerClass } from "../src/renderer/overlay/wash.ts";
import type { AnchorState, ThreadStatus, ThreadWithMessages } from "../src/shared/types.ts";

const TOTAL = 10_000;

function thread(id: string, status: ThreadStatus, title: string | null = null): ThreadWithMessages {
  return { id, status, title, note: `the note of ${id}` } as unknown as ThreadWithMessages;
}

function check(position: number, state: AnchorState, bar: ScopeRect | null): CheckedTarget {
  return { position, state, bar } as unknown as CheckedTarget;
}

function resolved(threadId: string, checked: CheckedTarget[]): ResolvedThread {
  return { threadId, checked } as unknown as ResolvedThread;
}

const box = (y: number, h: number): ScopeRect => ({ x: 40, y, w: 600, h });

// ── Comment marks (§3.1) ────────────────────────────────────────

test("one mark per target with a bar, at its height in the whole document", () => {
  const threads = [thread("a", "open", "AS IS process"), thread("b", "open")];
  const marks = commentMarks(
    [
      resolved("a", [check(0, "ok", box(7_500, 200))]),
      // A comment on three rows shows three marks.
      resolved("b", [
        check(0, "ok", box(1_000, 50)),
        check(1, "ok", box(1_050, 50)),
        check(2, "ok", box(1_100, 50)),
      ]),
    ],
    threads,
    null,
    null,
    TOTAL,
  );
  assert.equal(marks.length, 4);
  assert.deepEqual(
    marks.map((mark) => [mark.key, mark.top, mark.height]),
    [
      ["a-0", 0.75, 0.02],
      ["b-0", 0.1, 0.005],
      ["b-1", 0.105, 0.005],
      ["b-2", 0.11, 0.005],
    ],
  );
  assert.equal(marks[0].title, "Comment 1 · AS IS process", "the hover names it");
  assert.equal(marks[1].title, "Comment 2 · the note of b", "named by the note when untitled");
  assert.equal(marks[0].threadId, "a", "a click opens this comment");
  assert.deepEqual(marks[0].box, box(7_500, 200), "and brings this box into view");
});

test("an orphan has no bar, so it has no mark", () => {
  const marks = commentMarks(
    [resolved("a", [check(0, "orphaned", null), check(1, "ok", box(10, 10))])],
    [thread("a", "open")],
    null,
    null,
    TOTAL,
  );
  assert.deepEqual(
    marks.map((mark) => mark.key),
    ["a-1"],
  );
});

test("a mark wears its bar's colour, and the open comment outranks it", () => {
  const cases: Array<[ThreadStatus, AnchorState]> = [
    ["open", "ok"],
    ["open", "moved"],
    ["open", "orphaned"],
    ["resolved", "ok"],
    ["draft", "ok"],
    ["note", "ok"],
  ];
  for (const [status, state] of cases) {
    const [mark] = commentMarks(
      [resolved("a", [check(0, state, box(0, 10))])],
      [thread("a", status)],
      null,
      null,
      TOTAL,
    );
    const expected = ["rex-ruler-comment", markerClass(status, state)].filter(Boolean).join(" ");
    assert.equal(mark.className, expected, `${status} / ${state}`);
  }

  const [active] = commentMarks(
    [resolved("a", [check(0, "ok", box(0, 10))])],
    [thread("a", "resolved")],
    "a",
    null,
    TOTAL,
  );
  assert.equal(active.className, "rex-ruler-comment rex-margin-done rex-margin-active");
});

test("a comment the lane chips filtered out is not in the list, so it has no mark", () => {
  // `App` filters the `ResolvedThread[]` once, for the bars and the strip alike.
  const marks = commentMarks(
    [resolved("a", [check(0, "ok", box(0, 10))])],
    [thread("a", "open"), thread("b", "note")],
    null,
    null,
    TOTAL,
  );
  assert.deepEqual(
    marks.map((mark) => mark.threadId),
    ["a"],
  );
});

// ── Change marks (§3.2) ─────────────────────────────────────────

test("one mark per changed block, as tall as the block, in its kind's colour", () => {
  const boxes: ChangeBox[] = [
    { ...box(2_000, 1_000), kind: "removed" },
    { ...box(5_000, 100), kind: "changed" },
    { ...box(9_000, 40), kind: "added" },
  ];
  const marks = changeMarks(boxes, TOTAL);
  assert.deepEqual(
    marks.map((mark) => [mark.className, mark.title, mark.top, mark.height, mark.threadId]),
    [
      ["rex-ruler-removed", "Removed", 0.2, 0.1, null],
      ["rex-ruler-rewritten", "Rewritten", 0.5, 0.01, null],
      ["rex-ruler-added", "Added", 0.9, 0.004, null],
    ],
  );
});

test("a block measured off the page stays on the strip", () => {
  const [low, high] = changeMarks(
    [
      { ...box(9_900, 500), kind: "added" },
      { ...box(-50, 100), kind: "added" },
    ],
    TOTAL,
  );
  assert.equal(low.top + low.height, 1, "cut at the bottom");
  assert.equal(high.top, 0, "and at the top");
});

// ── The band (§3.3) ─────────────────────────────────────────────

test("the band is the part of the document on screen", () => {
  assert.deepEqual(bandOf({ scrollY: 2_500, viewHeight: 1_000, total: TOTAL }), {
    top: 0.25,
    height: 0.1,
  });
  // A page that fits on one screen is all on screen.
  assert.deepEqual(bandOf({ scrollY: 0, viewHeight: 900, total: 900 }), { top: 0, height: 1 });
  // Rubber-band overscroll never draws it off the strip.
  assert.deepEqual(bandOf({ scrollY: -40, viewHeight: 1_000, total: TOTAL }), {
    top: 0,
    height: 0.1,
  });
});

test("nothing is measured before the frame has a page", () => {
  assert.equal(bandOf({ scrollY: 0, viewHeight: 0, total: 0 }), null);
  assert.deepEqual(changeMarks([{ ...box(0, 10), kind: "added" }], 0), []);
  assert.deepEqual(
    commentMarks(
      [resolved("a", [check(0, "ok", box(0, 10))])],
      [thread("a", "open")],
      null,
      null,
      0,
    ),
    [],
  );
});

// ── In a real browser ───────────────────────────────────────────

test("under the root's zoom, the band and the marks land where the page is", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const paragraphs = Array.from(
      { length: 80 },
      (_, at) => `<p id="p${at}" style="margin: 20px 0">Paragraph ${at}</p>`,
    ).join("");
    await page.setContent(`<!doctype html><html><body>${paragraphs}</body></html>`);
    for (const zoom of [1, 1.5, 0.75]) {
      const at = await page.evaluate((value) => {
        document.documentElement.style.zoom = String(value);
        window.scrollTo(0, 1e7);
        const last = document.getElementById("p79")?.getBoundingClientRect();
        return {
          scrollY: window.scrollY,
          viewHeight: window.innerHeight,
          total: document.documentElement.scrollHeight,
          // The way `toDocumentRect` measures a block.
          lastBottom: (last?.bottom ?? 0) + window.scrollY,
        };
      }, zoom);
      const band = bandOf(at);
      assert.ok(band, `zoom ${zoom}`);
      assert.ok(
        Math.abs(band.top + band.height - 1) < 1e-9,
        `zoom ${zoom}: the band ends at the strip's foot when the page does`,
      );
      assert.ok(at.lastBottom <= at.total, `zoom ${zoom}: the last block is inside the total`);
      assert.ok(at.total - at.lastBottom < 40, `zoom ${zoom}: and near its end`);
    }
  } finally {
    await browser.close();
  }
});

test("every bar state wins over the ruler's own blue, as it does on the bar", async () => {
  const css = readFileSync(new URL("../src/renderer/overlay/overlay.css", import.meta.url), "utf8");
  const states = [
    "",
    "rex-margin-done",
    "rex-margin-lost",
    "rex-margin-unsent",
    "rex-margin-active",
  ];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head>
      <body><div class="rex-shell">${states
        .map(
          (state) =>
            `<button class="rex-margin ${state}"></button>` +
            `<button class="rex-ruler-mark rex-ruler-lane rex-ruler-comment ${state}"></button>`,
        )
        .join("")}</div></body></html>`);
    const fills = await page.evaluate(() =>
      [...document.querySelectorAll("button")].map((one) => getComputedStyle(one).backgroundColor),
    );
    states.forEach((state, at) => {
      assert.equal(fills[at * 2 + 1], fills[at * 2], `${state || "open"}: strip and bar agree`);
    });
    assert.notEqual(fills[2], fills[0], "and the states really differ from the open blue");
  } finally {
    await browser.close();
  }
});
