// Bundles the stylesheet tree into a single dist/rex.css and copies the
// self-hosted latin subsets into dist/fonts/, rewriting their url()s.
//
// Seven files, 152 KB: the three families at the five weights and the one
// italic the design actually uses. See src/styles/fonts.css.
import { build } from "esbuild";

await build({
  entryPoints: ["src/styles/index.css"],
  bundle: true,
  outfile: "dist/rex.css",
  loader: { ".woff2": "file" },
  assetNames: "fonts/[name]",
  logLevel: "info",
});
