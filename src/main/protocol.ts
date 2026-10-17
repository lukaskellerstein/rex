// The `rex-doc://` scheme, which lets a document's own images and stylesheets
// load while the document itself stays in a same-origin srcdoc iframe.
//
// This is not a server and not a port (invariant I3) — it is Electron's own
// protocol handler, in-process. It is deliberately not a general file reader:
// only directories a document has actually been opened from are served.

import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { net, protocol } from "electron";
import { headersFor } from "./docHeaders.ts";

export const DOC_SCHEME = "rex-doc";

const roots = new Set<string>();

/** Serves everything under `directory`. Called once per document opened. */
export function allowDirectory(directory: string): void {
  roots.add(resolve(directory));
}

function isAllowed(path: string): boolean {
  const target = resolve(path);
  for (const root of roots) {
    if (target === root || target.startsWith(root + sep)) return true;
  }
  return false;
}

/** Must run before `app.ready`. */
export function registerDocSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DOC_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/** Must run after `app.ready`. */
export function registerDocProtocol(): void {
  protocol.handle(DOC_SCHEME, async (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (!isAllowed(path)) {
      return new Response("Not served by REX", { status: 403 });
    }
    try {
      const bytes = await readFile(path);
      return new Response(new Uint8Array(bytes), { headers: headersFor(path) });
    } catch {
      return net
        .fetch(request.url, { bypassCustomProtocolHandlers: true })
        .catch(() => new Response("Not found", { status: 404 }));
    }
  });
}

/** The `<base href>` a document's relative URLs resolve against. */
export function baseHrefFor(directory: string): string {
  const encoded = resolve(directory)
    .split(sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${DOC_SCHEME}://doc${encoded}/`;
}
