// The paper's own copy of DM Sans.
//
// A FontFaceSet belongs to a *document*, not to an origin. The faces main.tsx
// registers are therefore visible to REX's chrome and to nothing else — the
// document renders in a srcdoc iframe with its own document, so the paper's
// `font: 15px/1.68 "DM Sans", system-ui` silently fell through to system-ui.
// Measured on 2026-08-22: inside the frame, "DM Sans" and a family that does
// not exist produced the identical text width, while the same string in the
// chrome was 1.5px narrower. Nothing logs a word about it, which is why the
// previous face name survived a whole palette unnoticed.
//
// Same-origin is what makes the fix cheap: the renderer can build a FontFace in
// the frame's own realm and hand it the URL Vite emitted. No `@font-face` in
// the stylesheet, so the document's own `base` href cannot break the path, and
// no base64 in the srcdoc string.
//
// Three weights, because REX's paper stylesheet asks for three: body at 400,
// headings and table headers at 600, and `strong` at the browser's own bold.
// Italic is left to the engine's synthetic oblique, exactly as before — the
// design system ships DM Sans upright only.

import dmSans400 from "@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2?url";
import dmSans600 from "@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff2?url";
import dmSans700 from "@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff2?url";

/** Resolved against the renderer's own URL, never the document's `base` href. */
const FACES: ReadonlyArray<{ weight: string; url: string }> = [
  { weight: "400", url: dmSans400 },
  { weight: "600", url: dmSans600 },
  { weight: "700", url: dmSans700 },
];

/**
 * Registers DM Sans inside a document frame.
 *
 * Must finish before anything measures the page. A face that arrives after the
 * anchor resolver has built its text index reflows every line under it, and the
 * rects the resolver already took then point a few lines off — the failure this
 * whole component is built to avoid.
 *
 * A face that fails to load is not fatal: the paper falls back to system-ui,
 * which is what it did before this existed.
 */
export async function addPaperFonts(frame: Window): Promise<void> {
  // Only the two pages REX writes itself. Sanitised author HTML keeps its own
  // styles (spec 01 §5.4 point 3), and a family that is suddenly available is
  // a change to how that document looks — small, but not REX's to make.
  if (!frame.document.documentElement.hasAttribute("data-rex-paper")) return;

  // The frame's own constructor, not the renderer's: a FontFace built in one
  // realm cannot be added to another realm's set. `lib.dom` does not put
  // `FontFace` on `Window`, so the shape is named here rather than cast to any.
  const realm = frame as Window & { FontFace: typeof FontFace };
  await Promise.all(
    FACES.map(async ({ weight, url }) => {
      const absolute = new URL(url, window.location.href).href;
      const face = new realm.FontFace("DM Sans", `url(${JSON.stringify(absolute)})`, { weight });
      await face.load();
      frame.document.fonts.add(face);
    }),
  );
}
