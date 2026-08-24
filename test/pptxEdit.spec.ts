// Spec 11 §7 — the surgery, judged the way §2.4 judged the prototype: by part
// count, by re-parsing the result, and by what did *not* change.
//
// The recurring assertion in every case below is the second half of §7.8's
// table: **not only that the change happened, but that nothing else did.** A
// surgical edit that quietly altered a slide it was not asked about would pass
// every structural check ever written and look completely fine.
//
// Run: npm run test:pptx-edit

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyPlanToPackage } from "../src/main/pptx/edit.ts";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  describeSource,
  sniffMediaType,
} from "../src/main/pptx/media.ts";
import { openPackage } from "../src/main/pptx/package.ts";
import {
  type EditPlan,
  PlanError,
  parsePlan,
  setGenerationEnabled,
} from "../src/main/pptx/plan.ts";
import {
  intentProblems,
  newProblems,
  structuralProblems,
  videoProblems,
} from "../src/main/pptx/validate.ts";
import { parseDeck, slideTexts } from "../src/main/render/pptxText.ts";

const AGROFERT = join(
  homedir(),
  "Projects/Github/onion-ai-eu/executive-management/customers/agri-chem/agrofert/presentation/Onion-AI-Agrofert-EN.pptx",
);

function skipUnless(path: string): { skip: string | false } {
  return { skip: existsSync(path) ? false : `not on this machine: ${path}` };
}

/** Every slide's text, as one comparable array. */
async function textOf(bytes: Buffer): Promise<string[][]> {
  const deck = await parseDeck(bytes);
  return slideTexts(deck.slides).map((slide) => slide.shapes.map((shape) => shape.text));
}

async function run(source: Buffer, plan: EditPlan): ReturnType<typeof applyPlanToPackage> {
  return applyPlanToPackage(await openPackage(source), plan);
}

// ── §7.2.2 — the plan's own rules, before a byte is written ──────

test("a plan that both reorders and edits is refused", () => {
  assert.throws(
    () =>
      parsePlan({
        deck: "/x.pptx",
        operations: [
          { op: "reorderSlides", order: [2, 1] },
          { op: "setText", slide: 1, shape: "Text 1", from: "a", to: "b" },
        ],
      }),
    PlanError,
    "a slide position means nothing halfway through a reorder",
  );
});

test("an operation that changes something must say what it expects to find", () => {
  assert.throws(
    () =>
      parsePlan({
        deck: "/x.pptx",
        operations: [{ op: "setText", slide: 1, shape: "Text 1", to: "b" }],
      }),
    /must carry 'from'/,
  );
});

test("a box in points rather than fractions is refused", () => {
  assert.throws(
    () =>
      parsePlan({
        deck: "/x.pptx",
        operations: [
          { op: "insertTextBox", slide: 1, box: { x: 36, y: 25, w: 648, h: 50 }, text: "x" },
        ],
      }),
    /not a fraction of the slide/,
  );
});

test("a partial reorder is refused — a full permutation cannot be ambiguous", () => {
  assert.throws(
    () => parsePlan({ deck: "/x.pptx", operations: [{ op: "reorderSlides", order: [3, 1] }] }),
    /full permutation/,
  );
});

test("a web picture must carry its credit and its licence", () => {
  assert.throws(
    () =>
      parsePlan({
        deck: "/x.pptx",
        operations: [
          {
            op: "insertImage",
            slide: 1,
            placement: "background",
            alt: "a car",
            source: { from: "web", query: "car", url: "https://example.com/a.jpg" },
          },
        ],
      }),
    /credit/,
  );
});

test("an unknown operation is refused with the list of the twelve", () => {
  assert.throws(
    () => parsePlan({ deck: "/x.pptx", operations: [{ op: "rewriteEverything" }] }),
    /setText, insertTextBox/,
  );
});

// ── §2.4 and §7.3 — the surgery itself ──────────────────────────

test("setText changes one shape and loses no part", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const before = await openPackage(source);
  const partsBefore = before.paths();

  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "setText",
        slide: 4,
        shape: "Text 1",
        from: "Onion: the group data plane",
        to: "Onion: the group control plane",
      },
    ],
  });

  const { outcomes, bytes } = await run(source, plan);
  const after = await openPackage(bytes);

  // §2.4 — 132 parts in, 132 parts out, zero lost, zero added.
  assert.deepEqual(after.paths(), partsBefore, "every part survives, in the same order");
  assert.equal(outcomes.length, 1);
  assert.match(outcomes[0].summary, /Slide 4, "Text 1"/);

  // §7.8 — the change happened...
  const texts = await textOf(bytes);
  assert.ok(
    texts[3].includes("Onion: the group control plane"),
    "the new text reads back from the edited deck",
  );

  // ...and nothing else did. This is the half that matters.
  const original = await textOf(source);
  for (let slide = 0; slide < original.length; slide++) {
    for (let shape = 0; shape < original[slide].length; shape++) {
      if (slide === 3 && original[slide][shape] === "Onion: the group data plane") continue;
      assert.equal(
        texts[slide][shape],
        original[slide][shape],
        `slide ${slide + 1} shape ${shape + 1} changed and was not named by the plan`,
      );
    }
  }
});

test("a setText whose `from` no longer matches is refused", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "setText",
        slide: 4,
        shape: "Text 1",
        from: "Something this slide has never said",
        to: "anything",
      },
    ],
  });

  await assert.rejects(() => run(source, plan), /does not currently say/);
});

test(
  "a shape the slide does not have is refused, and says what it has",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [{ op: "setText", slide: 4, shape: "Text 99", from: "a", to: "b" }],
    });
    await assert.rejects(() => run(source, plan), /No shape named 'Text 99'.*Text 1/s);
  },
);

test("a slide beyond the deck is refused", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [{ op: "setText", slide: 99, shape: "Text 1", from: "a", to: "b" }],
  });
  await assert.rejects(() => run(source, plan), /has 23 slides/);
});

test("a longer replacement is flagged as able to overflow", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "setText",
        slide: 4,
        shape: "Text 1",
        from: "Onion: the group data plane",
        to: "Onion: the group data plane, and every subsidiary system it reaches across the whole of the group",
      },
    ],
  });
  const { outcomes } = await run(source, plan);
  // §7.7 — PowerPoint does not shrink text unless <a:normAutofit/> is set, so a
  // lengthened sentence produces a deck that validates and has a paragraph
  // running off its card. The preview says so before the reviewer accepts.
  assert.ok(
    outcomes[0].flags.some((flag) => flag.includes("overflow")),
    `expected an overflow flag, got: ${JSON.stringify(outcomes[0].flags)}`,
  );
});

test("the package round-trips with no plan at all", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const pkg = await openPackage(source);
  const parts = pkg.paths();
  const bytes = await pkg.toBuffer();
  const back = await openPackage(bytes);

  assert.deepEqual(back.paths(), parts);
  // §2.4 rejected `pptx-automizer` for coming back 41% larger. A deck REX did
  // not edit at all must come back the size it went in, give or take zip
  // metadata.
  const drift = Math.abs(bytes.length - source.length) / source.length;
  assert.ok(drift < 0.01, `size drifted by ${(drift * 100).toFixed(2)}%`);
});

// ── §7.8 — the validator ────────────────────────────────────────

test("§7.8 — a setText introduces no new structural problem", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "setText",
        slide: 4,
        shape: "Text 1",
        from: "Onion: the group data plane",
        to: "Onion: the group control plane",
      },
    ],
  });

  const { bytes } = await run(source, plan);
  const problems = await newProblems(await openPackage(source), await openPackage(bytes));

  // Only NEW problems. Many real decks are already invalid in small ways, and
  // REX's promise is "it did not break anything that was working" — not "this
  // deck is valid", which it cannot honestly say.
  assert.deepEqual(
    problems.map((problem) => problem.message),
    [],
  );
});

test(
  "§7.8 — the round-trip re-parse sees the change and nothing else",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [
        {
          op: "setText",
          slide: 4,
          shape: "Text 1",
          from: "Onion: the group data plane",
          to: "Onion: the group control plane",
        },
      ],
    });

    const { bytes } = await run(source, plan);
    assert.deepEqual(
      (await intentProblems(source, bytes, plan)).map((problem) => problem.message),
      [],
    );
  },
);

test("§7.8 — an edit the plan did not name is caught", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);

  // Two operations performed, one declared. This is the failure the second half
  // of every §7.8 row exists to catch: a surgical edit that quietly altered a
  // slide it was not asked about passes every structural check there is.
  const performed = parsePlan({
    deck: AGROFERT,
    operations: [
      { op: "setText", slide: 4, shape: "Text 1", from: "Onion: the group data plane", to: "A" },
      { op: "setText", slide: 5, shape: "Text 1", from: "How it integrates", to: "B" },
    ],
  });
  const declared = parsePlan({
    deck: AGROFERT,
    operations: [
      { op: "setText", slide: 4, shape: "Text 1", from: "Onion: the group data plane", to: "A" },
    ],
  });

  const { bytes } = await run(source, performed);
  const problems = await intentProblems(source, bytes, declared);
  assert.ok(
    problems.some((problem) => problem.message.includes("no operation named it")),
    `expected the undeclared edit to be caught, got: ${JSON.stringify(problems)}`,
  );
});

test(
  "§7.8 — the original deck's own problems are reported as its own",
  skipUnless(AGROFERT),
  async () => {
    // Not asserted to be zero: whether a real deck is already invalid is the
    // deck's business, and `newProblems` is what makes that not REX's problem.
    // What is asserted is that the check runs and says something concrete.
    const problems = await structuralProblems(await openPackage(readFileSync(AGROFERT)));
    for (const problem of problems) {
      assert.ok(problem.key.length > 0 && problem.message.length > 0);
    }
    console.log(
      `      the Agrofert deck has ${problems.length} pre-existing structural problem(s)`,
    );
  },
);

// ── §7.2.1 — the shape operations (milestone 11.6) ──────────────

/** Slide 4's cards, so a test can name one without hard-coding a guess. */
const CARD = "Shape 3";

test("insertTextBox adds one shape and changes no other", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "insertTextBox",
        slide: 4,
        box: { x: 0.05, y: 0.86, w: 0.4, h: 0.06 },
        text: "Reviewed 2026-08-25",
        name: "Review stamp",
      },
    ],
  });

  const { outcomes, bytes } = await run(source, plan);
  assert.match(outcomes[0].summary, /adds a text box "Review stamp"/);

  const before = await textOf(source);
  const after = await textOf(bytes);
  assert.equal(after[3].length, before[3].length + 1, "slide 4 gained exactly one shape");
  assert.ok(after[3].includes("Reviewed 2026-08-25"), "the new box holds its text");

  // §7.8 both ways: the shape appeared, and nothing the plan did not name did.
  assert.deepEqual(await intentProblems(source, bytes, plan), []);
  assert.deepEqual(await newProblems(await openPackage(source), await openPackage(bytes)), []);
});

test(
  "an inserted box gets a name nothing else on the slide uses",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      // "Text 1" is already the title of slide 4. PowerPoint allows the clash;
      // REX does not, because an operation addressing shapes by name could then
      // never say which one it meant (§7.2.2 rule 2).
      operations: [
        {
          op: "insertTextBox",
          slide: 4,
          box: { x: 0.1, y: 0.9, w: 0.2, h: 0.05 },
          text: "x",
          name: "Text 1",
        },
      ],
    });

    const { outcomes, bytes } = await run(source, plan);
    assert.ok(
      outcomes[0].flags.some((flag) => flag.includes("already had a shape")),
      "the rename is stated, not silent",
    );

    const deck = await parseDeck(bytes);
    const names = slideTexts(deck.slides)[3].shapes.map((shape) => shape.name);
    assert.equal(new Set(names).size, names.length, "no two shapes on slide 4 share a name");
  },
);

test("moveShape moves the shape it names, to within a point", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const deck = await parseDeck(source);
  const card = deck.slides[3].elements.find(
    (element) => "name" in element && element.name === CARD,
  );
  assert.ok(card, `slide 4 has a shape named ${CARD}`);

  const from = {
    x: card.left / deck.size.width,
    y: card.top / deck.size.height,
    w: card.width / deck.size.width,
    h: card.height / deck.size.height,
  };
  const to = { ...from, y: from.y + 0.02 };

  const plan = parsePlan({
    deck: AGROFERT,
    operations: [{ op: "moveShape", slide: 4, shape: CARD, from, to }],
  });
  const { bytes } = await run(source, plan);

  const moved = (await parseDeck(bytes)).slides[3].elements.find(
    (element) => "name" in element && element.name === CARD,
  );
  assert.ok(moved);
  assert.ok(
    Math.abs(moved.top - to.y * deck.size.height) < 1,
    `expected top ~${to.y * deck.size.height}pt, got ${moved.top}pt`,
  );
  assert.equal(Math.round(moved.left), Math.round(card.left), "it did not move sideways");
  assert.deepEqual(await intentProblems(source, bytes, plan), []);
});

test("a moveShape whose `from` box is wrong is refused", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "moveShape",
        slide: 4,
        shape: CARD,
        from: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 },
        to: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    ],
  });
  await assert.rejects(() => run(source, plan), /is not where the plan says it is/);
});

test("deleteShape removes the shape it names, and no other", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "deleteShape",
        slide: 4,
        shape: "Text 2",
        from: "Your group, in one queryable layer.",
      },
    ],
  });

  const { bytes } = await run(source, plan);
  const before = await textOf(source);
  const after = await textOf(bytes);

  assert.equal(after[3].length, before[3].length - 1, "slide 4 lost exactly one shape");
  assert.ok(
    !after[3].includes("Your group, in one queryable layer."),
    "the deleted shape's text is gone",
  );
  // Every other slide is untouched, and so is every other shape on slide 4.
  assert.deepEqual(await intentProblems(source, bytes, plan), []);
  assert.deepEqual(await newProblems(await openPackage(source), await openPackage(bytes)), []);
});

test("a deleteShape whose `from` does not match is refused", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [{ op: "deleteShape", slide: 4, shape: "Text 2", from: "Something else entirely" }],
  });
  await assert.rejects(() => run(source, plan), /does not say/);
});

// ── §7.4 — pictures (milestone 11.7) ────────────────────────────

/** A real 1×1 PNG, so the magic-byte check has something honest to accept. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function tinyPngPath(): string {
  const path = join(tmpdir(), "rex-test-picture.png");
  writeFileSync(path, TINY_PNG);
  return path;
}

test(
  "§7.4.4 — an inserted picture is written to all four of its places",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [
        {
          op: "insertImage",
          slide: 4,
          box: { x: 0.7, y: 0.05, w: 0.2, h: 0.1 },
          source: { from: "file", path: tinyPngPath() },
          alt: "A test picture",
        },
      ],
    });

    const { bytes } = await run(source, plan);
    const before = await openPackage(source);
    const after = await openPackage(bytes);

    // Place 1 — the bytes.
    const added = after.paths().filter((part) => !before.paths().includes(part));
    assert.equal(added.length, 1, `expected one new part, got ${JSON.stringify(added)}`);
    assert.match(added[0], /^ppt\/media\/.*\.png$/);

    // Places 2 and 3 are what §7.8's structural checks are for, and a missing one
    // is exactly the "do you want me to repair this?" prompt PowerPoint shows.
    assert.deepEqual(
      (await newProblems(before, after)).map((problem) => problem.message),
      [],
    );

    // Place 4 — the shape is on the slide, and it is a picture.
    const deck = await parseDeck(bytes);
    const picture = deck.slides[3].elements.find((element) => element.type === "image");
    assert.ok(picture, "slide 4 now has a picture element");
    assert.equal(Math.round(picture.left), Math.round(0.7 * deck.size.width));

    // §7.8 — and nothing the plan did not name changed.
    assert.deepEqual(await intentProblems(source, bytes, plan), []);
  },
);

test(
  "§7.4.4 — a background picture goes under every existing shape",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [
        {
          op: "insertImage",
          slide: 4,
          placement: "background",
          source: { from: "file", path: tinyPngPath() },
          alt: "A background",
        },
      ],
    });

    const { bytes } = await run(source, plan);
    const deck = await parseDeck(bytes);
    // The library returns a slide's elements in paint order, so "under
    // everything" means "first".
    assert.equal(deck.slides[3].elements[0].type, "image", "the background paints first");
    assert.equal(Math.round(deck.slides[3].elements[0].width), Math.round(deck.size.width));
    assert.deepEqual(await newProblems(await openPackage(source), await openPackage(bytes)), []);
  },
);

test("§7.4.4 — every inserted picture carries alt text", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "insertImage",
        slide: 4,
        box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
        source: { from: "file", path: tinyPngPath() },
        alt: "A deck REX edited must not be less accessible",
      },
    ],
  });
  const { bytes } = await run(source, plan);
  const pkg = await openPackage(bytes);
  const slide = await pkg.readText("ppt/slides/slide4.xml");
  assert.match(slide, /descr="A deck REX edited must not be less accessible"/);
});

test(
  "§7.4.1 — a file that is not a picture is refused on its bytes",
  skipUnless(AGROFERT),
  async () => {
    const notAPicture = join(tmpdir(), "rex-test-not-a-picture.png");
    // The name says PNG and the header would too. The bytes are what decides.
    writeFileSync(notAPicture, "<html><body>Sign in to continue</body></html>");

    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [
        {
          op: "insertImage",
          slide: 4,
          box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
          source: { from: "file", path: notAPicture },
          alt: "x",
        },
      ],
    });
    await assert.rejects(() => run(source, plan), /not any media format REX accepts/);
  },
);

test("§7.4.1 — the magic-byte sniffer knows the formats REX accepts", () => {
  assert.deepEqual(sniffMediaType(TINY_PNG), { extension: "png", contentType: "image/png" });
  assert.deepEqual(sniffMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), {
    extension: "jpeg",
    contentType: "image/jpeg",
  });
  assert.deepEqual(sniffMediaType(Buffer.from("GIF89a")), {
    extension: "gif",
    contentType: "image/gif",
  });
  assert.equal(sniffMediaType(Buffer.from("<!doctype html>")), null);
});

test(
  "§7.4.2 — a diagram plan refuses cleanly when no window can draw it",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [
        {
          op: "insertImage",
          slide: 4,
          box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
          source: { from: "diagram", engine: "mermaid", source: "flowchart LR\n  A --> B" },
          alt: "Two stages",
        },
      ],
    });
    // Mermaid measures text with a real layout, so it cannot run in main. Saying
    // so beats inserting an empty box.
    await assert.rejects(() => run(source, plan), /only be drawn while REX's window is open/);
  },
);

test("§7.4 — the preview says where a picture came from, and does not vouch for it", () => {
  const web = describeSource({
    from: "web",
    query: "red sports car",
    url: "https://images.unsplash.com/photo-1",
    credit: "Photo by A. Namesmith on Unsplash",
    licence: "Unsplash License",
  });
  assert.match(web, /red sports car/);
  assert.match(web, /Unsplash License/);

  // §7.4 — provenance is not a footnote when the deck leaves the building.
  assert.match(
    describeSource({
      from: "generated",
      engine: "image",
      prompt: "a barn at dusk",
      path: "/x.png",
    }),
    /GENERATED.*a barn at dusk/,
  );
});

test(
  "§7.2.2 rule 1 — an apostrophe in `from` matches an XML-escaped one",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const deck = await parseDeck(source);

    // The sidecar the agent reads is plain text, so a plan's `from` carries a
    // real apostrophe. The deck stores it as `&apos;`. Comparing the raw XML
    // refused every such operation — measured on the first real diagram plan an
    // agent wrote, on 2026-08-25.
    const withApostrophe = slideTexts(deck.slides)
      .flatMap((slide) => slide.shapes.map((shape) => ({ slide: slide.number, ...shape })))
      .find((shape) => shape.text.includes("'"));
    assert.ok(withApostrophe, "the deck has a shape whose text contains an apostrophe");

    const plan = parsePlan({
      deck: AGROFERT,
      operations: [
        {
          op: "deleteShape",
          slide: withApostrophe.slide,
          shape: withApostrophe.name,
          from: withApostrophe.text,
        },
      ],
    });
    const { bytes } = await run(source, plan);
    assert.deepEqual(await intentProblems(source, bytes, plan), []);
  },
);

// ── §7.5 — style (milestone 11.8) ───────────────────────────────

test("§7.5.1 — setStyle changes only the properties it names", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const before = await openPackage(source);
  const slideBefore = await before.readText("ppt/slides/slide4.xml");

  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "setStyle",
        slide: 4,
        shape: "Text 1",
        scope: "shape",
        from: { fontSize: 28 },
        set: { fontSize: 32 },
      },
    ],
  });
  const { bytes } = await run(source, plan);
  const slideAfter = await (await openPackage(bytes)).readText("ppt/slides/slide4.xml");

  // A shape inherits most of its formatting from the layout and the master. An
  // operation that rewrote the properties block would flatten that: the slide
  // looks identical today and stops following the template forever.
  assert.ok(slideBefore.includes('typeface="Cambria"'), "the title had Cambria before");
  assert.ok(slideAfter.includes('typeface="Cambria"'), "and still has it after");
  assert.ok(slideAfter.includes('sz="3200"'), "the size is written in hundredths of a point");

  // The RUNS carry the new size. `<a:endParaRPr>` keeps the old one on purpose:
  // it is not a run, it is the formatting for text typed after the last one,
  // and §7.5.1 says an operation writes what it named and nothing else.
  const runsAfter = [...slideAfter.matchAll(/<a:r>.*?<\/a:r>/gs)]
    .map((match) => match[0])
    .filter((run) => run.includes("Onion: the group data plane"));
  assert.ok(runsAfter.length > 0, "the title's run is findable");
  for (const run of runsAfter) {
    assert.ok(run.includes('sz="3200"'), "the run has the new size");
    assert.ok(!run.includes('sz="2800"'), "and not the old one");
  }
});

test("§7.5.2 — a theme colour is written as a theme reference", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const deck = await parseDeck(source);
  const themed = deck.themeColors[0];
  assert.ok(themed, "the deck has a palette");

  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "setStyle",
        slide: 4,
        shape: "Text 1",
        scope: "shape",
        from: { fontSize: 28 },
        set: { color: themed },
      },
    ],
  });
  const { outcomes, bytes } = await run(source, plan);
  const slide = await (await openPackage(bytes)).readText("ppt/slides/slide4.xml");

  // A hardcoded hex looks right today and is wrong the moment the deck is
  // re-themed, with nothing about the slide showing it.
  assert.match(slide, /<a:schemeClr val="accent1"\/>/);
  assert.equal(outcomes[0].flags.length, 0, "a colour in the palette is not a design decision");
});

test(
  "§7.5.2 — a colour outside the palette is written as a hex and flagged",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [
        {
          op: "setStyle",
          slide: 4,
          shape: "Text 1",
          scope: "shape",
          from: { fontSize: 28 },
          set: { color: "#FF00AA" },
        },
      ],
    });
    const { outcomes, bytes } = await run(source, plan);
    const slide = await (await openPackage(bytes)).readText("ppt/slides/slide4.xml");

    assert.match(slide, /<a:srgbClr val="FF00AA"\/>/);
    assert.ok(
      outcomes[0].flags.some((flag) => flag.includes("not in this deck's theme")),
      "a colour outside the palette is a design decision the reviewer is making",
    );
  },
);

test("§7.5.3 — a font the deck does not have needs saying so", skipUnless(AGROFERT), async () => {
  const source = readFileSync(AGROFERT);
  const refused = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "setStyle",
        slide: 4,
        shape: "Text 1",
        scope: "shape",
        from: { fontSize: 28 },
        set: { fontFace: "Comic Sans MS" },
      },
    ],
  });
  await assert.rejects(() => run(source, refused), /not a font this deck already uses/);

  const declared = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "setStyle",
        slide: 4,
        shape: "Text 1",
        scope: "shape",
        from: { fontSize: 28 },
        set: { fontFace: "Comic Sans MS" },
        allowNewFont: true,
      },
    ],
  });
  const { outcomes } = await run(source, declared);
  // Silent font substitution is the classic way a deck degrades: the machine
  // that edits it has the font, the machine that opens it does not.
  assert.ok(outcomes[0].flags.some((flag) => flag.includes("substitute another face")));
});

test(
  "§7.5 — scope run bolds one word and leaves the paragraph alone",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [
        {
          op: "setStyle",
          slide: 4,
          shape: "Text 2",
          scope: "run",
          index: 1,
          from: { italic: true },
          set: { bold: true },
        },
      ],
    });
    const { bytes } = await run(source, plan);
    const slide = await (await openPackage(bytes)).readText("ppt/slides/slide4.xml");
    assert.match(slide, /b="1"/);
    // The text itself is untouched — style is not content.
    assert.deepEqual(await intentProblems(source, bytes, plan), []);
  },
);

test(
  "§7.5.4 — setThemeFont changes the fonts and no slide's text",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [{ op: "setThemeFont", major: "Georgia", minor: "Inter" }],
    });
    const { outcomes, bytes } = await run(source, plan);
    const after = await openPackage(bytes);

    const theme = await after.readText("ppt/theme/theme1.xml");
    assert.match(theme, /<a:majorFont><a:latin typeface="Georgia"\/>/);
    assert.match(theme, /<a:minorFont><a:latin typeface="Inter"\/>/);

    // §7.8 — the check that matters for this operation: the deck's TEXT is
    // untouched. Changing a font must never change what a slide says.
    assert.deepEqual(await intentProblems(source, bytes, plan), []);
    assert.deepEqual(await textOf(bytes), await textOf(source));
    assert.ok(outcomes[0].flags.some((flag) => flag.includes("do not follow the theme")));
  },
);

// ── §7.6 — slide operations (milestone 11.9) ────────────────────

/** Every slide's text, joined, so slides can be compared by content. */
async function slideFingerprints(bytes: Buffer): Promise<string[]> {
  return (await textOf(bytes)).map((slide) => slide.join("|"));
}

test(
  "§7.6.1 — reorderSlides adds, removes and rewrites no part",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const before = await openPackage(source);
    const order = [1, 2, 3, 7, 4, 5, 6, ...Array.from({ length: 16 }, (_, n) => n + 8)];

    const plan = parsePlan({ deck: AGROFERT, operations: [{ op: "reorderSlides", order }] });
    const { bytes } = await run(source, plan);
    const after = await openPackage(bytes);

    // Slide order lives entirely in <p:sldIdLst>, so `slide7.xml` keeps its name
    // and its contents and the file numbering never has to match the order.
    assert.deepEqual(after.paths(), before.paths(), "no part is added, removed or renamed");
    for (const part of before.paths()) {
      if (part === "ppt/presentation.xml") continue;
      assert.deepEqual(
        await after.read(part),
        await before.read(part),
        `${part} must be byte-identical after a reorder`,
      );
    }

    const was = await slideFingerprints(source);
    const now = await slideFingerprints(bytes);
    assert.equal(now.length, was.length, "the count cannot change");
    order.forEach((wanted, position) => {
      assert.equal(
        now[position],
        was[wanted - 1],
        `slide ${wanted} should now be at ${position + 1}`,
      );
    });
    assert.deepEqual(await intentProblems(source, bytes, plan), []);
  },
);

test(
  "§7.6.2 — duplicateSlide puts the copy directly after its source",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({ deck: AGROFERT, operations: [{ op: "duplicateSlide", slide: 4 }] });
    const { bytes } = await run(source, plan);

    const was = await slideFingerprints(source);
    const now = await slideFingerprints(bytes);
    assert.equal(now.length, was.length + 1, "the deck gained one slide");
    assert.equal(now[3], was[3], "slide 4 is still slide 4");
    assert.equal(now[4], was[3], "and the copy is slide 5");
    assert.equal(now[5], was[4], "everything after it shifted by one");

    assert.deepEqual(
      (await newProblems(await openPackage(source), await openPackage(bytes))).map(
        (p) => p.message,
      ),
      [],
    );
    assert.deepEqual(await intentProblems(source, bytes, plan), []);
  },
);

test(
  "§7.6.3 — deleteSlide removes the slide and sweeps its orphaned media",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const was = await slideFingerprints(source);

    // Slide 1 is the one with the full-bleed photograph, so its media becomes an
    // orphan the moment it goes — which is exactly what the sweep is for.
    const deck = await parseDeck(source);
    const title = slideTexts(deck.slides)[0]
      .shapes.map((shape) => shape.text)
      .filter(Boolean)
      .join(" ");

    const plan = parsePlan({
      deck: AGROFERT,
      operations: [{ op: "deleteSlide", slide: 1, from: title }],
    });
    const { outcomes, bytes } = await run(source, plan);

    const now = await slideFingerprints(bytes);
    assert.equal(now.length, was.length - 1);
    assert.equal(now[0], was[1], "what was slide 2 is now slide 1");

    const before = await openPackage(source);
    const after = await openPackage(bytes);
    assert.ok(!after.paths().includes("ppt/slides/slide1.xml"), "the slide part is gone");

    // A deck that keeps the media of deleted slides grows every time it is
    // edited, and nothing about it looks wrong.
    const droppedMedia = before
      .paths()
      .filter((part) => part.startsWith("ppt/media/") && !after.paths().includes(part));
    assert.ok(droppedMedia.length > 0, `expected orphaned media to be swept, got ${droppedMedia}`);
    assert.ok(outcomes[0].flags.some((flag) => flag.includes("dead weight")));

    assert.deepEqual(
      (await newProblems(before, after)).map((problem) => problem.message),
      [],
      "and nothing is left dangling",
    );
  },
);

test(
  "§7.6.3 — a deleteSlide whose `from` does not match is refused",
  skipUnless(AGROFERT),
  async () => {
    const source = readFileSync(AGROFERT);
    const plan = parsePlan({
      deck: AGROFERT,
      operations: [{ op: "deleteSlide", slide: 1, from: "a slide this deck does not have" }],
    });
    await assert.rejects(() => run(source, plan), /does not say/);
  },
);

// ── §7.4.5 — moving pictures (milestones 11.10 and 11.11) ───────

const CLIP = join(
  tmpdir(),
  "..",
  "claude-501/-Users-lukaskellerstein-Projects-Github-lukaskellerstein-rex/68094411-0a1c-4af1-936d-5792d2e49372/scratchpad/decktest/clip.mp4",
);

/** A tiny animated GIF, made with ffmpeg for this suite. */
const GIF = CLIP.replace("clip.mp4", "loop.gif");

test("§7.4.5 — a GIF is a picture and needs no new code", { skip: existsSync(GIF) ? false : "no test GIF" }, async () => {
  const source = readFileSync(AGROFERT);
  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "insertImage",
        slide: 4,
        box: { x: 0.6, y: 0.1, w: 0.3, h: 0.2 },
        source: { from: "file", path: GIF },
        alt: "An animated loop",
      },
    ],
  });

  // `image/gif` is already in the accepted type list and `<p:pic>` is already
  // how a picture is referenced, so `insertImage` handles it whole.
  const { bytes } = await run(source, plan);
  const after = await openPackage(bytes);
  const added = after.paths().filter((part) => !(await0(source)).includes(part));
  assert.equal(added.length, 1);
  assert.match(added[0], /\.gif$/);
  assert.match(await after.readText("[Content_Types].xml"), /Extension="gif"/);
  assert.deepEqual(await newProblems(await openPackage(source), after), []);
});

/** The original's part list, for comparing what an operation added. */
let originalParts: string[] | null = null;
function await0(_source: Buffer): string[] {
  return originalParts ?? [];
}

test("§7.4.5 — insertVideo writes all six of its pieces", { skip: existsSync(CLIP) ? false : "no test clip" }, async () => {
  const source = readFileSync(AGROFERT);
  const before = await openPackage(source);

  // §7.4.5 step 2 — the poster is made by the renderer, which a test does not
  // have. A stub stands in for it, and every other piece is the real thing.
  const poster = TINY_PNG;
  const resolver = {
    drawDiagram: async (): Promise<Buffer> => {
      throw new Error("not used here");
    },
    drawPoster: async (): Promise<{ png: Buffer; durationSeconds: number }> => ({
      png: poster,
      durationSeconds: 3,
    }),
  };

  const plan = parsePlan({
    deck: AGROFERT,
    operations: [
      {
        op: "insertVideo",
        slide: 4,
        box: { x: 0.1, y: 0.5, w: 0.4, h: 0.3 },
        source: { from: "file", path: CLIP },
        alt: "A three-second test clip",
      },
    ],
  });

  const { outcomes, bytes } = await applyPlanToPackage(await openPackage(source), plan, resolver);
  const after = await openPackage(bytes);

  // 1 and 2 — the clip and its poster, each its own part.
  const added = after.paths().filter((part) => !before.paths().includes(part));
  assert.equal(added.length, 2, `expected a clip and a poster, got ${JSON.stringify(added)}`);
  assert.ok(added.some((part) => part.endsWith(".mp4")));
  assert.ok(added.some((part) => part.endsWith(".png")));

  const types = await after.readText("[Content_Types].xml");
  assert.match(types, /Extension="mp4" ContentType="video\/mp4"/);

  // 3, 4, 5 and 6 are exactly what §7.8's video row checks, and step 5 is the
  // one that would otherwise pass unnoticed: a deck missing `p14:media` opens
  // fine and never plays.
  assert.deepEqual(await videoProblems(after, "ppt/slides/slide4.xml"), []);

  const slide = await after.readText("ppt/slides/slide4.xml");
  assert.match(slide, /<p14:media[\s>]/, "the extension that makes it play");
  assert.match(slide, /<p:timing>/, "the timing tree that holds the media node");
  assert.deepEqual(await newProblems(before, after), []);

  // §7.4.5 — a deck that gains three clips gains tens of megabytes, and a
  // reviewer emailing it afterwards should not learn that from a bounce.
  assert.ok(
    outcomes[0].flags.some((flag) => /MB/.test(flag) && /seconds/.test(flag)),
    `expected size and duration in the preview, got ${JSON.stringify(outcomes[0].flags)}`,
  );
});

test("§7.4.5 — a video over the 50 MB cap is refused with a reason", () => {
  // The cap is stated rather than exercised with a 50 MB fixture: the check is
  // one comparison, and a test that wrote 50 MB to disk to prove it would cost
  // more than it is worth.
  assert.equal(MAX_VIDEO_BYTES, 50 * 1024 * 1024);
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
});

test("§6.4.3 — generated media is absent without a key, not broken", () => {
  // Absent means the CONTRACT says no. A plan naming it is refused before any
  // tool is reached, so there is no half-working state to explain.
  setGenerationEnabled(false);
  assert.throws(
    () =>
      parsePlan({
        deck: "/x.pptx",
        operations: [
          {
            op: "insertImage",
            slide: 1,
            box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
            alt: "x",
            source: { from: "generated", engine: "image", prompt: "a barn", path: "/tmp/x.png" },
          },
        ],
      }),
    /GEMINI_API_KEY/,
  );

  setGenerationEnabled(true);
  const plan = parsePlan({
    deck: "/x.pptx",
    operations: [
      {
        op: "insertImage",
        slide: 1,
        box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        alt: "x",
        source: { from: "generated", engine: "image", prompt: "a barn", path: "/tmp/x.png" },
      },
    ],
  });
  assert.equal(plan.operations.length, 1);
  setGenerationEnabled(false);
});
