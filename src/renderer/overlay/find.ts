// Spec 28 — the find bar's state, the Search's state, and which of the two the
// page is painted with.
//
// One rule decides the paint (§5.5): the bar's query while the bar is open; the
// Search's query otherwise; nothing when neither has one. The page itself is
// owned by a `DocumentSurface`, so everything here is a decision about WHAT to
// paint and WHEN, and the surface does the painting.
//
// A hook rather than more state in `App.tsx`, which is where the two chords
// and the sweep call into it. The dependencies arrive through a ref because
// `sweep` — which has to re-run the find after every rebuild of the index — is
// declared long before `openDocument`, which the jump needs; a ref that App
// fills in every render breaks the cycle without an effect.

import { useCallback, useEffect, useRef, useState } from "react";
import { normaliseQuery, sameContext } from "../../shared/find.ts";
import type {
  DocumentVersion,
  FindMark,
  SearchHit,
  WorkspaceSearchResult,
} from "../../shared/types.ts";
import type { DocumentSurface } from "./anchoring.ts";

export interface FindDeps {
  surface: (pane: DocumentVersion) => DocumentSurface | null;
  /** §4.1 — the pane being read, which is where the paint goes. */
  pane: DocumentVersion;
  /** The absolute path of the document on screen, or null. */
  documentPath: () => string | null;
  openDocument: (path: string) => Promise<void>;
}

export interface FindBarState {
  open: boolean;
  query: string;
  /** Matches on the page for the PAGE's query — the bar's, or the Search's. */
  count: number;
  capped: boolean;
}

export interface SearchState {
  /** What is in the field — not yet normalised, not necessarily run. */
  query: string;
  result: WorkspaceSearchResult | null;
  busy: boolean;
  /** §4.2 — files whose hit rows are folded away. */
  folded: ReadonlySet<string>;
}

export type ExplorerTab = "files" | "search";

/** §4.1 — a selection this long, on one line, seeds the field. */
const SEED_MAX = 100;

interface Landing {
  path: string;
  hit: SearchHit | null;
  query: string;
}

/**
 * §5.5 — which match on the page a hit from main is.
 *
 * The match at the hit's ordinal when its words agree; else the first whose
 * words agree; else the ordinal if there is one; else the first. Never
 * nowhere, and never a wrong place reported as right — the bar says which of
 * `n` the reviewer landed on.
 */
function chooseOrdinal(surface: DocumentSurface, count: number, hit: SearchHit | null): number {
  if (!hit || count === 0) return 0;
  const agrees = (at: number): boolean => {
    const context = surface.findContext(at);
    return context !== null && sameContext(context, hit);
  };
  if (hit.ordinal < count && agrees(hit.ordinal)) return hit.ordinal;
  for (let at = 0; at < count; at++) if (agrees(at)) return at;
  return hit.ordinal < count ? hit.ordinal : 0;
}

export function useFind(deps: React.RefObject<FindDeps>, pane: DocumentVersion) {
  const [bar, setBar] = useState<FindBarState>({
    open: false,
    query: "",
    count: 0,
    capped: false,
  });
  const [current, setCurrent] = useState(-1);
  const [marks, setMarks] = useState<FindMark[]>([]);
  const [barFocus, setBarFocus] = useState(0);
  const [search, setSearch] = useState<SearchState>({
    query: "",
    result: null,
    busy: false,
    folded: new Set(),
  });
  const [searchFocus, setSearchFocus] = useState(0);
  const [tab, setTab] = useState<ExplorerTab>("files");

  /** §5.5 — the one rule. */
  const pageQuery = bar.open ? normaliseQuery(bar.query) : (search.result?.query ?? "");

  // Mirrors, for the callbacks that have to stay stable across renders.
  const pageQueryRef = useRef(pageQuery);
  pageQueryRef.current = pageQuery;
  const currentRef = useRef(current);
  currentRef.current = current;
  const countRef = useRef(bar.count);
  countRef.current = bar.count;
  const searchRef = useRef(search);
  searchRef.current = search;
  /** The surface holding the paint, and the query it was painted with. */
  const painted = useRef<{ surface: DocumentSurface; query: string } | null>(null);
  /** §5.5 — a hit waiting for its document's surface. */
  const landing = useRef<Landing | null>(null);
  /** Whether the next paint may scroll the page — set by typing, not by a sweep. */
  const reveal = useRef(false);

  const record = useCallback((count: number, capped: boolean, at: number, next: FindMark[]) => {
    setMarks(next);
    setCurrent(at);
    setBar((b) => (b.count === count && b.capped === capped ? b : { ...b, count, capped }));
  }, []);

  /**
   * Paints the page's query on the pane being read.
   *
   * `keep` is the sweep's mode: the index was rebuilt, so the ranges must be,
   * but the reviewer did nothing and the current match stays where it was.
   * `reveal` is typing: the current match becomes the first from the top of
   * the viewport and the page scrolls to it if it is off screen. `quiet` is
   * everything else — the bar closing, a Search result arriving — which
   * changes the paint and never the scroll.
   */
  const paint = useCallback(
    (mode: "reveal" | "keep" | "quiet"): void => {
      const surface = deps.current.surface(deps.current.pane);
      const query = pageQueryRef.current;

      const before = painted.current;
      if (before && before.surface !== surface) {
        // A pane that stopped being the one read keeps no paint.
        before.surface.findClear();
        painted.current = null;
      }
      if (!surface) {
        record(0, false, -1, []);
        return;
      }
      if (query.length === 0) {
        surface.findClear();
        painted.current = null;
        record(0, false, -1, []);
        return;
      }
      // Already painted with this query on this surface, and nothing moved:
      // the current match stands. Only a sweep ("keep") knows the ranges are
      // stale, and it says so.
      if (
        mode !== "keep" &&
        painted.current?.surface === surface &&
        painted.current.query === query
      ) {
        return;
      }

      const fresh = painted.current?.surface !== surface;
      const outcome = surface.find(query);
      painted.current = { surface, query };
      let at = outcome.nearest;
      if (
        mode === "keep" &&
        !fresh &&
        currentRef.current >= 0 &&
        currentRef.current < outcome.count
      ) {
        at = currentRef.current;
      }
      if (outcome.count === 0) at = -1;
      if (at >= 0) surface.findShow(at, mode === "reveal");
      record(outcome.count, outcome.capped, at, outcome.marks);
    },
    [deps, record],
  );

  // The paint follows the rule: whenever the page's query or the pane changes.
  useEffect(() => {
    const mode = reveal.current ? "reveal" : "quiet";
    reveal.current = false;
    paint(mode);
  }, [paint, pageQuery, pane]);

  // ── The bar (§4.1) ────────────────────────────────────────────

  const openBar = useCallback((): void => {
    const surface = deps.current.surface(deps.current.pane);
    const selected = surface?.selectedText().trim() ?? "";
    const seed =
      selected.length > 0 && selected.length <= SEED_MAX && !selected.includes("\n")
        ? selected
        : null;
    reveal.current = true;
    setBar((b) => ({
      ...b,
      open: true,
      // The selection first; then the Search's query, so a Search-painted
      // page does not change under the reviewer's eyes; then the last query.
      query: seed ?? (b.open ? b.query : pageQueryRef.current || b.query),
    }));
    setBarFocus((token) => token + 1);
  }, [deps]);

  const closeBar = useCallback((): void => {
    setBar((b) => ({ ...b, open: false }));
  }, []);

  const setQuery = useCallback((query: string): void => {
    reveal.current = true;
    setBar((b) => ({ ...b, query }));
  }, []);

  const goTo = useCallback(
    (at: number): void => {
      const surface = deps.current.surface(deps.current.pane);
      if (!surface || at < 0 || at >= countRef.current) return;
      surface.findShow(at, true);
      setCurrent(at);
    },
    [deps],
  );

  const step = useCallback(
    (delta: 1 | -1): void => {
      const count = countRef.current;
      if (count === 0) return;
      const from = currentRef.current < 0 ? (delta > 0 ? -1 : 0) : currentRef.current;
      goTo((from + delta + count) % count);
    },
    [goTo],
  );
  const next = useCallback((): void => step(1), [step]);
  const previous = useCallback((): void => step(-1), [step]);

  /** §5.2 — the sweep rebuilt the index; the ranges and the marks follow. */
  const refind = useCallback((): void => paint("keep"), [paint]);

  // ── The Search (§4.2) ─────────────────────────────────────────

  const openSearch = useCallback((): void => {
    setTab("search");
    setSearchFocus((token) => token + 1);
  }, []);

  const clearSearch = useCallback((): void => {
    setSearch((s) => ({ ...s, query: "", result: null, folded: new Set() }));
  }, []);

  /** The field. Emptying it empties the results too — the native `×` and `esc`. */
  const setSearchQuery = useCallback((query: string): void => {
    setSearch((s) =>
      query.length === 0 ? { ...s, query, result: null, folded: new Set() } : { ...s, query },
    );
  }, []);

  const runSearch = useCallback(async (root: string): Promise<void> => {
    const query = normaliseQuery(searchRef.current.query);
    if (query.length === 0) {
      setSearch((s) => ({ ...s, result: null, folded: new Set() }));
      return;
    }
    setSearch((s) => ({ ...s, busy: true }));
    const result = await window.rex.workspaceSearch({ root, query });
    // A stale answer — the reviewer pressed ↵ again before this came back —
    // is dropped, so the list never shows a query the field no longer holds.
    setSearch((s) =>
      normaliseQuery(s.query) === result.query
        ? { ...s, busy: false, result, folded: new Set() }
        : { ...s, busy: false },
    );
  }, []);

  const toggleFold = useCallback((path: string): void => {
    setSearch((s) => {
      const folded = new Set(s.folded);
      if (folded.has(path)) folded.delete(path);
      else folded.add(path);
      return { ...s, folded };
    });
  }, []);

  // ── The jump (§5.5) ───────────────────────────────────────────

  const land = useCallback((): void => {
    const waiting = landing.current;
    if (!waiting || deps.current.documentPath() !== waiting.path) return;
    const surface = deps.current.surface(deps.current.pane);
    if (!surface) return;
    landing.current = null;

    const before = painted.current;
    if (before && before.surface !== surface) before.surface.findClear();
    const outcome = surface.find(waiting.query);
    painted.current = { surface, query: waiting.query };
    const at = outcome.count === 0 ? -1 : chooseOrdinal(surface, outcome.count, waiting.hit);
    if (at >= 0) surface.findShow(at, true);
    record(outcome.count, outcome.capped, at, outcome.marks);
  }, [deps, record]);

  /**
   * §4.2 — a row in the results. Opens the file if it is not open, paints every
   * match, lands on this one. The bar closes: the page shows the Search's
   * query, and the results list is how the reviewer moves between hits.
   */
  const openHit = useCallback(
    async (path: string, hit: SearchHit | null): Promise<void> => {
      const query = searchRef.current.result?.query ?? "";
      if (query.length === 0) return;
      setBar((b) => (b.open ? { ...b, open: false } : b));
      landing.current = { path, hit, query };
      if (deps.current.documentPath() === path && deps.current.surface(deps.current.pane)) {
        land();
        return;
      }
      await deps.current.openDocument(path);
    },
    [deps, land],
  );

  /** App calls this once a pane's surface exists and its first sweep has run. */
  const surfaceReady = useCallback(
    (ready: DocumentVersion): void => {
      if (ready === deps.current.pane) land();
    },
    [deps, land],
  );

  return {
    bar,
    current,
    marks,
    barFocus,
    openBar,
    closeBar,
    setQuery,
    next,
    previous,
    goTo,
    refind,
    surfaceReady,
    search,
    searchFocus,
    tab,
    setTab,
    openSearch,
    setSearchQuery,
    runSearch,
    clearSearch,
    toggleFold,
    openHit,
  };
}
