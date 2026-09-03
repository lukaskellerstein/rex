// Spec 28 §4.2 — the Search view: the field, the summary line, the results.
//
// Mounted by `Explorer` under its `Search` tab, in place of the tree. The
// results are grouped by file in tree order, each file with a twisty, each hit
// with the words around it — VS Code's results tree, which is what was asked
// for. The list is a keyboard: `↑` `↓` move, `↵` opens, `←` `→` fold and
// unfold, with one roving tab stop so the column is one stop in the page.
//
// Nothing here holds the result. It arrives as a prop and the query with it,
// so switching to `Files` and back shows the same list, and so the jump
// (`find.ts`) can read the hit it is about.

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_HITS_TOTAL } from "../../shared/find.ts";
import type { SearchHit, WorkspaceSearchResult } from "../../shared/types.ts";
import { TriangleDown, TriangleRight } from "./Icons.tsx";

export interface SearchViewProps {
  root: string;
  query: string;
  busy: boolean;
  result: WorkspaceSearchResult | null;
  folded: ReadonlySet<string>;
  /** Bumped by `⌘⇧F`: the field takes focus and selects its text. */
  focusToken: number;
  onQuery: (query: string) => void;
  /** `↵` — reading every file is an act, so the search runs on this alone. */
  onRun: () => void;
  onClear: () => void;
  onFold: (path: string) => void;
  /** A file row opens on its first hit; a hit row on that hit. */
  onOpen: (path: string, hit: SearchHit | null) => void;
}

/** Characters of context drawn before the match on a hit row. */
const SHOWN_BEFORE = 28;

type Row =
  | { kind: "file"; path: string; total: number; folded: boolean }
  | { kind: "hit"; path: string; hit: SearchHit };

/** The rows as drawn, folded files contributing only their own row. */
function rowsOf(result: WorkspaceSearchResult | null, folded: ReadonlySet<string>): Row[] {
  if (!result) return [];
  const rows: Row[] = [];
  for (const file of result.files) {
    const isFolded = folded.has(file.path);
    rows.push({ kind: "file", path: file.path, total: file.total, folded: isFolded });
    if (isFolded) continue;
    for (const hit of file.hits) rows.push({ kind: "hit", path: file.path, hit });
  }
  return rows;
}

/** The file's name, and its folder relative to the root — `""` at the root. */
function splitPath(root: string, path: string): { name: string; folder: string } {
  const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const slash = relative.lastIndexOf("/");
  return slash === -1
    ? { name: relative, folder: "" }
    : { name: relative.slice(slash + 1), folder: relative.slice(0, slash) };
}

/** §4.2 — the whole answer in one line, the way VS Code's reads. */
function summaryOf(props: SearchViewProps): string | null {
  if (props.busy) return "searching…";
  const result = props.result;
  if (!result) return null;
  if (result.matches === 0) return "no matches";
  const files = result.files.length;
  const line =
    `${result.matches} ${result.matches === 1 ? "match" : "matches"} in ` +
    `${files} ${files === 1 ? "file" : "files"}`;
  return result.capped ? `${line} — showing the first ${MAX_HITS_TOTAL}` : line;
}

export function SearchView(props: SearchViewProps): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const rowElements = useRef(new Map<number, HTMLDivElement>());
  const [focusAt, setFocusAt] = useState(0);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [props.focusToken]);

  const rows = useMemo(() => rowsOf(props.result, props.folded), [props.result, props.folded]);

  // A new list starts at its top. Without this a focus index from a longer
  // list points past the end of a shorter one.
  const listIdentity = props.result;
  useEffect(() => setFocusAt(0), [listIdentity]);

  const moveFocus = (to: number): void => {
    if (to < 0 || to >= rows.length) return;
    setFocusAt(to);
    rowElements.current.get(to)?.focus();
  };

  const open = (row: Row): void => {
    if (row.kind === "file") props.onOpen(row.path, null);
    else props.onOpen(row.path, row.hit);
  };

  const onRowKey = (event: React.KeyboardEvent, at: number, row: Row): void => {
    switch (event.key) {
      case "ArrowDown":
        moveFocus(at + 1);
        break;
      case "ArrowUp":
        moveFocus(at - 1);
        break;
      case "Enter":
        open(row);
        break;
      case "ArrowLeft":
        // On a hit, up to its file; on an open file, fold it.
        if (row.kind === "hit") {
          const parent = rows.findIndex((r) => r.kind === "file" && r.path === row.path);
          moveFocus(parent);
        } else if (!row.folded) {
          props.onFold(row.path);
        }
        break;
      case "ArrowRight":
        if (row.kind === "file") {
          if (row.folded) props.onFold(row.path);
          else moveFocus(at + 1);
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const summary = summaryOf(props);

  return (
    <div className="rex-search">
      <div className="rex-search-field-row">
        <input
          ref={field}
          className="rex-search-field"
          type="search"
          value={props.query}
          placeholder="Search the workspace — ↵ runs it"
          aria-label="Search the workspace"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => props.onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.onRun();
            } else if (event.key === "Escape" && props.query.length > 0) {
              event.preventDefault();
              props.onClear();
            }
          }}
        />
      </div>

      {summary ? (
        <p className="rex-search-summary" aria-live="polite">
          {summary}
        </p>
      ) : null}

      {props.result?.truncated ? (
        // Spec 02 §4.2's own warning, carried into the results: a silently
        // incomplete search reads exactly like a complete one.
        <p className="rex-explorer-warn">
          Tree truncated — this folder is larger than REX will scan. Some files were not searched.
        </p>
      ) : null}

      <div className="rex-search-list" role="tree" aria-label="Search results">
        {rows.map((row, at) => {
          const focusable = at === focusAt ? 0 : -1;
          const keep = (element: HTMLDivElement | null): void => {
            if (element) rowElements.current.set(at, element);
            else rowElements.current.delete(at);
          };
          if (row.kind === "file") {
            const { name, folder } = splitPath(props.root, row.path);
            return (
              <div
                key={row.path}
                ref={keep}
                role="treeitem"
                aria-expanded={!row.folded}
                aria-selected={false}
                tabIndex={focusable}
                className="rex-search-file"
                title={row.path}
                onClick={() => open(row)}
                onKeyDown={(event) => onRowKey(event, at, row)}
              >
                <button
                  type="button"
                  className="rex-search-twisty"
                  tabIndex={-1}
                  aria-label={row.folded ? "Unfold" : "Fold"}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onFold(row.path);
                  }}
                >
                  {row.folded ? <TriangleRight /> : <TriangleDown />}
                </button>
                <span className="rex-search-name">{name}</span>
                {folder ? <span className="rex-search-folder">{folder}</span> : null}
                <span className="rex-chip-count">{row.total}</span>
              </div>
            );
          }
          const file = props.result?.files.find((one) => one.path === row.path);
          const last = file !== undefined && row.hit.ordinal === file.hits.length - 1;
          const more = file ? file.total - file.hits.length : 0;
          // One line per hit, and the match has to be ON it: a row that starts
          // with 48 characters of context ends before the match is drawn. The
          // words before are trimmed to what a 272px column shows; the ones
          // after are cut by the ellipsis, where cutting costs nothing.
          const before =
            row.hit.before.length > SHOWN_BEFORE
              ? row.hit.before.slice(-SHOWN_BEFORE)
              : row.hit.before;
          const cutBefore = row.hit.cutBefore || before.length < row.hit.before.length;
          return (
            <div key={`${row.path}#${row.hit.ordinal}`} className="rex-search-hit-row">
              <div
                ref={keep}
                role="treeitem"
                aria-selected={false}
                tabIndex={focusable}
                className="rex-search-hit"
                onClick={() => open(row)}
                onKeyDown={(event) => onRowKey(event, at, row)}
              >
                {cutBefore ? "…" : ""}
                {before}
                <mark className="rex-search-match">{row.hit.match}</mark>
                {row.hit.after}
                {row.hit.cutAfter ? "…" : ""}
              </div>
              {last && more > 0 ? (
                // §4.2 — the cap, said out loud, and where the rest are.
                <p className="rex-search-more">and {more} more — ⌘F in the file</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {props.result && props.result.skipped.length > 0 ? (
        <div className="rex-search-skipped">
          <span className="rex-label">NOT SEARCHED</span>
          {props.result.skipped.map((entry) => (
            <p key={entry.path} title={entry.path}>
              {splitPath(props.root, entry.path).name} — {entry.reason}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
