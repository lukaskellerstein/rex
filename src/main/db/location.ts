// SPEC.md §9 — where the database lives.
//
// Its own module because `database.ts` imports schema.sql through Vite's `?raw`
// loader, which only exists inside an electron-vite build. `rex export` runs
// under plain Node and needs the path without that.

import { homedir } from "node:os";
import { join } from "node:path";

/** ~/.rex/rex.db — outside every repository, so it can never be committed. */
export const DB_PATH = process.env.REX_DB_PATH ?? join(homedir(), ".rex", "rex.db");
