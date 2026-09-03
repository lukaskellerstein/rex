// Spec 11 §7.3 — the XML primitives every edit operation is built from.
//
// Spec 19 §3.1 moved this out of `pptx/`: WordprocessingML needs exactly the
// same scanners, for exactly the same reason, so a deck and a Word file share
// them. Nothing here names a slide.
//
// String surgery, deliberately. Parsing a slide part with a DOM and serialising
// it back rewrites the whole file — attribute order, namespace declarations,
// self-closing style, entity choices — and a deck REX changed one sentence in
// would come back different in ten thousand places. §7.8 has to be able to say
// "nothing it did not name changed", and that is only provable if the bytes it
// did not name are the bytes that were there.
//
// `@xmldom/xmldom` still earns its place: it builds the *new* fragments a
// picture or a text box needs (§3). Building is safe; re-serialising is not.
//
// These scanners assume well-formed OOXML with no comments, CDATA sections or
// processing instructions inside the body — which is what every part in every
// deck on this machine is. A part that broke that assumption would fail the
// round-trip re-parse in §7.8 rather than corrupt anything silently.

export function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

/** One element, as offsets into the string it was found in. */
export interface ElementSpan {
  /** Index of the `<`. */
  start: number;
  /** Index just past the open tag's `>`. */
  openEnd: number;
  /** Index of the `<` of the close tag, or `openEnd` when self-closing. */
  innerEnd: number;
  /** Index just past the close tag's `>`. */
  end: number;
  selfClosing: boolean;
}

/**
 * The end of the tag that starts at `at`, honouring quoted attribute values.
 *
 * A bare `indexOf(">")` is wrong on `<a:t val="a &gt; b">`-shaped markup and on
 * any attribute holding a literal angle bracket, and both appear in real decks.
 */
function tagEnd(xml: string, at: number): number {
  let quote: string | null = null;
  for (let i = at; i < xml.length; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === ">") return i + 1;
  }
  return -1;
}

/** True when `<name` at `at` is the whole element name and not a prefix of one. */
function isTagAt(xml: string, at: number, name: string): boolean {
  if (!xml.startsWith(`<${name}`, at)) return false;
  const next = xml[at + name.length + 1];
  return (
    next === ">" || next === "/" || next === " " || next === "\t" || next === "\n" || next === "\r"
  );
}

/**
 * Every `name` element in `[from, to)`, at the top level of nesting *within
 * that range* — nested ones of the same name are skipped, because an operation
 * that names a shape means the shape and not the shapes inside it.
 */
export function scanElements(
  xml: string,
  name: string,
  from = 0,
  to: number = xml.length,
): ElementSpan[] {
  const found: ElementSpan[] = [];
  const close = `</${name}>`;

  let i = from;
  while (i < to) {
    if (!isTagAt(xml, i, name)) {
      i++;
      continue;
    }
    const openEnd = tagEnd(xml, i);
    if (openEnd === -1 || openEnd > to) break;

    if (xml[openEnd - 2] === "/") {
      found.push({ start: i, openEnd, innerEnd: openEnd, end: openEnd, selfClosing: true });
      i = openEnd;
      continue;
    }

    // Walk to the matching close, counting nested opens of the same name.
    let depth = 1;
    let j = openEnd;
    while (j < to && depth > 0) {
      if (isTagAt(xml, j, name)) {
        const nested = tagEnd(xml, j);
        if (nested === -1) break;
        if (xml[nested - 2] !== "/") depth++;
        j = nested;
        continue;
      }
      if (xml.startsWith(close, j)) {
        depth--;
        j += close.length;
        continue;
      }
      j++;
    }
    if (depth !== 0) break;

    found.push({
      start: i,
      openEnd,
      innerEnd: j - close.length,
      end: j,
      selfClosing: false,
    });
    i = j;
  }

  return found;
}

/** The first `name` element in the range, or null. */
export function firstElement(
  xml: string,
  name: string,
  from = 0,
  to: number = xml.length,
): ElementSpan | null {
  const found = scanElements(xml, name, from, to);
  return found[0] ?? null;
}

/** An attribute's value on the open tag of `span`, unescaped. */
export function attributeOf(xml: string, span: ElementSpan, name: string): string | null {
  const tag = xml.slice(span.start, span.openEnd);
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? unescapeXml(match[1]) : null;
}

/**
 * The same open tag with one attribute set — added when absent, replaced when
 * present, and nothing else on the tag touched.
 */
export function withAttribute(openTag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*")[^"]*(")`);
  if (pattern.test(openTag)) return openTag.replace(pattern, `$1${escapeXml(value)}$2`);
  const selfClosing = openTag.endsWith("/>");
  const head = openTag.slice(0, selfClosing ? -2 : -1).trimEnd();
  return `${head} ${name}="${escapeXml(value)}"${selfClosing ? "/>" : ">"}`;
}

/** Replaces `[start, end)` of `xml` with `replacement`. */
export function splice(xml: string, start: number, end: number, replacement: string): string {
  return xml.slice(0, start) + replacement + xml.slice(end);
}
