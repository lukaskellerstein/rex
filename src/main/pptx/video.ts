// Spec 11 §7.4.5 — a GIF is a picture, a video is not.
//
// This is the sentence that decides how much work moving pictures cost, and the
// two cases are much further apart than they look.
//
// **An animated GIF is an image part and nothing else.** `image/gif` is already
// in the accepted type list, `<p:pic>` is already how a picture is referenced,
// and §4.8 measured that REX's reader animates it for free. `insertImage`
// handles it with no code in this file at all.
//
// **A video is six things at once**, and this file is those six:
//
//   1. `ppt/media/mediaN.mp4`, with a `video/mp4` content type.
//   2. **A poster frame image** — its own media part, its own content type. A
//      video with no poster is a black rectangle in the editing view.
//   3. Two relationships on the slide: one of type `…/video` for the file, one
//      of type `…/image` for the poster.
//   4. A `<p:pic>` whose `<p:nvPicPr><p:nvPr>` carries `<a:videoFile r:link>`.
//   5. **A `<p:extLst>` holding the `p14:media` extension.** This is the part
//      that decides whether PowerPoint treats the shape as a playable video or
//      as an inert picture of one, and it is the piece most easily left out
//      **because the file opens either way**.
//   6. A `<p:timing>` entry so the media node exists on the slide.
//
// Step 5 fails silently, so §7.8 checks for it explicitly rather than inferring
// it from the file opening.

import { escapeXml, firstElement, splice } from "../ooxml/xml.ts";

/** The `p:ext` uri PowerPoint uses for the media extension. Not ours to choose. */
const MEDIA_EXT_URI = "{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}";
const P14_NS = "http://schemas.microsoft.com/office/powerpoint/2010/main";

export interface VideoPicInput {
  id: number;
  name: string;
  alt: string;
  /** The `…/video` relationship, for steps 4 and 5. */
  videoRelationshipId: string;
  /** The `…/image` relationship for the poster, for step 2. */
  posterRelationshipId: string;
  box: { x: number; y: number; cx: number; cy: number };
}

/**
 * Steps 4 and 5 — the picture element, and the extension that makes it play.
 *
 * `<a:videoFile r:link>` alone produces a file PowerPoint opens happily and
 * never plays: it draws the poster and nothing happens on click. The
 * `p14:media` extension beside it is what turns the shape into a media node,
 * and because the file opens either way its absence looks exactly like success.
 */
export function videoPicXml(input: VideoPicInput): string {
  return (
    `<p:pic><p:nvPicPr>` +
    `<p:cNvPr id="${input.id}" name="${escapeXml(input.name)}" descr="${escapeXml(input.alt)}"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
    `<p:nvPr>` +
    `<a:videoFile r:link="${escapeXml(input.videoRelationshipId)}"/>` +
    `<p:extLst><p:ext uri="${MEDIA_EXT_URI}">` +
    `<p14:media xmlns:p14="${P14_NS}" r:embed="${escapeXml(input.videoRelationshipId)}"/>` +
    `</p:ext></p:extLst>` +
    `</p:nvPr></p:nvPicPr>` +
    // The poster is what fills the shape: a video element on a slide *is* a
    // picture, with a media node attached to it.
    `<p:blipFill><a:blip r:embed="${escapeXml(input.posterRelationshipId)}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${input.box.x}" y="${input.box.y}"/>` +
    `<a:ext cx="${input.box.cx}" cy="${input.box.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

/** The media node for one shape, as it sits inside a slide's timing tree. */
function mediaNodeXml(shapeId: number, timingId: number): string {
  return (
    `<p:video><p:cMediaNode vol="80000">` +
    `<p:cTn id="${timingId}" fill="hold" display="0">` +
    `<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>` +
    `</p:cTn>` +
    `<p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl>` +
    `</p:cMediaNode></p:video>`
  );
}

/**
 * Step 6 — the slide's timing tree, with this video's media node in it.
 *
 * A slide that has never held media has no `<p:timing>` at all, so the whole
 * tree is written; one that already has media only needs its node adding to the
 * existing `<p:childTnLst>`. Getting that wrong the other way — writing a
 * second `<p:timing>` — is a file PowerPoint offers to repair.
 *
 * `<p:timing>` sits after `<p:clrMapOvr>` and before `<p:extLst>` in `<p:sld>`,
 * and OOXML's schema is order-sensitive about it.
 */
export function withMediaTiming(slideXml: string, shapeId: number): string {
  const existing = firstElement(slideXml, "p:timing");

  if (existing) {
    // The main sequence's sibling list is where a media node belongs.
    const childList = firstElement(slideXml, "p:childTnLst", existing.openEnd, existing.innerEnd);
    if (childList) {
      return splice(
        slideXml,
        childList.innerEnd,
        childList.innerEnd,
        mediaNodeXml(shapeId, nextTimingId(slideXml)),
      );
    }
    return slideXml;
  }

  const timing =
    `<p:timing><p:tnLst>` +
    `<p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek">` +
    `<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst/></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq>` +
    mediaNodeXml(shapeId, 3) +
    `</p:childTnLst></p:cTn></p:par>` +
    `</p:tnLst></p:timing>`;

  const slide = firstElement(slideXml, "p:sld");
  if (!slide) throw new Error("This slide part has no <p:sld> element.");
  const extensions = firstElement(slideXml, "p:extLst", slide.openEnd, slide.innerEnd);
  const at = extensions ? extensions.start : slide.innerEnd;
  return splice(slideXml, at, at, timing);
}

/** A `<p:cTn id>` nothing in the slide's timing tree already uses. */
function nextTimingId(slideXml: string): number {
  let highest = 2;
  for (const match of slideXml.matchAll(/<p:cTn\s[^>]*\sid="(\d+)"/g)) {
    const id = Number(match[1]);
    if (id > highest) highest = id;
  }
  return highest + 1;
}
