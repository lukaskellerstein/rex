// Spec 11 §4.3 — one slide, as HTML.
//
// Split out of `pptx.ts` because the two jobs are genuinely different: that
// module opens the file, caches its media and decides what the reviewer is
// shown; this one turns the library's element tree into the markup §4.3 makes
// a contract. Every rule in that contract is implemented here and nowhere else.
//
// Nothing in this file converts a coordinate. The library reports points, the
// slide box is points, and the numbers are written through untouched.

import type {
  Audio,
  Chart,
  Element as DeckElement,
  Diagram,
  Fill,
  Group,
  Image,
  Math as MathElement,
  Shape,
  Slide,
  Table,
  Text,
  Video,
} from "pptxtojson/dist/index.js";

/** `ppt/media/imageN.png` → a `rex-doc://` URL, or null when it was not cached. */
export type MediaUrl = (ref: string) => string | null;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

/** A length in points, with the library's precision kept and its noise dropped. */
function pt(value: number): string {
  return `${Math.round(value * 1000) / 1000}pt`;
}

/**
 * §4.5 trap 1 — the library puts a non-breaking space between every pair of
 * words. Left alone, body text does not wrap and runs out of its card.
 *
 * Only the separator is replaced. Anchoring was never at risk either way:
 * `textIndex.ts` collapses on `/\s/`, which matches U+00A0 already.
 */
function normaliseText(html: string): string {
  return html.replace(/&nbsp;| /g, " ");
}

/** True when a shape's `content` holds no text at all — an empty paragraph. */
function isBlank(content: string | undefined): boolean {
  return !content || content.replace(/<[^>]*>/g, "").trim().length === 0;
}

// ── Fill, border and shadow ─────────────────────────────────

/**
 * OOXML measures a linear gradient's angle clockwise from the positive x-axis;
 * CSS measures it clockwise from "to top". The quarter turn between them is the
 * whole conversion.
 */
function gradientCss(fill: Extract<Fill, { type: "gradient" }>): string {
  const stops = fill.value.colors.map((stop) => `${stop.color} ${stop.pos}`).join(", ");
  if (fill.value.path === "line") return `linear-gradient(${fill.value.rot + 90}deg, ${stops})`;
  return `radial-gradient(circle at 50% 50%, ${stops})`;
}

/** The CSS `background` for a fill, or null when the shape has none. */
function backgroundCss(fill: Fill | null | undefined, media: MediaUrl): string | null {
  if (!fill) return null;
  if (fill.type === "color") return fill.value;
  if (fill.type === "gradient") return gradientCss(fill);
  if (fill.type === "pattern") return fill.value.foregroundColor;
  const url = media(fill.value.ref);
  return url ? `center / cover no-repeat url("${escapeHtml(url)}")` : null;
}

interface Bordered {
  borderColor?: string;
  borderWidth?: number;
  borderType?: "solid" | "dashed" | "dotted";
}

function hasBorder(el: Bordered): boolean {
  return (el.borderWidth ?? 0) > 0;
}

function borderCss(el: Bordered): string {
  return `${pt(el.borderWidth ?? 0)} ${el.borderType ?? "solid"} ${el.borderColor ?? "#000000"}`;
}

/**
 * A drop shadow, on the wrapper rather than on the box.
 *
 * `filter: drop-shadow` follows the drawn shape, so a rounded card, an inline
 * SVG chevron and a photograph all get the shadow PowerPoint drew rather than
 * the shadow of their bounding box.
 */
function shadowCss(
  shadow: { h: number; v: number; blur: number; color: string } | undefined,
): string {
  if (!shadow) return "";
  return `filter:drop-shadow(${pt(shadow.h)} ${pt(shadow.v)} ${pt(shadow.blur)} ${shadow.color});`;
}

/** Rotation and the two flips, as one transform. */
function transformCss(el: { rotate?: number; isFlipH?: boolean; isFlipV?: boolean }): string {
  const parts: string[] = [];
  if (el.rotate) parts.push(`rotate(${el.rotate}deg)`);
  if (el.isFlipH) parts.push("scaleX(-1)");
  if (el.isFlipV) parts.push("scaleY(-1)");
  return parts.length > 0 ? `transform:${parts.join(" ")};` : "";
}

// ── Geometry ────────────────────────────────────────────────

const V_ALIGN: Record<string, string> = {
  up: "flex-start",
  mid: "center",
  down: "flex-end",
};

/**
 * §4.3 rule 5 — a `line` shape legitimately has a zero width or height, and a
 * zero-size box is both invisible and unclickable. 408 of them appear on one of
 * the acceptance decks (§2.2), so this is the common case and not an edge.
 *
 * Drawn as a border on the edge the line sits on, inside a box given a small
 * minimum extent. The rule lands on exactly the same pixel row it would have,
 * because a border paints on the box's edge — the extra couple of points are
 * hit area behind it and nothing else.
 */
const LINE_HIT_AREA = 2;

function isRule(el: Shape): boolean {
  return el.shapType === "line" && (el.width === 0 || el.height === 0);
}

function ruleHtml(el: Shape): { size: string; body: string } {
  const side = el.height === 0 ? "border-top" : "border-left";
  const size =
    el.height === 0
      ? `width:${pt(el.width)};height:${pt(LINE_HIT_AREA)};`
      : `width:${pt(LINE_HIT_AREA)};height:${pt(el.height)};`;
  const width = el.borderWidth && el.borderWidth > 0 ? el.borderWidth : 1;
  return {
    size,
    body: `${side}:${pt(width)} ${el.borderType ?? "solid"} ${el.borderColor ?? "#000000"};`,
  };
}

/**
 * Non-rectangular geometry, as an inline SVG behind the shape's text.
 *
 * The viewBox is the library's own path box, so the drawing is the path it
 * computed at the size the shape actually is. Only eight preset geometries
 * appear across every deck on this machine (§2.1) and all eight arrive as a
 * path, so there is no per-geometry code here at all.
 */
function geometrySvg(el: Shape, id: string, media: MediaUrl): string {
  const box = el.pathViewBox;
  if (!el.path || !box || box.width <= 0 || box.height <= 0) return "";

  const background = backgroundCss(el.fill, media);
  const isFlat = el.fill?.type === "color" || el.fill?.type === "pattern";
  const gradient = el.fill?.type === "gradient" ? el.fill : null;

  let defs = "";
  let fill = "none";
  if (gradient) {
    const gradientId = `${id}-grad`;
    const stops = gradient.value.colors
      .map((stop) => `<stop offset="${stop.pos}" stop-color="${stop.color}"/>`)
      .join("");
    // `gradientTransform` on a userSpaceOnUse gradient would need the box; the
    // objectBoundingBox default plus a rotation about the centre is equivalent
    // and needs no numbers from here.
    defs = `<defs><linearGradient id="${escapeHtml(gradientId)}" gradientTransform="rotate(${gradient.value.rot + 90} 0.5 0.5)">${stops}</linearGradient></defs>`;
    fill = `url(#${escapeHtml(gradientId)})`;
  } else if (isFlat && background) {
    fill = background;
  }

  const stroke = hasBorder(el)
    ? ` stroke="${el.borderColor ?? "#000000"}" stroke-width="${el.borderWidth}"${dashArray(el)}`
    : "";

  return `<svg class="rex-geom" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" preserveAspectRatio="none">${defs}<path d="${escapeHtml(el.path)}" fill="${escapeHtml(fill)}"${stroke}/></svg>`;
}

function dashArray(el: Shape): string {
  const dash = el.borderStrokeDasharray;
  return dash && dash !== "0" ? ` stroke-dasharray="${escapeHtml(dash)}"` : "";
}

// ── Elements ────────────────────────────────────────────────

interface Context {
  media: MediaUrl;
}

/** The text body of a shape, vertically aligned the way PowerPoint aligned it. */
function textHtml(content: string | undefined, vAlign: string | undefined): string {
  if (isBlank(content)) return "";
  const justify = V_ALIGN[vAlign ?? "up"] ?? "flex-start";
  return `<div class="rex-text" style="justify-content:${justify}">${normaliseText(content ?? "")}</div>`;
}

function insetCss(inset: { l: number; t: number; r: number; b: number } | undefined): string {
  if (!inset) return "";
  return `padding:${pt(inset.t)} ${pt(inset.r)} ${pt(inset.b)} ${pt(inset.l)};`;
}

function shapeBody(
  el: Shape | Text,
  id: string,
  context: Context,
): { style: string; body: string } {
  const shape = el as Shape;
  if (shape.type === "shape" && isRule(shape)) {
    const rule = ruleHtml(shape);
    return { style: rule.size + rule.body, body: "" };
  }

  const svg = shape.type === "shape" ? geometrySvg(shape, id, context.media) : "";
  const text = textHtml(el.content, el.vAlign);

  // With an SVG carrying the fill and the border, the box must not draw them a
  // second time — the two would disagree the moment the geometry is not a
  // rectangle.
  if (svg) return { style: "", body: svg + text };

  const background = backgroundCss(el.fill, context.media);
  const style =
    (background ? `background:${background};` : "") +
    (hasBorder(el) ? `border:${borderCss(el)};` : "") +
    (shape.type === "shape" && shape.shapType === "roundRect" ? "border-radius:6pt;" : "");
  return { style, body: text };
}

function imageHtml(el: Image, context: Context): string {
  const url = context.media(el.ref);
  if (!url) return placeholderHtml("Picture", el.ref);

  const rounded = el.geom === "ellipse" ? "border-radius:50%;" : "";
  const crop = el.rect;
  const cropped =
    crop && (crop.t || crop.b || crop.l || crop.r)
      ? cropStyle(crop.l ?? 0, crop.t ?? 0, crop.r ?? 0, crop.b ?? 0)
      : null;

  const img = `<img class="rex-media" src="${escapeHtml(url)}" alt="" style="${rounded}${cropped ?? ""}">`;
  // A crop needs a clipping parent; without one the oversized image paints over
  // its neighbours instead of being trimmed.
  return cropped ? `<div class="rex-crop" style="${rounded}">${img}</div>` : img;
}

/**
 * PowerPoint's `srcRect` names how much of each edge to throw away, as
 * fractions. The visible fraction is what the image has to be scaled up by, and
 * the discarded left and top are what it has to be pulled back by.
 */
function cropStyle(left: number, top: number, right: number, bottom: number): string {
  const visibleW = Math.max(1 - left - right, 0.001);
  const visibleH = Math.max(1 - top - bottom, 0.001);
  return (
    `position:absolute;width:${(100 / visibleW).toFixed(3)}%;height:${(100 / visibleH).toFixed(3)}%;` +
    `left:${(-100 * (left / visibleW)).toFixed(3)}%;top:${(-100 * (top / visibleH)).toFixed(3)}%;`
  );
}

/**
 * §4.8 — a video is an ordinary element, and the sandbox does not stop it
 * playing: measured on 2026-08-24, a `<video>` in a frame with no
 * `allow-scripts` painted and advanced. It does not autoplay, because a
 * reviewer scrolling a deck should not be ambushed by five clips at once.
 */
function videoHtml(el: Video, context: Context): string {
  const url = context.media(el.ref);
  if (!url) return placeholderHtml("Video", el.ref);
  return `<video class="rex-media" src="${escapeHtml(url)}" controls muted preload="metadata" playsinline></video>`;
}

/** §4.8 — audio is drawn as a labelled placeholder, never played. */
function audioHtml(el: Audio): string {
  return placeholderHtml("Audio", el.ref);
}

/**
 * §4.8 — a chart is whatever the library gives, and it gives data rather than a
 * picture. Naming the chart and its series is more honest than an empty box and
 * leaves the shape anchorable, which is what a reviewer actually needs from it.
 */
function chartHtml(el: Chart): string {
  const series = Array.isArray(el.data)
    ? el.data
        .map((item) => (typeof item === "object" && item && "key" in item ? String(item.key) : ""))
        .filter(Boolean)
    : [];
  const detail = series.length > 0 ? `${series.length} series: ${series.join(", ")}` : "no series";
  return placeholderHtml(`Chart — ${el.chartType}`, detail);
}

function placeholderHtml(label: string, detail: string): string {
  return `<div class="rex-placeholder"><b>${escapeHtml(label)}</b><span>${escapeHtml(detail)}</span></div>`;
}

function tableHtml(el: Table): string {
  const columns = el.colWidths ?? [];
  const cols = columns.map((width) => `<col style="width:${pt(width)}">`).join("");
  const rows = el.data
    .map((row, r) => {
      const height = el.rowHeights?.[r];
      const cells = row
        .filter((cell) => !cell.hMerge && !cell.vMerge)
        .map((cell) => {
          const span =
            (cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : "") +
            (cell.rowSpan && cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : "");
          const style =
            (cell.fillColor ? `background:${cell.fillColor};` : "") +
            `vertical-align:${cell.vAlign === "mid" ? "middle" : cell.vAlign === "down" ? "bottom" : "top"};` +
            cellBorders(cell.borders);
          return `<td${span} style="${style}">${normaliseText(cell.text ?? "")}</td>`;
        })
        .join("");
      return `<tr${height ? ` style="height:${pt(height)}"` : ""}>${cells}</tr>`;
    })
    .join("");
  return `<table class="rex-table">${cols}<tbody>${rows}</tbody></table>`;
}

function cellBorders(borders: Table["data"][number][number]["borders"]): string {
  const sides = ["top", "bottom", "left", "right"] as const;
  return sides
    .map((side) => {
      const border = borders?.[side];
      return border && border.borderWidth > 0 ? `border-${side}:${borderCss(border)};` : "";
    })
    .join("");
}

/** SmartArt. Untested against a real one (§2.5) — the library returns shapes. */
function diagramHtml(el: Diagram, id: string, context: Context): string {
  return el.elements
    .map((child, index) => elementHtml(child, `${id}-${index + 1}`, context))
    .join("");
}

function mathHtml(el: MathElement, context: Context): string {
  const url = el.picRef ? context.media(el.picRef) : null;
  if (url)
    return `<img class="rex-media" src="${escapeHtml(url)}" alt="${escapeHtml(el.latex ?? "")}">`;
  return `<div class="rex-text" style="justify-content:center">${escapeHtml(el.text ?? el.latex ?? "")}</div>`;
}

/** A group's children carry coordinates relative to the group box — measured. */
function groupHtml(el: Group, id: string, context: Context): string {
  return el.elements
    .map((child, index) => elementHtml(child, `${id}-${index + 1}`, context))
    .join("");
}

const KIND: Record<string, string> = {
  shape: "shape",
  text: "text",
  image: "image",
  table: "table",
  chart: "chart",
  video: "video",
  audio: "audio",
  diagram: "diagram",
  math: "math",
  group: "group",
};

/**
 * §4.3 rules 2 and 3 — one element per shape, with the PowerPoint name on it.
 *
 * The name is what the selection panel, the agent prompt and every edit
 * operation call the shape: "Text 7" means nothing to a reviewer, but it is
 * stable across the re-indexing that makes the id weak (§5.2), and it is the
 * only handle the library exposes that is not a position.
 */
export function elementHtml(el: DeckElement, id: string, context: Context): string {
  const named = "name" in el && el.name ? el.name : (KIND[el.type] ?? el.type);

  let inner = "";
  let extra = "";
  switch (el.type) {
    case "shape":
    case "text": {
      const built = shapeBody(el, id, context);
      extra = built.style + insetCss("textInset" in el ? el.textInset : undefined);
      inner = built.body;
      break;
    }
    case "image":
      inner = imageHtml(el, context);
      break;
    case "video":
      inner = videoHtml(el, context);
      break;
    case "audio":
      inner = audioHtml(el);
      break;
    case "table":
      inner = tableHtml(el);
      break;
    case "chart":
      inner = chartHtml(el);
      break;
    case "diagram":
      inner = diagramHtml(el, id, context);
      break;
    case "math":
      inner = mathHtml(el, context);
      break;
    case "group":
      inner = groupHtml(el, id, context);
      break;
  }

  // A rule sets its own width and height, because the library's are zero.
  const sized = el.type === "shape" && isRule(el);
  const box = sized ? "" : `width:${pt(el.width)};height:${pt(el.height)};`;
  const style =
    `left:${pt(el.left)};top:${pt(el.top)};${box}` +
    transformCss(el as { rotate?: number }) +
    shadowCss("shadow" in el ? el.shadow : undefined) +
    extra;

  return (
    `<div class="rex-shape" id="${escapeHtml(id)}" data-name="${escapeHtml(named)}"` +
    ` data-kind="${escapeHtml(el.type)}" style="${style}">${inner}</div>`
  );
}

/**
 * §4.6 — speaker notes, collapsed. Authored text, so they carry no
 * `data-rex-overlay` and are part of the text index: a note is something a
 * reviewer may legitimately want to comment on.
 */
function notesHtml(note: string | undefined): string {
  if (isBlank(note)) return "";
  return (
    `<details class="rex-notes"><summary>Speaker notes</summary>` +
    `<div class="rex-notes-body">${normaliseText(note ?? "")}</div></details>`
  );
}

/**
 * §4.3 rule 1 — one section per slide, numbered from 1 in presentation order.
 *
 * The notes footer is a sibling of that section rather than a child of it, and
 * that is a deliberate departure from §4.6's wording. `#slide-N` is what a
 * region anchor stores fractions of (§5.1), so its box has to be the slide
 * rectangle and nothing else; a footer inside a box that is `overflow: hidden`
 * at a fixed slide height could not be read anyway.
 */
export function slideHtml(slide: Slide, number: number, media: MediaUrl): string {
  const slideId = `slide-${number}`;
  const context: Context = { media };

  const background = backgroundCss(slide.fill, media);
  // Layout elements paint under the slide's own, which is what they are for.
  const layout = slide.layoutElements
    .map((el, index) => elementHtml(el, `${slideId}-layout-${index + 1}`, context))
    .join("");
  const shapes = slide.elements
    .map((el, index) => elementHtml(el, `${slideId}-shape-${index + 1}`, context))
    .join("");

  return (
    `<div class="rex-slide-wrap">` +
    `<div class="rex-slide-tag" data-rex-overlay>Slide ${number}</div>` +
    `<section class="rex-slide" id="${slideId}" data-slide="${number}"` +
    `${background ? ` style="background:${escapeHtml(background)}"` : ""}>${layout}${shapes}</section>` +
    notesHtml(slide.note) +
    `</div>`
  );
}
