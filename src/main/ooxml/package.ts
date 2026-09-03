// Spec 11 §7.3 — an OOXML file as a package of parts, opened and written back.
//
// Spec 19 §3.1 moved this out of `pptx/`. Nothing in it was ever about slides,
// and spec 19 §2.3 proved it: all 18 Word files on this machine open here and
// write back with **every part byte-identical**, 0 parts lost, 0 added. A
// `.docx` and a `.pptx` are the same kind of file, so they share this module.
//
// The rule this module exists to keep: **modify only the parts the plan names,
// and write every other entry back with its original compression method.** §2.4
// measured what happens without it — a deck REX barely edited comes back a
// different size — and `pptx-automizer` was rejected for the same reason at a
// larger scale: 139 parts in, 255 parts out.
//
// Spec 19 §2.3 sharpened what "unchanged" means here, and it is worth stating
// exactly: **every part comes back byte-identical, and the zip container does
// not.** Local headers carry timestamps and jszip's deflate level is not
// Office's, so the file's own size can move — measured at up to −9.68% on a
// Word file, −4.21% on a deck — while nothing inside it has changed. The
// invariant the validators check is the part-level one.
//
// Compression is per entry and it genuinely varies. Measured on 2026-08-24: the
// Agrofert deck stores 113 of its 132 parts uncompressed, VOLAREZA deflates all
// 139, and the governed-decision-layer deck stores 78 of 97. Re-deflating a
// stored part, or storing a deflated one, changes every byte of it.

import JSZip from "jszip";

/** The two methods a zip entry can use. Office writes no others. */
type Method = "STORE" | "DEFLATE";

/** JSZip's magic for "stored", i.e. method 0. */
const STORE_MAGIC = "\u0000\u0000";

/**
 * JSZip keeps a loaded entry's compression on a private field, and exposes no
 * accessor for it. The alternative is parsing the zip central directory by
 * hand, so it is read defensively and falls back to DEFLATE — which is what a
 * zip writer would have chosen anyway.
 */
function methodOf(entry: JSZip.JSZipObject): Method {
  const magic = (entry as unknown as { _data?: { compression?: { magic?: string } } })._data
    ?.compression?.magic;
  return magic === STORE_MAGIC ? "STORE" : "DEFLATE";
}

export interface OoxmlPackage {
  has(path: string): boolean;
  /** Every part currently in the package, in the original zip's order. */
  paths(): string[];
  read(path: string): Promise<Buffer>;
  readText(path: string): Promise<string>;
  write(path: string, content: Buffer | string): void;
  remove(path: string): void;
  /** The parts this edit has replaced, added or removed. */
  touched(): string[];
  /** The edited package, every untouched entry copied through unchanged. */
  toBuffer(): Promise<Buffer>;
}

export async function openPackage(bytes: Buffer): Promise<OoxmlPackage> {
  const zip = await JSZip.loadAsync(bytes);

  const order: string[] = [];
  const methods = new Map<string, Method>();
  /** Directory entries, which are not parts but are entries the original had. */
  const folders: string[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      folders.push(path);
      continue;
    }
    order.push(path);
    methods.set(path, methodOf(entry));
  }

  /** Replacements and additions; a null value is a removal. */
  const staged = new Map<string, Buffer | string | null>();

  const paths = (): string[] => {
    const removed = new Set(
      [...staged].filter(([, content]) => content === null).map(([path]) => path),
    );
    const original = order.filter((path) => !removed.has(path));
    const added = [...staged.keys()].filter((path) => !removed.has(path) && !order.includes(path));
    return [...original, ...added];
  };

  const read = async (path: string): Promise<Buffer> => {
    const stagedValue = staged.get(path);
    if (stagedValue !== undefined && stagedValue !== null) {
      return Buffer.isBuffer(stagedValue) ? stagedValue : Buffer.from(stagedValue, "utf8");
    }
    const entry = zip.files[path];
    if (!entry || entry.dir) throw new Error(`This deck has no part '${path}'.`);
    return entry.async("nodebuffer");
  };

  return {
    has: (path) => (staged.has(path) ? staged.get(path) !== null : zip.files[path]?.dir === false),
    paths,
    read,
    readText: async (path) => (await read(path)).toString("utf8"),
    write: (path, content) => {
      staged.set(path, content);
    },
    remove: (path) => {
      staged.set(path, null);
    },
    touched: () => [...staged.keys()].sort(),
    toBuffer: async () => {
      const out = new JSZip();
      // Directory entries carry nothing an OOXML reader looks at, but the
      // original had them and "REX changed only what it named" is easier to
      // stand behind when the entry list matches.
      for (const folder of folders) out.folder(folder.replace(/\/$/, ""));
      for (const path of paths()) {
        out.file(path, await read(path), {
          // A part REX added has no original method, and DEFLATE is what Office
          // writes for a new one.
          compression: methods.get(path) ?? "DEFLATE",
          // `createFolders` would add directory entries the original did not
          // have — the "255 parts out of 139" failure §2.4 rejected.
          createFolders: false,
          binary: true,
        });
      }
      return out.generateAsync({ type: "nodebuffer" });
    },
  };
}
