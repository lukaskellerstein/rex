// Spec 19 milestone 19.1 — the shared package, the paragraph map and the
// sidecar, judged against every real Word file on this machine.
//
// Runs without Electron, which is why the map and the sidecar are two modules
// that reach nothing. Everything asserted here was measured and written into
// spec 19 §2 before any of this code existed; the point of the file is that a
// later reader can re-run the measurements rather than trust them.
//
// The documents are real files and are deliberately not fixtures — a fixture
// would be a document REX's author chose, which is the one kind that cannot
// surprise it. A machine without them skips, and says so.
//
// Run: npm run test:docx

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { mapDocument, normalise, readDocxMap } from "../src/main/docx/document.ts";
import { sidecarMarkdown } from "../src/main/docx/text.ts";
import { openPackage } from "../src/main/ooxml/package.ts";

/** §2.1 — the whole population of Word files on this machine, not a sample. */
const DOCUMENTS = [
  "Documents/Onion_Manifesto_2026_v4.docx",
  "Documents/Extraliga_2035_profesionalni_navrh.docx",
  "Downloads/Praktické cvičení - Lekce 10.docx",
  "Downloads/navrh-spoluprace.docx",
  "Downloads/Czech Personal Data Form.docx",
  "Downloads/sample-document.docx",
  "Downloads/Macbook Air - M4/Macbook Air.docx",
  "Projects/Github/lukaskellerstein/vibe-coding-course/Syllabus_Vibe_Coding_Agentic_Engineering_EN.docx",
  "Projects/Github/lukaskellerstein/vibe-coding-course/Syllabus_Vibe_Coding_Agentic_Engineering_CZ.docx",
  "Projects/Github/lukaskellerstein/ai-engineer-course/Stream_3/AI_Engineer_Syllabus_CZ.docx",
  "Projects/Github/lukaskellerstein/ai-engineer-course/Stream_3/AI_Engineer_Syllabus_EN.docx",
  "Projects/Github/lukaskellerstein/documentation-sample/two/sample-report.docx",
  "Projects/Github/lukaskellerstein/documentation-sample/one/sample-document.docx",
  "Projects/Github/lukaskellerstein/ai-agents-course/Version_2/AI_Agents_Syllabus_CZ.docx",
  "Projects/Github/lukaskellerstein/ai-agents-course/Version_2/AI_Agents_Syllabus_EN.docx",
  "Projects/Github/r_d/vico-rdcz-2/7_Practical_Office_suite/100_samples/test_output/Imagineer_Business_Plan.docx",
  "Projects/Github/lukaskellerstein/vibe-coding-course/7_Practical_Office_suite/100_samples/test_output/Imagineer_Business_Plan.docx",
  "Projects/Github/lukaskellerstein/vibe-coding-course/7_Practical_Office_suite/100_samples/_archive_cli_run/test_output/Imagineer_Business_Plan.docx",
].map((path) => join(homedir(), path));

const present = DOCUMENTS.filter((path) => existsSync(path));

/** The one with tables, headings, a list and a real style set. */
const SYLLABUS = DOCUMENTS[7];
/** The one carrying named bookmarks, a content control and four fields (§2.4). */
const REPORT = DOCUMENTS[11];

/** Every part of a package, so two packages can be compared part by part. */
async function partsOf(bytes: Buffer): Promise<Map<string, Buffer>> {
  const pkg = await openPackage(bytes);
  const parts = new Map<string, Buffer>();
  for (const path of pkg.paths()) parts.set(path, await pkg.read(path));
  return parts;
}

test("§2.3 — every Word file opens, and comes back with every part byte-identical", async () => {
  if (present.length === 0) {
    console.log("  (no Word files on this machine — skipped)");
    return;
  }

  for (const path of present) {
    const source = readFileSync(path);
    const written = await (await openPackage(source)).toBuffer();

    const before = await partsOf(source);
    const after = await partsOf(written);

    assert.equal(after.size, before.size, `${basename(path)}: the part count moved`);
    for (const [name, bytes] of before) {
      const now = after.get(name);
      assert.ok(now, `${basename(path)}: lost the part ${name}`);
      // §2.3 — this, and not the file's size, is the invariant. The container
      // differs by up to 9.68% because jszip's deflate level is not Word's.
      assert.ok(bytes.equals(now), `${basename(path)}: ${name} came back different`);
    }
  }
  console.log(`  ${present.length} documents, every part byte-identical`);
});

test("§4.1 — the paragraph map numbers the body from 1, tables included", async () => {
  if (!existsSync(SYLLABUS)) return;
  const map = await readDocxMap(await openPackage(readFileSync(SYLLABUS)));

  assert.ok(map.paragraphs.length > 100, "a 214-paragraph document should map most of them");
  map.paragraphs.forEach((paragraph, position) => {
    assert.equal(paragraph.index, position + 1, "positions must be 1, 2, 3 with no gaps");
  });

  const inCells = map.paragraphs.filter((paragraph) => paragraph.cell !== null);
  assert.ok(inCells.length > 0, "§2.4 — 15 of 18 files carry tables, this one included");
  for (const paragraph of inCells) {
    assert.ok((paragraph.cell?.table ?? 0) >= 1, "a cell knows its table");
    assert.ok((paragraph.cell?.row ?? 0) >= 1, "a cell knows its row");
    assert.ok((paragraph.cell?.column ?? 0) >= 1, "a cell knows its column");
  }
});

test("§5.3 — list levels are read where a document uses them", async () => {
  if (present.length === 0) return;
  // §2.4 counted `numbering.xml` as a *part* and found it in 17 of 18 files.
  // Measured properly while building 19.1: only **7 of 18** documents put a
  // `<w:numPr>` on any paragraph, and list items are 194 of 6,151 paragraphs.
  // Carrying the part is not the same as using it, and `setListLevel` acts on
  // the second number, not the first.
  let withLists = 0;
  let listParagraphs = 0;
  let paragraphs = 0;
  for (const path of present) {
    const map = await readDocxMap(await openPackage(readFileSync(path)));
    const lists = map.paragraphs.filter((paragraph) => paragraph.listLevel !== null);
    paragraphs += map.paragraphs.length;
    listParagraphs += lists.length;
    if (lists.length > 0) withLists++;
  }
  console.log(
    `  ${withLists} of ${present.length} documents use lists; ${listParagraphs} of ${paragraphs} paragraphs`,
  );
  assert.ok(withLists > 0, "some document must use a list, or setListLevel is dead code");
});

test("§5.3 — styles are read where a document has them, and most do not", async () => {
  if (existsSync(REPORT)) {
    const map = await readDocxMap(await openPackage(readFileSync(REPORT)));
    const styled = map.paragraphs.filter((paragraph) => paragraph.styleId !== null);
    assert.ok(styled.length > 0, "sample-report.docx uses Word's own heading styles");
    assert.ok(
      styled.every((paragraph) => paragraph.styleName !== null),
      "every style id resolves to the name styles.xml gives it",
    );
  }

  if (present.length === 0) return;
  // Measured while building 19.1, and it is the reason §5.3 refuses rather than
  // invents: **8 of 18 documents define no paragraph styles at all.** Their
  // headings are direct formatting — a bold run at 16pt — which no `styleId`
  // names. `setText` is unaffected, because §4.4 addresses by position and text.
  let withStyles = 0;
  let withHeadings = 0;
  for (const path of present) {
    const map = await readDocxMap(await openPackage(readFileSync(path)));
    const styled = map.paragraphs.filter((paragraph) => paragraph.styleId !== null);
    if (styled.length > 0) withStyles++;
    if (styled.some((paragraph) => /heading|nadpis/i.test(paragraph.styleId ?? ""))) withHeadings++;
  }
  console.log(
    `  ${withStyles} of ${present.length} documents use paragraph styles; ${withHeadings} carry heading styles`,
  );
  assert.ok(withHeadings > 0, "some document must have headings, or setHeadingLevel is dead code");
});

test("§2.2 — a paragraph's text survives being split across runs", async () => {
  // Two runs, one word split across them, and a tab between two columns. Read
  // as one string, the tab a space — which is what the agent will quote back.
  const xml =
    '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Vibe cod</w:t></w:r>' +
    "<w:r><w:t>ing</w:t></w:r><w:r><w:tab/><w:t>Week 1</w:t></w:r></w:p></w:body></w:document>";
  const paragraphs = mapDocument(xml, new Map());
  assert.equal(paragraphs.length, 1);
  assert.equal(normalise(paragraphs[0].text), "Vibe coding Week 1");
});

test("§4.1 — <w:pPr> is not mistaken for a paragraph", () => {
  const xml =
    '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' +
    "<w:r><w:t>One</w:t></w:r></w:p></w:body></w:document>";
  const paragraphs = mapDocument(xml, new Map([["Heading1", "heading 1"]]));
  assert.equal(paragraphs.length, 1, "<w:pPr> and <w:pStyle> start with <w:p");
  assert.equal(paragraphs[0].styleId, "Heading1");
  assert.equal(paragraphs[0].styleName, "heading 1");
});

test("§5.5 — a field, a content control and a named bookmark lock a paragraph", () => {
  const cases: [string, RegExp][] = [
    ['<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>', /field/],
    [
      "<w:p><w:sdt><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>",
      /content control/,
    ],
    ['<w:p><w:r><w:footnoteReference w:id="2"/></w:r></w:p>', /footnote/],
    ['<w:p><w:bookmarkStart w:id="1" w:name="scope"/><w:r><w:t>x</w:t></w:r></w:p>', /bookmark/],
  ];
  for (const [fragment, expected] of cases) {
    const [paragraph] = mapDocument(
      `<w:document><w:body>${fragment}</w:body></w:document>`,
      new Map(),
    );
    assert.match(paragraph.locked ?? "", expected);
  }

  // Word's own hidden bookmarks are not a lock: `_GoBack` is cursor memory and
  // `_Toc…` is a generated contents target. Locking on those would lock every
  // heading in any document with a contents page.
  const [free] = mapDocument(
    '<w:document><w:body><w:p><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>',
    new Map(),
  );
  assert.equal(free.locked, null);
});

test("§5.5 — locking stays rare on real documents", async () => {
  if (present.length === 0) return;
  let paragraphs = 0;
  let locked = 0;
  for (const path of present) {
    const map = await readDocxMap(await openPackage(readFileSync(path)));
    paragraphs += map.paragraphs.length;
    locked += map.paragraphs.filter((paragraph) => paragraph.locked !== null).length;
  }
  const share = (100 * locked) / paragraphs;
  console.log(`  ${locked} of ${paragraphs} paragraphs locked (${share.toFixed(1)}%)`);
  // A rule that refuses a tenth of a document is not a safety rail, it is the
  // feature failing. §2.4 predicted "at most 2 files in 18 carry any of them".
  assert.ok(share < 10, `locking ${share.toFixed(1)}% of paragraphs would make this unusable`);
});

test("§4.3 — the sidecar numbers every paragraph and marks the locked ones", async () => {
  if (!existsSync(REPORT)) return;
  const map = await readDocxMap(await openPackage(readFileSync(REPORT)));
  const markdown = sidecarMarkdown(basename(REPORT), map);

  assert.match(markdown, /^# sample-report\.docx/, "it names the document");
  for (const paragraph of map.paragraphs) {
    assert.ok(markdown.includes(`[${paragraph.index}]`), `paragraph ${paragraph.index} is listed`);
  }
  const locked = map.paragraphs.filter((paragraph) => paragraph.locked !== null);
  if (locked.length > 0) {
    assert.match(markdown, /locked/, "§4.3 rule 4 — the agent is told before it plans");
  }
});

test("§4.3 — every paragraph in every document reaches the sidecar", async () => {
  if (present.length === 0) return;
  for (const path of present) {
    const map = await readDocxMap(await openPackage(readFileSync(path)));
    const lines = sidecarMarkdown(basename(path), map).split("\n");
    const numbered = lines.filter((line) => /^\[\d+\]/.test(line));
    assert.equal(
      numbered.length,
      map.paragraphs.length,
      `${basename(path)}: the sidecar lost a paragraph`,
    );
  }
});
