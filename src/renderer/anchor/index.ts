// The anchor resolver's public surface. Bundled to an IIFE for the milestone 0
// spike, which cannot import ES modules: it injects this into a Playwright page.

export * from "./create.ts";
export * from "./highlight.ts";
export * from "./resolve.ts";
export * from "./textIndex.ts";
