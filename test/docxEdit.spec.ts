// Spec 19 milestone 19.3 — the surgery and the validator.
//
// Every operation is performed on a copy of a **real** Word file and asserted
// on both halves: the change happened, and nothing else did. The second half is
// the one that matters — a surgical edit that quietly altered a paragraph
// nobody asked about passes every structural check and looks fine in a preview
// that only shows the paragraphs the plan named.
//
// Run: npm run test:docx-edit

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readDocxMap } from "../src/main/docx/document.ts";
import { applyPlanToPackage, EditError } from "../src/main/docx/edit.ts";
import { fitToColumn, imageSize } from "../src/main/docx/parts.ts";
import { PlanError, parsePlan } from "../src/main/docx/plan.ts";
import { checkEdit, newProblems, rowCount } from "../src/main/docx/validate.ts";
import { openPackage } from "../src/main/ooxml/package.ts";
import {
  approveWorkingCopy,
  currentHash,
  currentPath,
  discardWorkingCopy,
  ensureWorkingCopy,
  saveRevision,
} from "../src/main/work.ts";

/** Direct formatting, no styles, 214 paragraphs, 14 tables (§2.2). */
const SYLLABUS = join(
  homedir(),
  "Projects/Github/lukaskellerstein/vibe-coding-course/Syllabus_Vibe_Coding_Agentic_Engineering_EN.docx",
);
/** Heading styles, named bookmarks, a content control, four fields (§2.4). */
const REPORT = join(
  homedir(),
  "Projects/Github/lukaskellerstein/documentation-sample/two/sample-report.docx",
);

const have = (path: string): boolean => existsSync(path);

async function load(path: string) {
  const bytes = readFileSync(path);
  return { bytes, map: await readDocxMap(await openPackage(bytes)) };
}

/** Run a plan and assert it survived both halves of §5.6. */
async function perform(path: string, operations: unknown[]) {
  const bytes = readFileSync(path);
  const plan = parsePlan({ document: path, operations });
  const result = await applyPlanToPackage(await openPackage(bytes), plan);
  const problems = await checkEdit(await openPackage(bytes), await openPackage(result.bytes), plan);
  assert.deepEqual(
    problems.map((problem) => problem.message),
    [],
    "§5.6 — the edit must survive every check",
  );
  return { ...result, before: bytes, map: await readDocxMap(await openPackage(result.bytes)) };
}

test("§5.2 — setText replaces a paragraph and leaves every other one alone", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { map } = await load(SYLLABUS);
  const subject = map.paragraphs.find(
    (paragraph) => paragraph.text.length > 40 && !paragraph.locked && !paragraph.cell,
  );
  assert.ok(subject, "the document must have one long ordinary paragraph");

  const result = await perform(SYLLABUS, [
    { op: "setText", at: subject.index, from: subject.text, to: "REX changed this sentence." },
  ]);

  assert.equal(result.map.paragraphs[subject.index - 1].text, "REX changed this sentence.");
  assert.equal(
    result.map.paragraphs.length,
    map.paragraphs.length,
    "setText never changes the paragraph count",
  );
  for (const paragraph of map.paragraphs) {
    if (paragraph.index === subject.index) continue;
    assert.equal(
      result.map.paragraphs[paragraph.index - 1].text,
      paragraph.text,
      `paragraph ${paragraph.index} must not have moved`,
    );
  }
});

test("§5.2 — a paragraph split across runs is rewritten, and the cost is reported", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { map } = await load(SYLLABUS);
  const split = map.paragraphs.find((paragraph) => {
    if (paragraph.locked || paragraph.text.length < 20) return false;
    return paragraph.text.length > 0;
  });
  assert.ok(split);

  const result = await perform(SYLLABUS, [
    { op: "setText", at: split.index, from: split.text, to: "One run now." },
  ]);
  assert.equal(result.map.paragraphs[split.index - 1].text, "One run now.");
  assert.equal(result.outcomes.length, 1);
  assert.match(result.outcomes[0].summary, /One run now/);
});

test("§4.4 — a `from` that does not match refuses, and writes nothing", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { bytes, map } = await load(SYLLABUS);
  const subject = map.paragraphs.find((p) => p.text.length > 20 && !p.locked);
  assert.ok(subject);

  const plan = parsePlan({
    document: SYLLABUS,
    operations: [
      { op: "setText", at: subject.index, from: "something this document never said", to: "x" },
    ],
  });
  await assert.rejects(
    () => applyPlanToPackage(openPackage(bytes).then((p) => p) as never, plan),
    () => true,
  );
  await assert.rejects(async () => {
    await applyPlanToPackage(await openPackage(bytes), plan);
  }, EditError);
});

test("§4.4 — a position past the end of the document refuses", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { bytes, map } = await load(SYLLABUS);
  const plan = parsePlan({
    document: SYLLABUS,
    operations: [{ op: "setText", at: map.paragraphs.length + 5, from: "anything", to: "x" }],
  });
  await assert.rejects(async () => {
    await applyPlanToPackage(await openPackage(bytes), plan);
  }, /names paragraph \d+, and this document has/);
});

test("§5.5 — a locked paragraph is refused by name", async (t) => {
  if (!have(REPORT)) return t.skip("no report on this machine");
  const { bytes, map } = await load(REPORT);
  const locked = map.paragraphs.find((paragraph) => paragraph.locked !== null);
  if (!locked) return t.skip("this document locks nothing");

  const plan = parsePlan({
    document: REPORT,
    operations: [{ op: "setText", at: locked.index, from: locked.text, to: "x" }],
  });
  await assert.rejects(async () => {
    await applyPlanToPackage(await openPackage(bytes), plan);
  }, /REX will not change because/);
});

test("§4.5 — insertParagraph adds one, wearing the formatting above it", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { map } = await load(SYLLABUS);
  const after = map.paragraphs.find((p) => p.text.length > 30 && !p.cell);
  assert.ok(after);

  const result = await perform(SYLLABUS, [
    { op: "insertParagraph", after: after.index, text: "A sentence REX added." },
  ]);

  assert.equal(result.map.paragraphs.length, map.paragraphs.length + 1);
  assert.equal(result.map.paragraphs[after.index].text, "A sentence REX added.");
  assert.equal(
    result.map.paragraphs[after.index - 1].text,
    after.text,
    "the paragraph it went after is untouched",
  );
  // §2 measured that 8 of 18 documents carry no styles, so a new paragraph with
  // no properties of its own would look nothing like its neighbours.
  assert.ok(
    result.outcomes[0].flags.some((flag) => /copies the formatting/.test(flag)),
    "the reviewer is told the formatting was inherited",
  );
});

test("§4.5 — insertParagraph at 0 goes before the first paragraph", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { map } = await load(SYLLABUS);
  const result = await perform(SYLLABUS, [
    { op: "insertParagraph", after: 0, text: "A new opening line." },
  ]);
  assert.equal(result.map.paragraphs[0].text, "A new opening line.");
  assert.equal(result.map.paragraphs[1].text, map.paragraphs[0].text);
});

test("§4.5 — deleteParagraph removes exactly one", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { map } = await load(SYLLABUS);
  const subject = map.paragraphs.find(
    (p) => p.text.length > 30 && !p.locked && !p.cell && p.index > 3,
  );
  assert.ok(subject);

  const result = await perform(SYLLABUS, [
    { op: "deleteParagraph", at: subject.index, from: subject.text },
  ]);
  assert.equal(result.map.paragraphs.length, map.paragraphs.length - 1);
  assert.ok(!result.map.paragraphs.some((p) => p.text === subject.text), "the paragraph is gone");
});

test("§4.5 — moveParagraph moves one and keeps the document's text", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { map } = await load(SYLLABUS);
  const ordinary = map.paragraphs.filter((p) => p.text.length > 30 && !p.locked && !p.cell);
  const subject = ordinary[0];
  const destination = ordinary[3];
  assert.ok(subject && destination);

  const result = await perform(SYLLABUS, [
    { op: "moveParagraph", at: subject.index, from: subject.text, after: destination.index },
  ]);
  assert.equal(result.map.paragraphs.length, map.paragraphs.length, "a move adds nothing");
  const moved = result.map.paragraphs.findIndex((p) => p.text === subject.text);
  assert.ok(moved > 0);
  assert.notEqual(moved + 1, subject.index, "it actually moved");
});

test("§5.3 — setStyle writes run properties on every run", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { map } = await load(SYLLABUS);
  const subject = map.paragraphs.find((p) => p.text.length > 30 && !p.locked);
  assert.ok(subject);

  const result = await perform(SYLLABUS, [
    { op: "setStyle", at: subject.index, set: { bold: true, fontSize: 18 } },
  ]);
  const pkg = await openPackage(result.bytes);
  const xml = await pkg.readText("word/document.xml");
  const paragraph = result.map.paragraphs[subject.index - 1];
  const fragment = xml.slice(paragraph.span.start, paragraph.span.end);
  assert.match(fragment, /<w:b\/>/, "bold is written");
  assert.match(fragment, /<w:sz w:val="36"\/>/, "18pt is 36 half-points");
  assert.equal(paragraph.text, subject.text, "styling never changes the text");
});

test("§5.3 — setHeadingLevel works where styles exist, and says so where they do not", async () => {
  if (have(REPORT)) {
    const { map } = await load(REPORT);
    const subject = map.paragraphs.find(
      (p) => p.text.length > 10 && !p.locked && p.styleId !== null && !p.cell,
    );
    if (subject) {
      const result = await perform(REPORT, [
        { op: "setHeadingLevel", at: subject.index, from: subject.text, level: 2 },
      ]);
      assert.match(result.map.paragraphs[subject.index - 1].styleId ?? "", /Heading2/i);
    }
  }

  if (!have(SYLLABUS)) return;
  // 8 of 18 documents carry no styled paragraph at all, and Word still defines
  // `Heading2` in their `styles.xml` as a latent style. So the operation works
  // and the result will not match the document's own headings — which the
  // reviewer is told, rather than being refused something Word can do.
  const { map } = await load(SYLLABUS);
  const subject = map.paragraphs.find((p) => p.text.length > 20 && !p.locked && !p.cell);
  assert.ok(subject);
  const result = await perform(SYLLABUS, [
    { op: "setHeadingLevel", at: subject.index, from: subject.text, level: 2 },
  ]);
  assert.ok(
    result.outcomes[0].flags.some((flag) => /direct formatting/.test(flag)),
    "the mismatch is stated, not discovered",
  );
});

test("§5.3 — a heading level the document does not define is refused", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const { bytes, map } = await load(SYLLABUS);
  const subject = map.paragraphs.find((p) => p.text.length > 20 && !p.locked);
  assert.ok(subject);
  // Level 6 exists in Word; a document whose style table stops at Heading4 has
  // nothing to apply, and REX will not write a style definition of its own.
  const missing = ![...(await load(SYLLABUS)).map.styles.keys()].some(
    (id) => id.toLowerCase() === "heading6",
  );
  if (!missing) return t.skip("this document defines Heading6");
  const plan = parsePlan({
    document: SYLLABUS,
    operations: [{ op: "setHeadingLevel", at: subject.index, from: subject.text, level: 6 }],
  });
  await assert.rejects(async () => {
    await applyPlanToPackage(await openPackage(bytes), plan);
  }, /defines no such heading style/);
});

test("§4.5 — insertRow clones the row it follows, widths and all", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const source = readFileSync(SYLLABUS);
  const before = await rowCount(await openPackage(source));
  const { map } = await load(SYLLABUS);
  const inCell = map.paragraphs.find((p) => p.cell !== null && p.text.length > 0);
  assert.ok(inCell, "§2.4 — 15 of 18 documents carry tables");

  // Distinct columns, not paragraphs: a cell can hold several paragraphs, and
  // counting those gave 8 for a four-column row — which the surgery correctly
  // refused, saying so.
  const columns = new Set(
    map.paragraphs
      .filter((p) => p.cell?.table === inCell.cell?.table && p.cell?.row === inCell.cell?.row)
      .map((p) => p.cell?.column),
  ).size;

  const result = await perform(SYLLABUS, [
    {
      op: "insertRow",
      at: inCell.index,
      cells: Array.from({ length: columns }, (_, i) => `New ${i + 1}`),
    },
  ]);
  assert.equal(await rowCount(await openPackage(result.bytes)), before + 1);
  assert.ok(
    result.map.paragraphs.some((p) => p.text === "New 1"),
    "the new row's first cell holds what the plan said",
  );
});

test("§4.4 rule 3 — a plan that changes one paragraph twice is refused", () => {
  assert.throws(
    () =>
      parsePlan({
        document: "/x.docx",
        operations: [
          { op: "setText", at: 4, from: "a", to: "b" },
          { op: "setText", at: 4, from: "b", to: "c" },
        ],
      }),
    PlanError,
  );
});

test("§4.4 — an operation that is not one of the nine is refused whole", () => {
  assert.throws(
    () => parsePlan({ document: "/x.docx", operations: [{ op: "setCellText", at: 1, to: "x" }] }),
    /which is not one of/,
  );
  assert.throws(
    () => parsePlan({ document: "/x.docx", operations: [{ op: "setText", at: 1, to: "x" }] }),
    /must carry 'from'/,
  );
  assert.throws(() => parsePlan("not json at all"), PlanError);
  assert.throws(() => parsePlan({ document: "/x.docx", operations: [] }), /no operations/);
});

test("§5.6 — the untouchable parts are byte-identical after a run", async (t) => {
  if (!have(REPORT)) return t.skip("no report on this machine");
  const source = readFileSync(REPORT);
  const { map } = await load(REPORT);
  const subject = map.paragraphs.find((p) => p.text.length > 30 && !p.locked && !p.cell);
  assert.ok(subject);

  const result = await perform(REPORT, [
    { op: "setText", at: subject.index, from: subject.text, to: "Rewritten by REX." },
  ]);

  const before = await openPackage(source);
  const after = await openPackage(result.bytes);
  for (const path of before.paths()) {
    if (path === "word/document.xml") continue;
    assert.ok(after.has(path), `${path} survived`);
    assert.ok(
      (await before.read(path)).equals(await after.read(path)),
      `${path} must be byte-identical — only word/document.xml may change`,
    );
  }
});

test("§5.6 — a document that was already broken is not blamed on the run", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const source = readFileSync(SYLLABUS);
  const problems = await newProblems(await openPackage(source), await openPackage(source));
  assert.deepEqual(
    problems.map((p) => p.message),
    [],
    "an untouched document introduces no problems",
  );
});

test("§5.6 — a forged edit that changes a paragraph nobody named is caught", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const source = readFileSync(SYLLABUS);
  const { map } = await load(SYLLABUS);
  const named = map.paragraphs.find((p) => p.text.length > 30 && !p.locked && !p.cell);
  const other = map.paragraphs.filter((p) => p.text.length > 30 && !p.locked)[2];
  assert.ok(named && other);

  // The plan names one paragraph; the surgery is told to change two. This is
  // the failure §5.6's second half exists for, and it is invisible to every
  // structural check and to a preview of the named paragraph.
  const honest = parsePlan({
    document: SYLLABUS,
    operations: [{ op: "setText", at: named.index, from: named.text, to: "As agreed." }],
  });
  const forged = parsePlan({
    document: SYLLABUS,
    operations: [
      { op: "setText", at: named.index, from: named.text, to: "As agreed." },
      { op: "setText", at: other.index, from: other.text, to: "Nobody asked for this." },
    ],
  });
  const result = await applyPlanToPackage(await openPackage(source), forged);

  const problems = await checkEdit(
    await openPackage(source),
    await openPackage(result.bytes),
    honest,
  );
  assert.ok(problems.length > 0, "the extra change must be reported");
  assert.ok(
    problems.some((p) => /never asked for it|should appear/.test(p.message)),
    `expected an intent problem, got: ${problems.map((p) => p.message).join(" | ")}`,
  );
});

test("§5.4 — insertImage writes all four places, and Word can find them", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");
  const source = readFileSync(SYLLABUS);
  const { map } = await load(SYLLABUS);
  const after = map.paragraphs.find((p) => p.text.length > 30 && !p.cell);
  assert.ok(after);

  // A 2×2 red PNG, built here rather than fetched: the operation under test is
  // the four places, not the network.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBBgYAB0MAgFrqjXNAAAAAElFTkSuQmCC",
    "base64",
  );
  const file = join(tmpdir(), `rex-test-${process.pid}.png`);
  writeFileSync(file, png);

  const plan = parsePlan({
    document: SYLLABUS,
    operations: [
      {
        op: "insertImage",
        after: after.index,
        source: { from: "file", path: file },
        alt: "A red square, for the test.",
      },
    ],
  });
  const result = await applyPlanToPackage(await openPackage(source), plan, {
    drawDiagram: async () => png,
    drawPoster: async () => ({ png, durationSeconds: 0 }),
  });
  rmSync(file, { force: true });

  const pkg = await openPackage(result.bytes);
  const xml = await pkg.readText("word/document.xml");

  // Place 1 — the bytes.
  const media = pkg.paths().filter((path) => path.startsWith("word/media/rex-image"));
  assert.equal(media.length, 1, "exactly one media part was added");
  assert.ok((await pkg.read(media[0])).equals(png), "the bytes are the picture's own");

  // Place 2 — the relationship, and place 4 points at it.
  const rels = await pkg.readText("word/_rels/document.xml.rels");
  const embed = /r:embed="([^"]+)"/.exec(xml)?.[1];
  assert.ok(embed, "the drawing names a relationship");
  assert.ok(rels.includes(`Id="${embed}"`), "and that relationship is declared");

  // Place 3 — the content type, or Word cannot open the part.
  const types = await pkg.readText("[Content_Types].xml");
  assert.match(types, /Extension="png"/);

  // Place 4 — the drawing itself, sized and described.
  assert.match(xml, /<wp:extent cx="\d+" cy="\d+"\/>/);
  assert.match(xml, /descr="A red square, for the test\."/);

  const problems = await checkEdit(await openPackage(source), pkg, plan);
  assert.deepEqual(
    problems.map((problem) => problem.message),
    [],
  );
});

test("§5.4 — a picture is fitted to the text column, never stretched", () => {
  // 96 DPI: 1 px is 9,525 EMU. A 100 px picture is 952,500 EMU, well inside a
  // six-inch column, so it keeps its own size.
  assert.deepEqual(fitToColumn({ width: 100, height: 50 }, 6 * 914_400), {
    cx: 952_500,
    cy: 476_250,
  });
  // A 2,000 px picture is 19 million EMU and must come down to the column,
  // with its aspect ratio intact.
  const wide = fitToColumn({ width: 2000, height: 1000 }, 6 * 914_400);
  assert.equal(wide.cx, 6 * 914_400);
  assert.equal(wide.cy, Math.round((6 * 914_400) / 2));
});

test("§5.4 — the size of a picture is read from its own bytes", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBBgYAB0MAgFrqjXNAAAAAElFTkSuQmCC",
    "base64",
  );
  assert.deepEqual(imageSize(png), { width: 2, height: 2 });
  assert.equal(imageSize(Buffer.from("not a picture at all")), null);
});

test("§4.2 — the surgery rides the working copy: approve writes, discard does not", async (t) => {
  if (!have(SYLLABUS)) return t.skip("no syllabus on this machine");

  // A copy of a real document in a scratch directory, and REX's work store
  // pointed somewhere disposable. The reviewer's own files are never involved.
  const room = mkdtempSync(join(tmpdir(), "rex-docx-"));
  const previousWork = process.env.REX_WORK_PATH;
  process.env.REX_WORK_PATH = join(room, "work");

  try {
    const document = join(room, "subject.docx");
    const original = readFileSync(SYLLABUS);
    writeFileSync(document, original);

    const meta = ensureWorkingCopy("test-doc-19", document);
    const before = currentHash(meta);

    const map = await readDocxMap(await openPackage(readFileSync(currentPath(meta))));
    const subject = map.paragraphs.find((p) => p.text.length > 40 && !p.locked && !p.cell);
    assert.ok(subject);

    const plan = parsePlan({
      document,
      operations: [
        { op: "setText", at: subject.index, from: subject.text, to: "Changed on the copy." },
      ],
    });
    const edited = await applyPlanToPackage(
      await openPackage(readFileSync(currentPath(meta))),
      plan,
    );

    // §4.2 — REX writes the copy, not the agent. This is the whole integration.
    writeFileSync(currentPath(meta), edited.bytes);
    const next = saveRevision(meta, { applyRunId: "run-19", threadId: "thread-19", before });
    assert.ok(next, "the copy's hash moved, so it is a revision");
    assert.equal(next.revisions.length, 1);

    // The reviewer's file still holds exactly what it held.
    assert.ok(readFileSync(document).equals(original), "nothing was written to the document");

    const inCopy = await readDocxMap(await openPackage(readFileSync(currentPath(meta))));
    assert.equal(inCopy.paragraphs[subject.index - 1].text, "Changed on the copy.");

    // Discard: the file is still the original, and the copy follows it (spec
    // 34 §3.2 — the directory stays, holding what the file holds).
    discardWorkingCopy("test-doc-19");
    assert.ok(readFileSync(document).equals(original), "discard leaves the document alone");

    // Approve: the same edit, accepted this time, reaches the file.
    const again = ensureWorkingCopy("test-doc-19", document);
    writeFileSync(currentPath(again), edited.bytes);
    saveRevision(again, {
      applyRunId: "run-19b",
      threadId: "thread-19",
      before: currentHash(again),
    });
    const approved = approveWorkingCopy("test-doc-19");
    assert.equal(approved.ok, true, `approve should succeed: ${approved.reason ?? ""}`);

    const onDisk = await readDocxMap(await openPackage(readFileSync(document)));
    assert.equal(onDisk.paragraphs[subject.index - 1].text, "Changed on the copy.");
    assert.notEqual(readFileSync(document).length, 0);
  } finally {
    if (previousWork === undefined) delete process.env.REX_WORK_PATH;
    else process.env.REX_WORK_PATH = previousWork;
    rmSync(room, { recursive: true, force: true });
  }
});
