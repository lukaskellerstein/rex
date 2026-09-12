// Spec 53 §5.3 — what to do with a link the reviewer clicked.
//
// A thin layer over spec 02's `resolveTarget()`, which already turns an `href`
// into a path, a fragment and whether the file is there. That function answers
// the reference graph, which draws every link it finds; this one answers a
// gesture, which has to decide whether to *act*. The two judgements a graph
// never needs are here and nowhere else:
//
//   1. a file that exists but is not a format REX renders is refused, by name;
//   2. a URL scheme is handed to the operating system only if it is on the
//      list below.
//
// Both live in main because both are guards. The renderer displays untrusted
// document content (invariant I2), so a scheme it vouched for would be a scheme
// the document chose.
//
// Nothing here imports `electron`. `ipc.ts` makes the `shell.openExternal`
// call, so this module stays loadable under plain `node --test` — the same rule
// that keeps `workspace/links.ts` testable without a browser.

import { homedir } from "node:os";
import { basename, sep } from "node:path";
import type { LinkResolution } from "../shared/types.ts";
import { isDocumentPath, unopenableReason } from "./render/formats.ts";
import { resolveTarget } from "./workspace/links.ts";

/**
 * The only schemes REX hands to the operating system.
 *
 * `shell.openExternal` starts whatever the OS has registered for a scheme, and
 * the string comes out of a document REX did not write. Three are enough for
 * documentation: two web schemes and mail. Anything else is refused by name, so
 * the reviewer sees that REX declined rather than that nothing happened.
 */
export const EXTERNAL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

/** `href` values that name a protocol rather than a path. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Spec 53 §4.7 — an absolute path, written the way a person reads one.
 *
 * Home becomes `~`, which is the house rule for every machine path REX shows
 * (`rules/11-communication.md`). Only main can do this, because only main knows
 * where home is, and this string is never what anything opens.
 */
export function displayPath(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/**
 * Spec 53 §2 — the five answers.
 *
 * `from` is the absolute path of the document the link is in; `href` is exactly
 * what the author wrote.
 */
export function resolveForClick(from: string, href: string): LinkResolution {
  const trimmed = href.trim();

  // A protocol-relative `//host/path` carries the page's own scheme, and the
  // page is `rex-doc:`. Read as the web address the author meant.
  if (trimmed.startsWith("//")) return externalOrRefused(`https:${trimmed}`);
  if (HAS_SCHEME.test(trimmed)) return externalOrRefused(trimmed);

  const target = resolveTarget(from, trimmed);
  if (target.kind === "url") return externalOrRefused(trimmed);
  if (target.kind === "self") {
    const hash = trimmed.indexOf("#");
    const fragment = hash === -1 ? null : trimmed.slice(hash + 1) || null;
    return { kind: "self", fragment };
  }

  // §4.7 — a refusal carries the path it would have opened as well as the
  // sentence, because the hover tip shows both: where the link points, and why
  // it will not go there.
  const display = displayPath(target.path);
  const name = basename(target.path);
  if (!target.exists) {
    return { kind: "refused", reason: `No such file: ${name}`, display, fragment: target.fragment };
  }
  if (!isDocumentPath(target.path)) {
    return {
      kind: "refused",
      reason: `REX cannot open ${name}. ${unopenableReason(target.path)}`,
      display,
      fragment: target.fragment,
    };
  }
  return { kind: "document", path: target.path, display, fragment: target.fragment };
}

/**
 * §4.6 — the guard `ipc.ts` runs immediately before `shell.openExternal`.
 *
 * The scheme is checked twice on purpose. `resolveForClick` answered it once,
 * but the renderer sits between the two calls and the URL it sends back is a
 * string from a document. This is the check that decides, and the first one is
 * a convenience.
 */
export function checkedExternalUrl(url: string): string {
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }
  if (!EXTERNAL_SCHEMES.has(scheme)) throw new Error(`REX does not open ${scheme} links.`);
  return url;
}

function externalOrRefused(url: string): LinkResolution {
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return {
      kind: "refused",
      reason: `REX does not understand this link: ${url}`,
      display: null,
      fragment: null,
    };
  }
  return EXTERNAL_SCHEMES.has(scheme)
    ? { kind: "external", url }
    : {
        kind: "refused",
        reason: `REX does not open ${scheme} links.`,
        display: null,
        fragment: null,
      };
}
