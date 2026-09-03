// Spec 19 milestone 19.5 — the deck's thirteenth operation.
//
// §2.5 measured the gap this closes, and building this corrected the number:
// **5 of the 72 decks on this machine carry real note text**, on 66 of 1,643
// slides. The spec said 33 decks, having counted notes *parts* — PowerPoint
// writes an empty one per slide as soon as a deck has a notes master.
// The check that matters is §7.3's second half — the notes changed **and
// the slide part did not** — because a note is not drawn on the slide, so a
// `setNotes` that wrote into the wrong part would look perfect in the preview.
//
// Run: npm run test:pptx-notes

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openPackage } from "../src/main/ooxml/package.ts";
import { readDeckMap } from "../src/main/pptx/deck.ts";
import { applyPlanToPackage } from "../src/main/pptx/edit.ts";
import { notesPartFor, readNotes } from "../src/main/pptx/notes.ts";
import { parsePlan } from "../src/main/pptx/plan.ts";
import { newProblems, notesProblems } from "../src/main/pptx/validate.ts";

/**
 * 13 slides carrying real speaker notes.
 *
 * Chosen after a correction: §2.5 counted notes *parts* and found 33 of 72
 * decks, but PowerPoint writes an empty notes part for every slide as soon as
 * the deck has a notes master. Measured again through `readNotes`, only **5 of
 * 72 decks** carry note text at all, on 66 of 1,643 slides. The VOLAREZA deck
 * was the first fixture here and its 27 notes parts hold nothing but the slide
 * number, which is exactly the trap this comment exists to stop repeating.
 */
const WITH_NOTES = join(
  homedir(),
  "Projects/Github/lukaskellerstein/documentation-sample/three/sample-deck.pptx",
);
/**
 * No notes part at all — the §7.1 rule 2 case, where REX has to build one.
 *
 * From the repo the machine's own note names as the test repository. The
 * investor deck that was here first is the one deck on this machine
 * `pptxtojson` cannot parse (spec 11 §2.2 measured 29 of 30), so it failed in
 * the reader rather than in anything this milestone wrote.
 */
const WITHOUT_NOTES = join(
  homedir(),
  "Projects/Github/lukaskellerstein/my-ecommerce/Presentation/pptx/multi_database_ecommerce_presentation.pptx",
);

/** The first slide that has notes, and what they say. */
async function firstNoted(bytes: Buffer): Promise<{ slide: number; text: string } | null> {
  const pkg = await openPackage(bytes);
  const map = await readDeckMap(pkg);
  for (const [index, part] of map.slides.entries()) {
    const text = await readNotes(pkg, part);
    if (text.trim().length > 0) return { slide: index + 1, text };
  }
  return null;
}

test("§7.1 — setNotes changes the notes and leaves the slide byte-identical", async (t) => {
  if (!existsSync(WITH_NOTES)) return t.skip("no noted deck on this machine");
  const source = readFileSync(WITH_NOTES);
  const noted = await firstNoted(source);
  assert.ok(noted, "this deck should carry notes");

  const plan = parsePlan({
    deck: WITH_NOTES,
    operations: [
      { op: "setNotes", slide: noted.slide, from: noted.text, to: "REX rewrote this note." },
    ],
  });
  const { bytes, outcomes } = await applyPlanToPackage(await openPackage(source), plan);

  const after = await openPackage(bytes);
  const map = await readDeckMap(after);
  assert.equal(await readNotes(after, map.slides[noted.slide - 1]), "REX rewrote this note.");
  assert.equal(outcomes[0].op, "setNotes");

  // §7.3 — the half that nothing else would notice.
  const before = await openPackage(source);
  const beforeMap = await readDeckMap(before);
  assert.ok(
    (await before.read(beforeMap.slides[noted.slide - 1])).equals(
      await after.read(map.slides[noted.slide - 1]),
    ),
    "setNotes must not touch the slide itself",
  );

  assert.deepEqual(
    (await notesProblems(source, bytes, plan)).map((problem) => problem.message),
    [],
  );
  assert.deepEqual(
    (await newProblems(before, after)).map((problem) => problem.message),
    [],
    "the deck must not gain a structural problem",
  );
});

test("§7.1 rule 1 — a `from` that does not match refuses", async (t) => {
  if (!existsSync(WITH_NOTES)) return t.skip("no noted deck on this machine");
  const source = readFileSync(WITH_NOTES);
  const noted = await firstNoted(source);
  assert.ok(noted);

  const plan = parsePlan({
    deck: WITH_NOTES,
    operations: [
      { op: "setNotes", slide: noted.slide, from: "a note this deck has never held", to: "x" },
    ],
  });
  await assert.rejects(async () => {
    await applyPlanToPackage(await openPackage(source), plan);
  }, /Nothing was written/);
});

test("§7.1 rule 2 — a slide with no notes gains a valid notes part", async (t) => {
  if (!existsSync(WITHOUT_NOTES)) return t.skip("no un-noted deck on this machine");
  const source = readFileSync(WITHOUT_NOTES);
  const before = await openPackage(source);
  const beforeMap = await readDeckMap(before);
  assert.equal(
    await notesPartFor(before, beforeMap.slides[0]),
    null,
    "this deck's first slide should have no notes",
  );

  const plan = parsePlan({
    deck: WITHOUT_NOTES,
    operations: [{ op: "setNotes", slide: 1, from: "", to: "A note REX added." }],
  });
  const { bytes, outcomes } = await applyPlanToPackage(await openPackage(source), plan);

  const after = await openPackage(bytes);
  const map = await readDeckMap(after);
  const part = await notesPartFor(after, map.slides[0]);
  assert.ok(part, "the slide now has a notes part");
  assert.equal(await readNotes(after, map.slides[0]), "A note REX added.");
  assert.ok(
    outcomes[0].flags.some((flag) => /had no speaker notes/.test(flag)),
    "the reviewer is told a part was added",
  );

  // The four places, checked where it is cheapest to get wrong: a missing
  // content-type override is what makes PowerPoint offer to repair a file.
  const types = await after.readText("[Content_Types].xml");
  assert.ok(types.includes(`PartName="/${part}"`), "the new part is declared");
  assert.deepEqual(
    (await newProblems(before, after)).map((problem) => problem.message),
    [],
    "adding a notes part must introduce no structural problem",
  );
  assert.deepEqual(
    (await notesProblems(source, bytes, plan)).map((p) => p.message),
    [],
  );
});

test("§7.3 — a forged edit that changes the slide as well is caught", async (t) => {
  if (!existsSync(WITH_NOTES)) return t.skip("no noted deck on this machine");
  const source = readFileSync(WITH_NOTES);
  const noted = await firstNoted(source);
  assert.ok(noted);

  // The plan says "only the notes". The surgery is told to change a shape too.
  const honest = parsePlan({
    deck: WITH_NOTES,
    operations: [{ op: "setNotes", slide: noted.slide, from: noted.text, to: "Only the note." }],
  });

  const pkg = await openPackage(source);
  const map = await readDeckMap(pkg);
  const slidePart = map.slides[noted.slide - 1];
  const slideXml = await pkg.readText(slidePart);
  const { bytes } = await applyPlanToPackage(pkg, honest);
  const tampered = await openPackage(bytes);
  tampered.write(slidePart, `${slideXml.replace("</p:sld>", "")}<!-- nobody asked --></p:sld>`);

  const problems = await notesProblems(source, await tampered.toBuffer(), honest);
  assert.ok(
    problems.some((problem) => /itself was changed/.test(problem.message)),
    `expected the slide change to be reported, got: ${problems.map((p) => p.message).join(" | ")}`,
  );
});
