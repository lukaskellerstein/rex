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
import { listThreadsInDocument } from "../main/db/queries.ts";
import { withDetail } from "../main/threads.ts";
import { commentName } from "../shared/names.ts";
import { worstState } from "../shared/targets.ts";
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

/**
 * Spec 14 §5 — a comment's group, as a path: `Blocking / Auth flow`.
 *
 * Read straight from the table rather than through the tree: the export is
 * about one document, and building a workspace's whole tree to name one group
 * is work for an answer that is two lookups.
 */
function groupPath(db: Database.Database, groupId: string | null): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = groupId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = db
      .prepare<[string], { name: string; parent_id: string | null }>(
        "SELECT name, parent_id FROM comment_group WHERE id = ?",
      )
      .get(current);
    if (!row) break;
    parts.unshift(row.name);
    current = row.parent_id;
  }
  return parts.length > 0 ? parts.join(" / ") : null;
}

function toMarkdown(
  title: string,
  documentPath: string,
  threads: ThreadWithMessages[],
  groupNames: Map<string, string>,
): string {
  const lines = [`# Review comments — ${title}`, "", `Document: \`${documentPath}\``, ""];
  const anchored = threads.filter((thread) => thread.kind === "anchored");
  const synthesis = threads.filter((thread) => thread.kind === "synthesis");

  lines.push(
    `${threads.length} thread(s): ${anchored.length} anchored, ${synthesis.length} synthesis.`,
    "",
  );

  threads.forEach((thread, position) => {
    // Spec 14 §3.4 — the heading is the NAME. With no title that is the note's
    // first line, which is what this printed before.
    lines.push(`## ${position + 1}. ${commentName(thread)}`, "");

    const primary = thread.targets[0]?.anchor ?? null;
    const state = worstState(thread.targets.map((target) => target.state));

    const facts = [`status: ${thread.status}`];
    const group = thread.groupId ? groupNames.get(thread.groupId) : null;
    if (group) facts.push(`group: ${group}`);
    if (state) facts.push(STATE_LABEL[state] ?? state);
    if (primary?.source) facts.push(`source line ${primary.source.line}`);
    // A comment about several documents says so here rather than pretending the
    // export it appears in is the whole of it.
    if (thread.documentNames.length > 1)
      facts.push(`also about ${thread.documentNames.join(", ")}`);
    if (thread.targets.length > 1) facts.push(`${thread.targets.length} places`);
    if (thread.kind === "synthesis")
      facts.push(`references ${thread.refThreadIds.length} comments`);
    lines.push(`*${facts.join(" · ")}*`, "");

    if (primary?.quote) {
      lines.push(`> ${primary.quote.exact.replace(/\n/g, "\n> ")}`, "");
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

    // Every comment with a target in this document, which since spec 05 §5.3
    // includes comments that were written while another document was open.
    const threads = listThreadsInDocument(db, document.id).map((thread) => withDetail(db, thread));
    const groupNames = new Map<string, string>();
    for (const thread of threads) {
      if (!thread.groupId || groupNames.has(thread.groupId)) continue;
      const path = groupPath(db, thread.groupId);
      if (path) groupNames.set(thread.groupId, path);
    }
    const output = options.json
      ? JSON.stringify({ document: options.document, threads }, null, 2)
      : toMarkdown(document.title ?? options.document, options.document, threads, groupNames);

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
