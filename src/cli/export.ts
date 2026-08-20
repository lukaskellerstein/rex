// SPEC.md §9.1 — `rex export <document>`.
//
// This is how comments reach a pull request or another person. Git-friendliness
// is a feature on demand, not the storage format (§12): SQLite stays the store.
//
//   npm run export -- <document> [--json] [--out <file>]

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { DB_PATH } from "../main/db/location.ts";
import { listThreads } from "../main/db/queries.ts";
import type { ThreadWithMessages } from "../shared/types.ts";

interface Options {
  document: string;
  json: boolean;
  out: string | null;
}

function parseArguments(argv: string[]): Options {
  const positional: string[] = [];
  let json = false;
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--out") out = argv[++i] ?? null;
    else positional.push(argv[i]);
  }

  if (positional.length === 0) {
    throw new Error("Usage: rex export <document> [--json] [--out <file>]");
  }
  return { document: resolve(positional[0]), json, out };
}

/**
 * An agent's answer is Markdown and routinely uses `##` headings of its own,
 * which would otherwise sit at the same level as the thread headings and make
 * the export unreadable as an outline. Demoting them keeps one thread = one
 * top-level section.
 */
function demoteHeadings(markdown: string): string {
  return markdown.replace(/^(#{1,4}) /gm, (_match, hashes: string) => `${hashes}## `);
}

const STATE_LABEL: Record<string, string> = {
  ok: "anchored",
  moved: "anchor moved — the text changed since this was written",
  orphaned: "orphaned — the text this was written against is gone",
};

function toMarkdown(title: string, documentPath: string, threads: ThreadWithMessages[]): string {
  const lines = [`# Review comments — ${title}`, "", `Document: \`${documentPath}\``, ""];
  const anchored = threads.filter((thread) => thread.kind === "anchored");
  const synthesis = threads.filter((thread) => thread.kind === "synthesis");

  lines.push(
    `${threads.length} thread(s): ${anchored.length} anchored, ${synthesis.length} synthesis.`,
    "",
  );

  threads.forEach((thread, position) => {
    lines.push(`## ${position + 1}. ${thread.note}`, "");

    const facts = [`status: ${thread.status}`];
    if (thread.anchorState) facts.push(STATE_LABEL[thread.anchorState] ?? thread.anchorState);
    if (thread.anchor?.source) facts.push(`source line ${thread.anchor.source.line}`);
    if (thread.kind === "synthesis")
      facts.push(`references ${thread.refThreadIds.length} comments`);
    lines.push(`*${facts.join(" · ")}*`, "");

    if (thread.anchor?.quote) {
      lines.push(`> ${thread.anchor.quote.exact.replace(/\n/g, "\n> ")}`, "");
    }

    const answers = thread.messages.filter((m) => m.role === "assistant" && m.kind === "text");
    for (const answer of answers) lines.push(demoteHeadings(answer.content ?? ""), "");
    if (answers.length === 0) lines.push("*No answer yet.*", "");
  });

  return lines.join("\n");
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

  try {
    const document = db
      .prepare<[string], { id: string; title: string | null }>(
        "SELECT id, title FROM document WHERE kind = 'file' AND value = ?",
      )
      .get(options.document);

    if (!document) {
      throw new Error(`REX has no comments for ${options.document}`);
    }

    const threads = listThreads(db, document.id);
    const output = options.json
      ? JSON.stringify({ document: options.document, threads }, null, 2)
      : toMarkdown(document.title ?? options.document, options.document, threads);

    if (options.out) {
      writeFileSync(options.out, output);
      console.log(`Wrote ${threads.length} thread(s) to ${options.out}`);
    } else {
      console.log(output);
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
