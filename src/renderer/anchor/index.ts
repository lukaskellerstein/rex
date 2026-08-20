// The anchor resolver's public surface. Bundled to an IIFE for two callers
// that cannot import ES modules: the milestone 0 spike, which injects it into
// a Playwright page, and the tier 2 <webview>, which is a separate process
// reachable only through executeJavaScript (SPEC.md §5.2).

export * from "./create.ts";
export * from "./highlight.ts";
export * from "./resolve.ts";
export * from "./textIndex.ts";
