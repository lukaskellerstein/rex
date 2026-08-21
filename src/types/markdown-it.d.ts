// Types for the markdown-it plugins that ship none.
//
// Spec 03 §3.1 — do NOT install `@types/markdown-it-footnote`. It depends on
// `@types/markdown-it`, which describes markdown-it 14, while this repo runs
// markdown-it 15 with its own bundled types. Both present puts two structurally
// different `MarkdownIt` types in the project and every `md.use(...)` stops
// compiling with a message that reads like a bug in our code.
//
// markdown-it 15 has no `PluginSimple` export — that name is `@types/markdown-it`
// only. Version 15 types `use` as
// `use<Params>(plugin: (md: this, ...params: Params) => void, ...params: Params)`,
// so a plugin is a plain function.

declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";

  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
