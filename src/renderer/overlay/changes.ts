// Spec 63 — which blocks of one pane the working copy touched, and how.
//
// Two routes, one answer. A page REX typeset from Markdown carries
// `data-src-line`, so the patch's line ranges land on its blocks exactly
// (spec 05 §5.6.1). A page with no stamps — plain HTML, a Word document — is
// compared block by block against the other pane (§3), because there is no line
// to land on.
//
// Read-only, like everything that reaches into the frame: REX never touches the
// document's own tree.

import type { ChangedRegion, LineRange } from "../../shared/types.ts";
import { changedBlocks, type ScopeRect, toDocumentRect } from "../anchor/pick.ts";
import { type ChangeKind, diffBlocks } from "./blockDiff.ts";

export type { ChangeKind } from "./blockDiff.ts";

/** What one pane needs to say what the change did to it. */
export interface PaneChanges {
  /** `old` is the original's pane, `new` the new version's. */
  side: "old" | "new";
  /** This side's runs from the patch — the route for a stamped page. */
  regions: ReadonlyArray<LineRange & Pick<ChangedRegion, "changed">>;
  /**
   * The other pane's page — the route for an unstamped one. Read at call time,
   * because the two frames load in either order; null until it has.
   */
  other: () => Document | null;
}

export interface BlockChange {
  element: Element;
  kind: ChangeKind;
}

/** A changed block's box, in the frame's document pixels. */
export interface ChangeBox extends ScopeRect {
  kind: ChangeKind;
}

/** Spec 63 §4 — red, green and yellow, one class each, in both panes. */
export const OUTLINE_CLASS: Record<ChangeKind, string> = {
  removed: "rex-removed-outline",
  added: "rex-change-outline",
  changed: "rex-rewritten-outline",
};

/**
 * §3.1 — the tags a block can have. An element of one of these with content of
 * its own is a block; one that only wraps other blocks is not.
 */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "CAPTION",
  "DD",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HGROUP",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/** Never part of what a reader sees, so never part of a block's content. */
const UNSEEN_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

export function changesIn(doc: Document, changes: PaneChanges): BlockChange[] {
  if (doc.querySelector("[data-src-line]")) return byLines(doc, changes);
  const other = changes.other();
  if (!other) return [];
  return changes.side === "new" ? byBlocks(other, doc).after : byBlocks(doc, other).before;
}

export function changeBoxesIn(view: Window, doc: Document, changes: PaneChanges): ChangeBox[] {
  return changesIn(doc, changes).map(({ element, kind }) => ({
    ...toDocumentRect(view, element.getBoundingClientRect()),
    kind,
  }));
}

/** §3.3 — a block hit by a rewritten run is rewritten, whatever else hit it. */
function byLines(doc: Document, changes: PaneChanges): BlockChange[] {
  const plain: ChangeKind = changes.side === "new" ? "added" : "removed";
  const rewritten = changedBlocks(
    doc,
    changes.regions.filter((region) => region.changed),
  );
  return changedBlocks(doc, changes.regions).map((element) => ({
    element,
    kind: rewritten.some((hit) => element.contains(hit)) ? "changed" : plain,
  }));
}

function byBlocks(
  before: Document,
  after: Document,
): { before: BlockChange[]; after: BlockChange[] } {
  const oldBlocks = blocksOf(before);
  const newBlocks = blocksOf(after);
  const diff = diffBlocks(
    oldBlocks.map((block) => block.content),
    newBlocks.map((block) => block.content),
  );
  if (!diff) return { before: [], after: [] };
  return {
    before: outermost(
      oldBlocks.map((block, at) => ({ element: block.element, kind: diff.before[at] })),
    ),
    after: outermost(
      newBlocks.map((block, at) => ({ element: block.element, kind: diff.after[at] })),
    ),
  };
}

/**
 * One outline per changed stretch, not one inside another — the same dedupe
 * `changedBlocks` performs for a stamped page.
 */
function outermost(entries: Array<{ element: Element; kind: ChangeKind | null }>): BlockChange[] {
  const changed = entries.filter((entry): entry is BlockChange => entry.kind !== null);
  return changed.filter(
    (entry) => !changed.some((other) => other !== entry && other.element.contains(entry.element)),
  );
}

/** §3.1 — every block of the page, in document order, with its own content. */
function blocksOf(doc: Document): Array<{ element: Element; content: string }> {
  const blocks: Array<{ element: Element; content: string }> = [];
  for (const element of doc.body?.querySelectorAll("*") ?? []) {
    if (!BLOCK_TAGS.has(element.tagName)) continue;
    const inner = ownContent(element);
    if (inner !== "") blocks.push({ element, content: `${tagOf(element)}${inner}` });
  }
  return blocks;
}

/** The block's markup with every nested block left out, whitespace collapsed. */
function ownContent(block: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? "";
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (BLOCK_TAGS.has(element.tagName) || UNSEEN_TAGS.has(element.tagName)) continue;
        out += tagOf(element);
        walk(element);
        out += `</${element.tagName}>`;
      }
    }
  };
  walk(block);
  return out.replace(/\s+/g, " ").trim();
}

/** An opening tag with its attributes in a fixed order, so order never counts. */
function tagOf(element: Element): string {
  const attributes = [...element.attributes]
    .map((attribute) => ` ${attribute.name}="${attribute.value}"`)
    .sort()
    .join("");
  return `<${element.tagName}${attributes}>`;
}
