// One content hash for both processes.
//
// FNV-1a, 32 bits, hex. Not a security primitive and not trying to be: it
// answers "is this the same thing it was" and it has to answer synchronously
// inside the document's own window, where `crypto.subtle` is a promise. It sat
// in `renderer/anchor/create.ts` until spec 29 needed the same hash in main —
// `src/shared/` may not import from `renderer/` (spec 01 §3.1), so it moved
// rather than being written twice.

export function fnv1a(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
