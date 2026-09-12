// The shell: opens a document, keeps threads and their resolutions in step,
// owns the surface the anchor resolver runs against, and holds the selection
// panel's items (spec 05 §3.5).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSdk, DescribeResult } from "../../shared/agent-protocol.ts";
import type {
  ApplyReadyEvent,
  BuiltinState,
  GatewayListResponse,
  GatewayProviderView,
  GatewayStorageHealth,
  GatewayTrafficSize,
  ProviderDescriptor,
  TraceChat,
  TraceMessageResult,
  TraceTurnsResult,
} from "../../shared/channels.ts";
import { isMarkdownPath } from "../../shared/formats.ts";
import { buildRoutes, validateGateway } from "../../shared/gateways.ts";
import { commentName } from "../../shared/names.ts";
import { movedPath } from "../../shared/paths.ts";
import {
  NO_PLACES,
  outOfReviewScope,
  type PlaceTally,
  tallyPlaces,
  threadState,
} from "../../shared/targets.ts";
import type {
  AgentChoices,
  Anchor,
  AnchorState,
  AnchorSummary,
  CommentGroup,
  CommentMove,
  DiagramPart,
  DocumentPlace,
  DocumentRef,
  DocumentVersion,
  LineRange,
  LinkResolution,
  Message,
  OpenedDocument,
  PaneMode,
  PaperView,
  ReferenceGraph,
  SendChoices,
  ThreadWithMessages,
  ViewState,
  WorkingCopyView,
  WorkspaceRef,
  WorkspaceTree,
} from "../../shared/types.ts";
import {
  DEFAULT_MODEL,
  DEFAULT_STYLE,
  PAPER_VIEW_DEFAULT,
  UNSENT_STATUS,
} from "../../shared/types.ts";
import { createDocumentAnchor } from "../anchor/create.ts";
import type { Stroke } from "../anchor/lasso.ts";
import type { PickScope, ScopeRect } from "../anchor/pick.ts";
import { ApplyResult } from "./ApplyResult.tsx";
import {
  type DocumentSurface,
  type GapSpot,
  type MeasuredPlace,
  mergeResolved,
  NO_KEPT_SCOPE,
  type ResolvedThread,
  type Selected,
} from "./anchoring.ts";
import { CommentCard } from "./CommentCard.tsx";
import type { GatewayChoice } from "./Composer.tsx";
import { DiffDialog } from "./DiffDialog.tsx";
import { DocumentView } from "./DocumentView.tsx";
import { diagramCommentsFor, diagramPlacesFor } from "./diagramPlaces.ts";
import { type ChangeCounts, Explorer } from "./Explorer.tsx";
import { FindBar } from "./FindBar.tsx";
import { FindRuler } from "./FindRuler.tsx";
import { type FindDeps, useFind } from "./find.ts";
import { GraphView } from "./GraphView.tsx";
import {
  agentRows,
  gatewayForAgent,
  gatewayRows,
  lastGatewayId,
  lastUsed,
  ORIGINAL_GATEWAY_ID,
  replayNotice,
  unusableReason,
} from "./gatewayChoices.ts";
import {
  canGoBack,
  canGoForward,
  EMPTY_HISTORY,
  goBack,
  goForward,
  type History,
  pushPlace,
} from "./history.ts";
import { ChevronLeft } from "./Icons.tsx";
import { Lightbox } from "./Lightbox.tsx";
import type { LinkTipView } from "./LinkTip.tsx";
import { type Lane, laneOf } from "./lanes.ts";
import { ManageGateways } from "./ManageGateways.tsx";
import { drawDiagramPng, posterFramePng } from "./mermaid.ts";
import type { Mode } from "./mode.ts";
import type { PlaceFacts } from "./placeLine.ts";
import type { PreviewFigure } from "./preview.ts";
import { SelectionPanel } from "./SelectionPanel.tsx";
import { Settings, useSettings } from "./Settings.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Splitter } from "./Splitter.tsx";
import {
  addSelectionItem,
  moveSelectionItem,
  newSelectionItem,
  type PathFocus,
  type SelectionItem,
  threadOf,
} from "./selection.ts";
import { TopBar } from "./TopBar.tsx";
import { TraceSheet } from "./TraceSheet.tsx";
import { TrafficChat } from "./TrafficChat.tsx";
import { TrafficMessage } from "./TrafficMessage.tsx";
import { TrafficPage } from "./TrafficPage.tsx";
import { TrafficTurn } from "./TrafficTurn.tsx";
import { type Turn, turnsOf } from "./trace.ts";
import { tokenClass } from "./wash.ts";

/**
 * Spec 43 §4.3 — what a picker draws before its gateway has answered.
 *
 * Not an empty object: `AgentChoices` promises `models` and `styles` are always
 * arrays, and `styleRows(undefined)` throwing inside a render is what emptied
 * the whole window on 2026-09-02. The default's own name is the truth here —
 * nothing else is known yet.
 */
const EMPTY_CHOICES: AgentChoices = {
  models: [],
  chosen: DEFAULT_MODEL,
  styles: [DEFAULT_STYLE],
  error: null,
};

/** What the middle of the window is showing. */
type Centre = "document" | "graph";

/**
 * Spec 51 §5 — where in TRAFFIC the reviewer is.
 *
 * A path with one position, and not four independent flags. The first build
 * used four, and the depth-3 step fell out of the feature entirely: `Open turn`
 * opened the comment's trace sheet, which is a different screen answering a
 * different question. One position makes that impossible to express.
 *
 * Depth 3 keeps `fromChats` so it can hand it back on the way out — walking
 * back from a turn must reach the chat you came through, and then the list you
 * came through, or nothing at all if you started at the comment card.
 */
/**
 * One turn out of a chat, by its run id.
 *
 * `turnsOf` is the one place turns are built (spec 51 §9.4), so depth 3 asks it
 * rather than keeping a copy — two ways of deciding where a turn ends is how
 * two screens start disagreeing about one.
 */
function turnOf(thread: ThreadWithMessages, runId: string | null): Turn | null {
  return turnsOf(thread).find((turn) => turn.runId === runId) ?? null;
}

/**
 * What depth 4's head says it came out of.
 *
 * The TURN, not the exchange. Depth 3 draws the turn as one conversation now
 * (its exchanges are nested prefixes of each other), so naming an exchange here
 * would point at a thing the screen behind it no longer shows.
 */
function whereOf(thread: ThreadWithMessages, runId: string | null): string {
  const turn = turnOf(thread, runId);
  return turn && turn.runId !== null ? `Turn ${turn.number}` : "This turn";
}

type TrafficWhere =
  | { depth: 1 }
  | { depth: 2; threadId: string; fromChats: boolean }
  | { depth: 3; threadId: string; fromChats: boolean; runId: string | null; rowId: string | null }
  | {
      depth: 4;
      threadId: string;
      fromChats: boolean;
      runId: string | null;
      rowId: string | null;
      /** Which message of the picked exchange depth 4 opened on. */
      at: number;
    };

/**
 * Spec 30 §3 — the sidebar has one home and two screens that lead back to it.
 *
 * It was `SidebarTab = "selection" | "comments"`, chosen from a tab bar. Spec 30
 * §8.1 reverses spec 08 §3.1: a tab bar says "two destinations, pick one", and
 * only one of the two was a destination. The other is a form you fill in and
 * leave — which is exactly what `CommentCard` has always been for a comment
 * that already exists.
 *
 * The card is deliberately not a third value. It is a comment being open
 * (`activeId`) while the screen is `list`, which is the pair `cardOnScreen` has
 * always tested and the reason this rename is behaviour-preserving.
 */
type SideScreen = "list" | "composer";

/** SPEC.md §8.8 point 4 — confirm before a fan-out larger than this. */
const FAN_OUT_CONFIRM = 10;
/** A rough per-comment figure, only ever shown as an estimate. */
const ESTIMATED_USD_PER_ASK = 0.05;
/**
 * Spec 06 §4.3 — how many files one folder may add before REX asks first.
 *
 * Deliberately not `FAN_OUT_CONFIRM`. That one guards money spent on agent
 * runs; this guards time and a panel that suddenly holds forty rows. Every file
 * is opened and rendered to get its id, which is milliseconds for Markdown and
 * seconds for a deck, so the wait is the count times the slowest file.
 *
 * The same number decides whether the loop says it is working: a progress line
 * for four files is a flicker, and one for forty is the only thing on screen
 * that says REX has not hung.
 */
const FOLDER_SELECT_CONFIRM = 20;
/** How long ⌥ must be held before it means "pick", not "I am typing ⌥-something". */
const ALT_PICK_DELAY = 250;

/**
 * How far the document can be zoomed, and by how much per notch.
 *
 * The zoom is the *document's*, not REX's: it scales what is under review and
 * leaves the bar, the explorer and the cards alone. That is why it is CSS
 * `zoom` inside the frame rather than Electron's `setZoomFactor`, which would
 * scale the whole window and make the comment cards grow with the prose.
 */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.1;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Two boxes, or two absences, that are the same box. */
function same(a: ScopeRect | null, b: ScopeRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** The same, for the line boxes an outline follows — asked once per sweep. */
function sameLines(a: ScopeRect[] | null, b: ScopeRect[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((box, at) => same(box, b[at] ?? null));
}

/** Spec 05 §3.5 — the file name. Never the whole path. */
function nameOf(ref: DocumentRef): string {
  return fileNameOf(ref.value);
}

/** The same, for the places that hold a path rather than a ref (spec 53 §4.5). */
function fileNameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Spec 53 §4.7 — how long the pointer rests on a link before the tip appears.
 *
 * Long enough to mean "resting here" rather than "passing over", short enough
 * that the answer still feels like part of the hover. A line of prose with three
 * links in it must not flash three tips as the pointer crosses it.
 */
const LINK_TIP_DELAY = 300;

/** §4.7 — one resolution, as the three lines the tip draws. */
function describeLink(answer: LinkResolution): Omit<LinkTipView, "rect"> {
  switch (answer.kind) {
    case "self":
      return { target: "This document", fragment: answer.fragment, refusal: null };
    case "document":
      return { target: answer.display, fragment: answer.fragment, refusal: null };
    case "external":
      return { target: answer.url, fragment: null, refusal: null };
    case "refused":
      // The path REX would have opened, when the link named one. A scheme names
      // none, and then the reason is the whole answer.
      return {
        target: answer.display ?? "Not a place REX can open",
        fragment: answer.fragment,
        refusal: answer.reason,
      };
  }
}

/**
 * Spec 16 §4.1 — the lines this document's working copy added or altered, which
 * is the set the new-version pane will answer a gesture on.
 *
 * `null` — no working copy — means everything is live, which is Reading mode
 * and every document nobody has changed. A non-null EMPTY list is a different
 * thing and is left empty deliberately: this pane has a change to show and no
 * way to say which blocks it touched (a plain HTML file has no `data-src-line`
 * to go on), so nothing is live and every comment goes on the left.
 *
 * It is the same list spec 15 §6.2 already outlines in green, so the affordance
 * needs no new furniture: what is outlined is what responds.
 */
function liveRangesOf(doc: OpenedDocument | null): LineRange[] | null {
  if (!doc?.working) return null;
  const path = doc.ref.value;
  return doc.working.added
    .filter((region) => region.file === path)
    .map((region) => ({ from: region.from, to: region.to }));
}

interface ApplyOutcome {
  summary: AnchorSummary;
  files: string[];
  newlyOrphaned: ThreadWithMessages[];
}

const NO_SUMMARY: AnchorSummary = { ok: 0, moved: 0, orphaned: 0, total: 0 };

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [threads, setThreads] = useState<ThreadWithMessages[]>([]);
  /**
   * Spec 14 §5 — the reviewer's groups for this workspace, flat.
   *
   * The tree is built where it is drawn, from `shared/commentTree.ts`, which is
   * the same function main walks to decide the order `threads` arrives in. Two
   * implementations of one order is the bug §4.4 exists to prevent.
   */
  const [groups, setGroups] = useState<CommentGroup[]>([]);
  /**
   * Spec 16 §5.2 — the MERGED answer: per target the best of the two panes.
   *
   * Everything that asks "what state is this comment in?" reads this, and
   * nothing else may: taking the worst across the two panes would report every
   * comment on unchanged text as orphaned the moment a working copy existed.
   */
  const [resolved, setResolved] = useState<ResolvedThread[]>([]);
  /**
   * §5.2 — and each pane's own sweep, because each pane's lane draws from its
   * own. Where a bar appears is not computed; it is what that sweep found.
   */
  const [paneResolved, setPaneResolved] = useState<{
    original: ResolvedThread[];
    current: ResolvedThread[];
  }>({ original: [], current: [] });
  /** Spec 16 §6.6 — the gaps the `+ Add` affordance can appear in. */
  const [gaps, setGaps] = useState<GapSpot[]>([]);
  /**
   * §6.1 — the gap the pointer is over, if any.
   *
   * A ref rather than state: it is read by a key binding and never drawn, and
   * making it state would re-render the whole shell on every pointer move
   * across a band.
   */
  const offeredGap = useRef<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState<ApplyReadyEvent | null>(null);
  const [applyOutcome, setApplyOutcome] = useState<ApplyOutcome | null>(null);
  /**
   * Spec 15 §6.1 — the left-hand pane's document, rendered from the file.
   *
   * A second `OpenedDocument` and not a flag, because the two panes are two
   * renders of two different byte streams. It is null whenever there is nothing
   * to compare — no working copy, or the control is on `New`.
   */
  const [original, setOriginal] = useState<OpenedDocument | null>(null);
  /** §6.1 — which of the two versions is on screen. `Both` once one exists. */
  const [paneMode, setPaneMode] = useState<PaneMode>("both");
  /** §7.1 — every document with a change waiting, for `Approve all`. */
  const [working, setWorking] = useState<WorkingCopyView[]>([]);
  /**
   * Spec 18 §4.3 — the tree's green and red counts, keyed by absolute path.
   *
   * Derived from the working-copy list rather than carried on `TreeEntry`: a
   * block count moves when a run finishes, and the tree is rescanned far less
   * often than that. This way the row is right the moment the change lands.
   */
  const changeCounts = useMemo<ChangeCounts>(
    () =>
      new Map(
        working.map((view) => [
          view.path,
          { added: view.added.length, removed: view.removed.length },
        ]),
      ),
    [working],
  );
  const [busyThreads, setBusyThreads] = useState<string[]>([]);
  /**
   * Spec 17 §3.3 — the threads whose Stop has been pressed and not yet landed.
   *
   * A separate list from `busyThreads` rather than a third state on it, because
   * a stopping thread is still busy: the run has not ended, and everything that
   * is disabled during a run stays disabled. This only changes the word on the
   * spinner and stops the button being pressed twice.
   */
  const [stoppingThreads, setStoppingThreads] = useState<string[]>([]);
  /**
   * Spec 12 §3.3 — the mode each thread's next send will run in.
   *
   * Renderer state, keyed by thread id, defaulting to ASK. It is deliberately
   * NOT persisted, and the argument is one-way: the state that survives a
   * restart should be the safe one. A thread reopened tomorrow opens on ASK,
   * which can only cost a click; the opposite mistake costs a diff the reviewer
   * was not expecting.
   *
   * `threads.profile` is not the place for it either. That column records what
   * the CONVERSATION ran under, and a thread whose row said `write` would run
   * every later question through the write profile.
   */
  const [modeByThread, setModeByThread] = useState<Record<string, Mode>>({});
  /** §3.2 — the mode a comment that does not exist yet will be created in. */
  const [selectionMode, setSelectionMode] = useState<Mode>("ask");

  /** §3.3 — ASK unless this thread has been switched. */
  const modeOf = (threadId: string): Mode => modeByThread[threadId] ?? "ask";

  const setMode = (threadId: string, mode: Mode): void =>
    setModeByThread((current) => ({ ...current, [threadId]: mode }));

  /**
   * Spec 25 §3 — the models this account can use, asked once.
   *
   * Main caches the probe, so this costs one IPC round trip and no CLI process
   * of its own. Until it answers the picker has an empty list and shows the
   * default's own name, which is the truth: nothing else is known yet.
   */
  const [modelList, setModelList] = useState<AgentChoices>({
    models: [],
    chosen: DEFAULT_MODEL,
    styles: [DEFAULT_STYLE],
    error: null,
  });
  /**
   * §5 — the model each comment's next send will run on, or absent for "follow
   * the default".
   *
   * Renderer state keyed by thread id, exactly like `modeByThread` above and
   * for the same reason: this is what the NEXT send will do, and after a restart
   * the value to come back to is the reviewer's own default rather than a
   * one-off escalation they made last week. What survives is `message.model`,
   * which is a different fact — what a send that already happened DID.
   */
  const [modelByThread, setModelByThread] = useState<Record<string, string>>({});
  /** §7.1 — the model a comment that does not exist yet will be created with. */
  const [selectionModel, setSelectionModel] = useState<string | null>(null);
  /**
   * Spec 31 §2.2 — the style a comment that does not exist yet will be made
   * with, and the ONLY memory a style has outside a chat.
   *
   * It keeps its value for the session, so setting the panel to `Concise` gives
   * `Concise` to the next comment made and the one after. That is not an
   * application setting — nothing writes it to disk — and it is what the
   * reviewer meant by not wanting to pick again for every message.
   */
  const [selectionStyle, setSelectionStyle] = useState<string>(DEFAULT_STYLE);

  // ── Spec 43 — the gateway, to the left of the model ──────────
  //
  // Three controls, chosen per message, and each answer records all three. The
  // gateway is state of exactly the kind the model already is: keyed by thread,
  // in the renderer, because it is what the NEXT send will do. What survives a
  // restart is `message.gatewayName`, which is a different fact — what a send
  // that already happened DID.

  const [gateways, setGateways] = useState<GatewayListResponse | null>(null);
  const [gatewayByThread, setGatewayByThread] = useState<Record<string, string>>({});
  /**
   * Spec 44 §3 — the agent, one control to the left of the gateway.
   *
   * The same shape as the gateway and for the same reason: it is what the NEXT
   * send will do, so it lives in the renderer and is keyed by thread. What
   * survives a restart is `message.sdk`, which is the different fact of what a
   * send that already happened DID.
   */
  const [sdkByThread, setSdkByThread] = useState<Record<string, AgentSdk>>({});
  /** §3 — the agent a comment that does not exist yet will be created with. */
  const [selectionSdk, setSelectionSdk] = useState<AgentSdk | null>(null);
  /**
   * §4.0 — the gateway a comment that does not exist yet will be created with.
   *
   * Null until the reviewer picks one, and then it is theirs for the session —
   * the same memory `selectionStyle` keeps, for the same reason: a reviewer who
   * pointed the panel at LiteLLM meant the next comment too.
   */
  const [selectionGateway, setSelectionGateway] = useState<string | null>(null);
  const [gatewaysOpen, setGatewaysOpen] = useState(false);
  /**
   * Spec 46 §8 — the Settings sheet, beside `gatewaysOpen` and not replacing it.
   *
   * The composer's `Manage gateways…` opens THIS on tab 1, and the older sheet
   * stays for editing one external LiteLLM — that form is a generic form over
   * the descriptor and works unchanged, so this adds a surface rather than
   * rewriting one.
   */
  const settings = useSettings();
  const [builtin, setBuiltin] = useState<BuiltinState | null>(null);
  const [providerCatalogue, setProviderCatalogue] = useState<readonly ProviderDescriptor[]>([]);
  const [providers, setProviders] = useState<readonly GatewayProviderView[]>([]);
  const [storageHealth, setStorageHealth] = useState<GatewayStorageHealth | null>(null);
  const [trafficSize, setTrafficSize] = useState<GatewayTrafficSize | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  /**
   * Spec 51 §5 — TRAFFIC, at four depths.
   *
   * **One piece of state, because the depths are a PATH.** The first build made
   * them four independent things and folded depth 3 into the trace sheet, which
   * is the hybrid the reviewer rejected on 2026-09-09: `Open turn` left the
   * feature and landed on a different screen that happened to be nearby. A path
   * has one position, and `back` walks it.
   *
   * The chat's own trace sheet is NOT part of this. It is REX's record of what
   * the agent did on one comment; this is what went over the wire. Two
   * questions, two screens, and the only thing they share is `trace.ts`.
   */
  const [traffic, setTraffic] = useState<TrafficWhere | null>(null);
  /** Depth 1's rows, read when it opens. Null while reading. */
  const [trafficChats, setTrafficChats] = useState<TraceChat[] | null>(null);
  /** Depth 2 and 3's chat and its exchanges. Null while reading. */
  const [trafficChat, setTrafficChat] = useState<TraceTurnsResult | null>(null);
  /** Depth 3 and 4's body, for the picked exchange. Null while reading. */
  const [trafficBodies, setTrafficBodies] = useState<TraceMessageResult | null>(null);
  /** §4.5 — the descriptor, fetched once. The sheet renders itself from it. */
  const [descriptor, setDescriptor] = useState<DescribeResult | null>(null);
  /**
   * §4.3 — one model list per ROUTE, because the list follows both controls.
   *
   * A cache and not a single object: switching back must not pay for the probe
   * again, and §4.1's cascade has to be able to rebuild the menu the instant a
   * control moves rather than after a round trip.
   *
   * Spec 44 §3 — keyed `sdk:gateway`, matching the key main's own probe cache
   * uses. One gateway serves two agents with two different model lists, and a
   * key that named only the gateway would show Claude's list under Codex.
   */
  const [choicesByGateway, setChoicesByGateway] = useState<Record<string, AgentChoices>>({});

  const defaultGateway = gateways?.defaults.gatewayId ?? ORIGINAL_GATEWAY_ID;
  const defaultSdk: AgentSdk = gateways?.defaults.sdk ?? "claude-agent";

  /** What the selection panel will send with, before there is a comment. */
  const panelGateway = selectionGateway ?? defaultGateway;
  const panelSdk = selectionSdk ?? defaultSdk;

  /** The agents that have an adapter, as the descriptor named them. */
  const agentChoices = agentRows(descriptor?.sdks ?? [], gateways?.gateways ?? []);

  /** §7 — whether this agent has output styles at all. */
  const stylesFor = (sdk: AgentSdk): boolean =>
    descriptor?.sdks.find((one) => one.id === sdk)?.supportsStyles ?? true;

  /**
   * A gateway was saved, deleted or made the default: take the new list, and
   * forget every model list, because §4.1's cascade has to rebuild them.
   *
   * All of them and not just the one that changed: `Use as default` moves which
   * model `Original` starts on, and a delete moves what a comment falls back to.
   * Re-asking three cached lists costs three IPC round trips against a probe
   * main has already made.
   */
  const refreshGateways = (next: GatewayListResponse): void => {
    setGateways(next);
    setChoicesByGateway({});
  };

  /**
   * Spec 46 §8 rule 3 — one task at a time, with the screen saying so.
   *
   * Every Settings action can restart the gateway, and a restart waits for
   * in-flight runs (§4.3). `busy` is what stops a second Save landing while the
   * first is still waiting on a five-minute local turn.
   */
  const settingsWork = async (task: () => Promise<void>): Promise<void> => {
    setSettingsBusy(true);
    try {
      await task();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsBusy(false);
    }
  };

  /**
   * §5.1 — depth 1, the one screen not reached from a comment.
   *
   * `fromChat` records whether depth 2 was reached through here, which is what
   * decides if depth 2 draws a `‹ Traffic` breadcrumb: opened from the comment
   * card there is nothing behind it to go back to.
   */
  const openTraffic = useCallback((): void => {
    setTraffic({ depth: 1 });
    setTrafficChats(null);
    void window.rex.traceChats().then(setTrafficChats);
  }, []);

  /**
   * Spec 46 §4.6 and spec 51 §5.2 — depth 2, one chat's turns.
   *
   * **The comment card's button, its glyph, its row and its IPC all stay; only
   * the destination changes**, which is the second time that has been true of
   * this control and the same reasoning both times — a control that vanishes
   * looks like a bug. It opened Grafana, then a list of requests, and now a list
   * of TURNS, which is the unit a person actually asks about.
   *
   * The screen is shown at once with nothing read, so the click has a visible
   * answer before the file has been. A comment with a long thread has hundreds
   * of rows and reading them is not instant.
   */
  const openTrafficChat = useCallback((threadId: string, fromChats: boolean): void => {
    setTraffic({ depth: 2, threadId, fromChats });
    setTrafficChat(null);
    void window.rex.traceTurns(threadId).then((result) => {
      setTrafficChat(result);
    });
  }, []);

  /**
   * §5.3 — depth 3, one turn, and §5.4 — depth 4, one message of it.
   *
   * The body is fetched when an exchange is PICKED, not with the rail, because a
   * request body is the whole request since §3: a rail of five exchanges would
   * otherwise ship five whole conversations to draw five numbers.
   */
  const readExchange = useCallback((rowId: string | null): void => {
    setTrafficBodies(null);
    if (rowId) void window.rex.traceMessage(rowId).then(setTrafficBodies);
  }, []);

  /**
   * Spec 51 §6 defect 1 — take the gateway's state the moment main says it has
   * settled, rather than only on a click.
   *
   * Mounted for the whole app and not only while Settings is open, because the
   * gateway settles about 1.6 seconds after boot and the screen may be opened
   * before or after that. Holding the state either way is what makes the port
   * appear **without any click**, which is criterion A11.
   */
  useEffect(() => window.rex.onGatewaySettled(setBuiltin), []);

  /**
   * Read what Settings draws, when it opens and not before.
   *
   * A paid provider is enumerated by `SettingsModels` on mount, and doing that
   * on every App render would bill an account for a screen nobody opened.
   */
  useEffect(() => {
    if (!settings.open) return;
    void (async () => {
      const [state, catalogue, list, health, size] = await Promise.all([
        window.rex.gatewayBuiltinState(),
        window.rex.gatewayProviderCatalogue(),
        window.rex.gatewayProviderList(),
        window.rex.gatewayStorageHealth(),
        window.rex.gatewayTrafficSize(),
      ]);
      setBuiltin(state);
      setProviderCatalogue(catalogue);
      setProviders(list);
      setStorageHealth(health);
      setTrafficSize(size);
    })();
  }, [settings.open]);

  /**
   * §4.0 — a NEW comment reads the settings; one already sent starts on what it
   * last used.
   *
   * The order is deliberate: an explicit pick in this session wins, then what
   * the comment's own newest answer ran through, then the app-wide default.
   * A reply usually continues the conversation it is in.
   */
  const gatewayOf = (threadId: string): string => {
    const picked = gatewayByThread[threadId];
    if (picked) return picked;
    const thread = threadsRef.current.find((one) => one.id === threadId);
    const last = thread ? lastGatewayId(thread.messages, gateways?.gateways ?? []) : null;
    return last ?? defaultGateway;
  };

  const setGateway = (threadId: string, gatewayId: string): void =>
    setGatewayByThread((current) => ({ ...current, [threadId]: gatewayId }));

  /**
   * Spec 44 §3 — the agent this comment's next send runs on.
   *
   * The same three-step order the gateway uses, one control to the left: an
   * explicit pick in this session, then the agent this comment's own newest
   * answer ran on, then the app-wide default. A reply usually continues the
   * conversation it is in — and here that matters more than it does for the
   * model, because changing it starts a fresh session (§3).
   */
  const sdkOf = (threadId: string): AgentSdk => {
    const picked = sdkByThread[threadId];
    if (picked) return picked;
    const thread = threadsRef.current.find((one) => one.id === threadId);
    return (thread ? (lastUsed(thread.messages)?.sdk ?? null) : null) ?? defaultSdk;
  };

  /**
   * §3's cascade — the agent moved, so the gateway may have to move with it.
   *
   * Spec 43 §4.1's rule for the model, applied one control to the left: a
   * rebuild that drops the current value picks the first that works. Without it
   * a reviewer switching to Codex on a gateway with only a Claude route keeps a
   * selection that cannot send, and learns it by pressing ASK.
   */
  const setSdk = (threadId: string, sdk: AgentSdk): void => {
    setSdkByThread((current) => ({ ...current, [threadId]: sdk }));
    const moved = gatewayForAgent(gateways?.gateways ?? [], sdk, gatewayOf(threadId));
    if (moved) setGateway(threadId, moved);
  };

  /** The model list for one route, and the empty one while it is being asked. */
  const choicesFor = (sdk: AgentSdk, gatewayId: string): AgentChoices =>
    choicesByGateway[`${sdk}:${gatewayId}`] ?? EMPTY_CHOICES;

  /** Null means "follow the default", which is what most comments do. */
  const modelOf = (threadId: string): string | null => modelByThread[threadId] ?? null;

  /** What actually goes on the wire: the pick, or the default it follows. */
  const modelFor = (threadId: string): string =>
    modelOf(threadId) ?? choicesFor(sdkOf(threadId), gatewayOf(threadId)).chosen;

  const setModel = (threadId: string, model: string | null): void =>
    setModelByThread((current) => {
      const next = { ...current };
      if (model === null) delete next[threadId];
      else next[threadId] = model;
      return next;
    });

  /**
   * Spec 43 §4 — the gateway rows one control draws, and the two things it must
   * say about them.
   *
   * Built here rather than in the components, because both surfaces need the
   * same answer and the rule for a combination that cannot run (§4.2) is the
   * spec's, not the layout's.
   */
  const gatewayChoice = (
    sdk: AgentSdk,
    gatewayId: string,
    messages: readonly Message[],
  ): GatewayChoice => {
    const views = gateways?.gateways ?? [];
    const label = descriptor?.sdks.find((one) => one.id === sdk)?.label ?? "this agent";
    const chosen = views.find((view) => view.gateway.id === gatewayId);
    return {
      rows: gatewayRows(views, sdk),
      blocked: (id) => {
        const view = views.find((one) => one.gateway.id === id);
        return view ? unusableReason(view, sdk, label) : null;
      },
      replayNotice: chosen ? replayNotice(messages, chosen.gateway.name, sdk) : null,
    };
  };

  /** The four fields a send carries (§2.1), for one comment. */
  const choicesOf = (threadId: string): SendChoices => ({
    sdk: sdkOf(threadId),
    gatewayId: gatewayOf(threadId),
    model: modelFor(threadId),
    // Spec 44 §7 — an agent with no styles is sent none. Main rejects a
    // non-null style on such a route rather than ignoring it, so sending one
    // here would turn a hidden control into a refused send.
    style: stylesFor(sdkOf(threadId)) ? styleOf(threadId) : null,
  });

  useEffect(() => {
    void window.rex.modelList().then(setModelList);
    void window.rex.gatewayDescribe().then(setDescriptor);
    void window.rex.gatewayList().then(setGateways);
  }, []);

  /**
   * §4.1's cascade — the gateway moved, so the model list is rebuilt from it.
   *
   * Every gateway on screen is asked once. A route the reviewer never opens
   * costs one probe and nothing else; the alternative is a menu that is empty
   * for a second every time the control moves.
   */
  useEffect(() => {
    for (const view of gateways?.gateways ?? []) {
      for (const agent of descriptor?.sdks ?? []) {
        // Spec 44 §3 — once per (agent, gateway), because that is what a model
        // list is a function of. Main caches by the same key, so the pairs a
        // reviewer never opens cost one probe each and nothing after.
        const key = `${agent.id}:${view.gateway.id}`;
        if (key in choicesByGateway) continue;
        void window.rex
          .modelList(view.gateway.id, agent.id)
          .then((answer) => setChoicesByGateway((was) => ({ ...was, [key]: answer })));
      }
    }
  }, [gateways, descriptor, choicesByGateway]);

  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Spec 53 §5.4 — the way back.
   *
   * State and a ref, for the reason `threadsRef` is both: the two buttons are
   * drawn from the state, and the commands that change it run inside callbacks
   * that must not depend on the closure of the render that made them.
   */
  const [history, setHistoryState] = useState<History>(EMPTY_HISTORY);
  const historyRef = useRef<History>(EMPTY_HISTORY);
  /**
   * §4.7 — the hover tip, and what it costs.
   *
   * The cache is keyed by `href` alone and emptied whenever the document
   * changes, because an `href` is relative to the file it is written in and
   * `overview.md` means two different files in two different folders.
   */
  const [linkTip, setLinkTip] = useState<{ pane: DocumentVersion; view: LinkTipView } | null>(null);
  const tipCache = useRef<Map<string, LinkResolution>>(new Map());
  const tipTimer = useRef<number | null>(null);
  const setHistory = useCallback((next: History): void => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);
  // Spec 02: the workspace is a view of a folder, independent of which
  // document is open, so switching documents never disturbs it.
  const [workspace, setWorkspace] = useState<WorkspaceRef | null>(null);
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [graph, setGraph] = useState<ReferenceGraph | null>(null);
  const [centre, setCentre] = useState<Centre>("document");
  /**
   * One notion of "selected", shared by the explorer and the graph. It follows
   * the open document, but a graph node that cannot be opened — an external or
   * missing file — can be selected without opening anything.
   */
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [explorerWidth, setExplorerWidth] = useState(272);
  const [commentsWidth, setCommentsWidth] = useState(384);
  /**
   * The widest the comments column may be dragged. The old fixed 760 was too
   * low: a long answer, a diff or a tool trace wants half the window or more,
   * and on a wide screen 760 is nowhere near half. So the ceiling follows the
   * window and only holds back the last strip of it, which keeps a sliver of
   * document on screen — the splitter lives on the column's edge, so that
   * strip is also what the reviewer grabs to drag it back.
   *
   * The floor keeps a narrow window exactly as it was.
   */
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const commentsMax = Math.max(760, windowWidth - 240);
  /**
   * Spec 10 §3.5 — whether the tree lists the folders REX skips on its own.
   *
   * A view state and not a stored one: it is how you go and find `node_modules`
   * once, not a way of working. The reviewer's own exclusions are not governed
   * by it — they are always drawn — and the rules themselves are in the
   * database.
   */
  const [showSkipped, setShowSkipped] = useState(false);
  /**
   * Whether each side panel is on screen.
   *
   * View state and not stored, like `showSkipped` above and unlike spec 27's
   * paper switches: hiding a panel is how you give one document the whole
   * window for a minute, not a way of working. Both come back on the next
   * launch, which is also the only state a reviewer can be sure of finding.
   *
   * The panels are HIDDEN, never unmounted — `.rex-pane-hidden` is
   * `display: none`. Unmounting the comments column would drop a reply
   * half-written, and unmounting the explorer would drop the tree's open
   * folders and make coming back a second scroll.
   */
  const [explorerShown, setExplorerShown] = useState(true);
  const [commentsShown, setCommentsShown] = useState(true);
  /** Spec 10 §2 — the figure being read at a real size, if any. */
  const [preview, setPreview] = useState<PreviewFigure | null>(null);

  // design/selection — pick mode and the region drag it can hand off to. The
  // chain the mode steers is spec 26's `pathScopes`, below: it outlives the
  // mode now, so it is not the mode's to own.
  const [picking, setPicking] = useState(false);
  const [arming, setArming] = useState(false);
  /** Spec 06 §5.1 — the pen, a mode like pick and off by default. */
  const [penning, setPenning] = useState(false);
  /**
   * Spec 16 §6.6 — Add, a mode like the other two and off by default.
   *
   * It was on whenever the pointer was in a gap, and that is wrong for the same
   * reason pick mode is not: a reviewer moving down a page they are only
   * READING got a rule and a pill thrown across the prose every few lines. An
   * affordance that appears without being asked for is furniture in the way.
   *
   * Held ⇧ arms it, exactly as held ⌥ arms pick.
   */
  const [adding, setAdding] = useState(false);
  /** The document's own zoom. 1 is 100%. */
  const [zoom, setZoom] = useState(1);
  /**
   * Spec 27 §4 — how REX draws the page it typeset itself.
   *
   * The reviewer's, not the document's: it survives opening another file, and
   * outlives the session in the `setting` table (§4.7). Both panes read it,
   * which is what stops a comparison from having two grounds (§4.6).
   */
  const [paper, setPaper] = useState<PaperView>(PAPER_VIEW_DEFAULT);
  /**
   * Read once, on mount. Until it answers the page is drawn narrow and light,
   * which is the same first paint a reviewer who never touched the switches
   * gets — so a stored `wide` shows as one reflow at open rather than as a
   * flash of the wrong ground.
   */
  useEffect(() => {
    void window.rex.paperView().then(setPaper);
  }, []);

  /**
   * Spec 27 §4.7 — every change is written through.
   *
   * The write is not awaited and its failure is not shown: it is a reading
   * preference, and a reviewer whose disk refused it should still get the
   * paper they just asked for.
   */
  const paperRef = useRef(paper);
  paperRef.current = paper;
  const changePaper = useCallback((next: PaperView): void => {
    setPaper(next);
    void window.rex
      .paperViewSet(next)
      .catch((error: unknown) => console.warn("[rex] the paper setting was not stored", error));
  }, []);
  const togglePaperWide = useCallback(
    (): void => changePaper({ ...paperRef.current, wide: !paperRef.current.wide }),
    [changePaper],
  );
  const togglePaperDark = useCallback(
    (): void => changePaper({ ...paperRef.current, dark: !paperRef.current.dark }),
    [changePaper],
  );

  // ── The selection panel (spec 05 §3) ────────────────────────
  //
  // It is the reviewer's, not the document's: opening another document, or the
  // graph, leaves it exactly as it was. That is what makes a question about two
  // documents possible at all. It is session-only and never written to the
  // database — a half-built selection restored three days later is a puzzle.
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [selectionNote, setSelectionNote] = useState("");
  /**
   * Spec 30 §3.6 — the name being typed in the composer, from the moment it
   * opens.
   *
   * It is App's and not the panel's for the reason the lane is (§5.5): the
   * panel is not on screen when the composer is empty — `SelectionPanel` draws
   * one line of prose until a place is picked — so a name box living in it
   * could not be reached until after the first click, which is the complaint.
   * It sits in the composer's own header instead, which is always there.
   */
  const [selectionTitle, setSelectionTitle] = useState("");
  /**
   * Spec 24 §3.5 — places picked for an OPEN comment and not yet sent, by
   * thread id.
   *
   * Its own list and not the panel's, because the two number differently: the
   * panel numbers from 1 and a comment's new places number on from the ones it
   * has (§3.3). One list with two numberings would put two `1`s on one page.
   *
   * Keyed by thread so the places belong to the comment they were picked for:
   * `all comments` and back finds them where they were. Not handed to the
   * panel when the card closes — `goToPlace` closes and reopens the card on
   * every jump to another document, and that hand-over would fire each time.
   * Session-only, like the panel.
   */
  const [pendingByThread, setPendingByThread] = useState<Map<string, SelectionItem[]>>(
    () => new Map(),
  );
  /** Spec 08 §3.1 — which job the sidebar is doing. */
  const [sidebarTab, setSidebarTab] = useState<SideScreen>("list");
  /**
   * Spec 30 §3.2 — the draft the composer is editing, or null for a fresh one.
   *
   * It is what makes a draft edited five times ONE comment rather than five.
   * Set when a draft row is opened, cleared on every leave — back, Ask, Save —
   * so the next thing the composer builds starts from nothing.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  /**
   * Spec 30 §5.5 — the lane the panel is showing, and it lives HERE.
   *
   * It was `Sidebar`'s own `useState`, which made §1.1's fault structural: the
   * paper could not see it, so the pills narrowed the list and left the
   * document drawing every bar. Lifting it also fixes the smaller fault in the
   * same line — `Sidebar` unmounts whenever a comment card opens, so the row
   * used to snap back to `open` every time a comment was read.
   */
  const [lane, setLane] = useState<Lane>("open");
  /** Narrowed to the open document. Off by default: the list is the workspace's. */
  const [onlyThisFile, setOnlyThisFile] = useState(false);
  /** Spec 08 §6 — the comment whose trace is covering the document pane. */
  const [traceId, setTraceId] = useState<string | null>(null);

  /** Spec 08 §7.2 — which of the open comment's places is being pointed at. */
  const [hoveredPlace, setHoveredPlace] = useState<number | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  /** Hovering a row in the panel lights that comment's passages on the paper. */
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  /**
   * Spec 26 §2 — the chain the path bar shows, and which of it is chosen.
   *
   * One chain, about one of two things. `pathFocus` says which: a place when it
   * is set, the thing under the cursor when it is null. It used to be two
   * chains — the hover's, and a private copy the expanded panel row kept — and
   * spec 26 puts both on the same bar, where two answers would be visible.
   */
  const [pathScopes, setPathScopes] = useState<PickScope[] | null>(null);
  const [pathActive, setPathActive] = useState(0);
  /**
   * Spec 16 §4 — which pane the chain above was built in.
   *
   * A chain holds live elements of one document, and both panes offer pick mode
   * and hold places. Without this the left pane's chain would be drawn over the
   * right pane's prose, at coordinates that mean nothing there.
   */
  const [pathPane, setPathPane] = useState<DocumentVersion>("current");
  /** Spec 26 §4.2 — the place the bar is about, or null while it is a hover. */
  const [pathFocus, setPathFocus] = useState<PathFocus | null>(null);
  /** Spec 05 §5.6.1 — what a pending Apply changed in the document on screen. */
  const [changeBoxes, setChangeBoxes] = useState<ScopeRect[]>([]);

  /**
   * Spec 08 §3.1 — the tab follows what the reviewer is doing, in both
   * directions. Picking a first place is starting to select, so the Selection
   * tab comes forward; Ask empties the panel, so the tabs go with it and the
   * answer is where the reviewer is already looking.
   *
   * Only on the *edges*. Switching tabs by hand while a selection stands must
   * not be undone on the next render, which is what a plain `length > 0` test
   * would do.
   */
  const hadSelection = useRef(false);
  useEffect(() => {
    const has = selection.length > 0;
    if (has !== hadSelection.current) setSidebarTab(has ? "composer" : "list");
    hadSelection.current = has;
  }, [selection.length]);

  // The comments column's ceiling follows the window, so it has to be measured
  // again whenever the window changes size.
  useEffect(() => {
    const measure = (): void => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  /**
   * Spec 08 §3.1 — entering pick or the pen is starting to select, so the tab
   * that shows a selection comes forward with the mode.
   *
   * The edge rule above is not enough on its own. It fires when the panel goes
   * from empty to holding something, so a *second* place picked while the
   * reviewer is reading the Comments tab lands in a tab they cannot see, and
   * the pick reads as having done nothing. Hooking the mode rather than the
   * place also puts the panel in front before the first click, which is where
   * the reviewer needs it: the row appears under a heading they are already
   * looking at.
   *
   * **The tab is borrowed, not taken.** A mode that ends with nothing picked
   * hands it back. Without that, every moment of pick mode costs the reviewer
   * their place: they were reading a comment, something armed pick, and they
   * come back to a Selection tab reading 0.
   *
   * One of those "somethings" is not a gesture at all. This machine switches
   * macOS desktops with ⌥ and a digit, so the window sees the ⌥ press, loses
   * focus, and never sees the release — the hold below arms pick mode into an
   * empty room. Reported on 2026-08-31: leave the desktop REX is on, come back,
   * and the sidebar is on Selection. `onBlur` in the keyboard effect ends the
   * hold; this is what puts the reviewer back where they were.
   */
  const tabBeforeMode = useRef<SideScreen | null>(null);
  // The effect itself sits below `cardOnScreen`, which it needs and which needs
  // every ref declared between here and there.

  const surfaceRef = useRef<DocumentSurface | null>(null);
  /**
   * Spec 16 §4.2 — the original pane's surface.
   *
   * Two live DOMs are resolved against now, both in the renderer, so invariant
   * I1 holds and is exercised harder. Null whenever there is no proposal to
   * compare against, which is every document nobody has changed.
   */
  const originalSurfaceRef = useRef<DocumentSurface | null>(null);
  const docRef = useRef<OpenedDocument | null>(null);

  /**
   * Spec 28 §4.1 — the pane being read, which is where a find acts and where
   * its bar and ruler are drawn. The original only while it is the one pane on
   * screen; a find painted on a hidden pane would report `12 of 12` over an
   * empty screen.
   */
  const readPane: DocumentVersion =
    paneMode === "original" && original !== null ? "original" : "current";
  /**
   * Spec 28 — the find bar, the Search, and which of the two the page shows.
   *
   * The dependencies go in by ref and are filled below `guard`, because
   * `sweep` (next) has to call `find.refind()` and `openDocument` — which the
   * jump needs — is declared long after it.
   */
  const findDeps = useRef<FindDeps>({
    surface: () => null,
    pane: "current",
    documentPath: () => null,
    openDocument: async () => {},
  });
  const find = useFind(findDeps, readPane);
  const threadsRef = useRef<ThreadWithMessages[]>([]);
  const groupsRef = useRef<CommentGroup[]>([]);
  const workspaceRef = useRef<WorkspaceRef | null>(null);
  /** Read by `refreshTree`, which has to stay stable — see its own note. */
  const showSkippedRef = useRef(false);
  showSkippedRef.current = showSkipped;
  const pendingApplyRef = useRef<ApplyReadyEvent | null>(null);
  /**
   * Which comments were already orphaned when this Apply began.
   *
   * Taken the moment the agent finishes, *before* the document is re-rendered
   * for review — by the time OK is pressed the sweep that draws the outlines has
   * already restated everything, so a set taken then would contain the orphans
   * this Apply just created and report "0 newly lost" about a change that lost
   * two. Measured on 2026-08-21 against the two-file fixture.
   */
  const orphansBeforeApply = useRef<Set<string>>(new Set());
  /** The sweep's own result, readable before React has re-rendered with it. */
  const resolvedRef = useRef<ResolvedThread[]>([]);
  /** Resolves the promise §8.7 step 6 is waiting on, once the sweep is done. */
  const sweepWaiter = useRef<((summary: AnchorSummary) => void) | null>(null);
  /**
   * A panel row clicked while its document was closed. The scroll cannot happen
   * until that document has loaded and handed up a surface, so it waits here.
   */
  const scrollWhenReady = useRef<SelectionItem | null>(null);
  /**
   * Spec 08 §7.3 — a place row's jump asks for a plain anchor in a document
   * that is not open yet.
   *
   * Its own ref rather than reusing `scrollWhenReady`, which carries a
   * `SelectionItem`: a stored place is not a selection, and manufacturing one
   * would put a row in the panel that the reviewer never built.
   */
  const anchorWhenReady = useRef<{ path: string; anchor: Anchor } | null>(null);
  /**
   * Spec 53 §5.6 — the third of these, and for the same reason as the other
   * two: a document that is still opening has no DOM to scroll.
   *
   * A link's `#fragment` and Back's remembered place are both "somewhere in the
   * document that is about to arrive", so they share one ref and are told apart
   * by `kind`. Guarded on the path when it lands, so a second navigation
   * started before the first finished cannot land the wrong jump.
   */
  const arriveWhenReady = useRef<{
    path: string;
    at: { kind: "fragment"; id: string } | { kind: "place"; place: DocumentPlace };
  } | null>(null);
  /** Read by the sweep, which re-measures every row's box (§6). */
  const selectionRef = useRef<SelectionItem[]>([]);
  /**
   * Spec 30 §3.2 — what the back arrow needs, and it keeps one identity for the
   * life of the app, so it reads these rather than closing over the render's
   * own values.
   */
  const draftIdRef = useRef<string | null>(null);
  const selectionNoteRef = useRef("");
  const selectionTitleRef = useRef("");
  /** Spec 24 §3.5 — the same, for the places waiting on each open comment. */
  const pendingRef = useRef<Map<string, SelectionItem[]>>(new Map());
  /** Read by the sweep, which paints the open comment's passages violet (§6). */
  const activeIdRef = useRef<string | null>(null);
  /**
   * Read through refs rather than closed over, so the pick callbacks keep one
   * identity for the life of the app — DocumentView's tier 1 effect depends on
   * that, and a new identity there rewrites the iframe's `srcdoc`.
   */
  const pathActiveRef = useRef(0);
  /** The chain on screen, for the click that lands where no element is. */
  const pathScopesRef = useRef<PickScope[] | null>(null);
  /** Spec 26 §4.2 — read by the arrow keys, which are bound once and for all. */
  const pathFocusRef = useRef<PathFocus | null>(null);
  const zoomRef = useRef(1);
  /**
   * Whether the chosen scope was chosen **by hand** — ↑ ↓ or a crumb — rather
   * than by the last probe. Only a deliberate choice is carried across a
   * pointer move; see `keptIndex`, which explains what a PDF page did to the
   * old rule.
   */
  const pickChosenByHand = useRef(false);
  /** Which pane the chain on screen belongs to, for the callbacks that commit it. */
  const pathPaneRef = useRef<DocumentVersion>("current");
  /** §4.1 — what the new-version pane answers a gesture on. See `liveRangesOf`. */
  const liveRangesRef = useRef<LineRange[] | null>(null);
  liveRangesRef.current = liveRangesOf(doc);

  /**
   * Spec 13 §4.2 — the four view fields the debug report needs, and the shell
   * element it reaches the document frame through.
   *
   * Refs and not the render's own values: `copyDebug` is registered once, as a
   * key binding, and a callback that captured state would report whatever was
   * true when it was made.
   */
  const centreRef = useRef<Centre>("document");
  const sidebarTabRef = useRef<SideScreen>("list");
  const traceIdRef = useRef<string | null>(null);
  const noticeRef = useRef<string | null>(null);
  const appRef = useRef<HTMLDivElement>(null);

  docRef.current = doc;
  threadsRef.current = threads;

  /**
   * §2.1 — the style each comment is having, seeded from `thread.style`.
   *
   * The deliberate opposite of `modelByThread` above, which resets on restart.
   * This map starts empty and every lookup falls through to the stored column,
   * so a comment reopened tomorrow is still having the conversation it was.
   */
  const [styleByThread, setStyleByThread] = useState<Record<string, string>>({});

  const styleOf = (threadId: string): string => {
    const picked = styleByThread[threadId];
    if (picked !== undefined) return picked;
    const stored = threadsRef.current.find((one) => one.id === threadId)?.style;
    return stored ?? DEFAULT_STYLE;
  };

  const setStyle = (threadId: string, style: string): void =>
    setStyleByThread((current) => ({ ...current, [threadId]: style }));
  workspaceRef.current = workspace;
  pendingApplyRef.current = pendingApply;
  selectionRef.current = selection;
  draftIdRef.current = draftId;
  selectionNoteRef.current = selectionNote;
  selectionTitleRef.current = selectionTitle;
  pendingRef.current = pendingByThread;
  activeIdRef.current = activeId;
  pathActiveRef.current = pathActive;
  pathScopesRef.current = pathScopes;
  pathPaneRef.current = pathPane;
  pathFocusRef.current = pathFocus;
  zoomRef.current = zoom;
  centreRef.current = centre;
  sidebarTabRef.current = sidebarTab;
  traceIdRef.current = traceId;
  noticeRef.current = notice;

  /**
   * Spec 24 §3.1 — the comment a selection joins, when its card is on screen.
   *
   * "On screen" is a card open AND the sidebar on the Comments tab. A reviewer
   * who clicked the Selection tab by hand while a card is open is building a
   * new comment, and their selection goes to the panel. A synthesis comment has
   * no places and takes none (§3.6).
   *
   * Reads refs, not state, because it is called from callbacks that keep one
   * identity for the life of the app.
   */
  const cardOnScreen = useCallback((): ThreadWithMessages | null => {
    const id = activeIdRef.current;
    if (id === null || sidebarTabRef.current !== "list") return null;
    const thread = threadsRef.current.find((one) => one.id === id) ?? null;
    return thread && thread.kind !== "synthesis" ? thread : null;
  }, []);

  useEffect(() => {
    // Spec 24 §3.1 — not while a card is on screen. The picked places land in
    // the card, which the reviewer can already see, so there is nothing to
    // bring forward and nothing to hand back afterwards.
    if ((picking || penning) && cardOnScreen() === null) {
      if (tabBeforeMode.current === null) tabBeforeMode.current = sidebarTabRef.current;
      setSidebarTab("composer");
      return;
    }
    const before = tabBeforeMode.current;
    tabBeforeMode.current = null;
    // Only when the mode produced nothing. A reviewer who picked places wants
    // to look at them, and they are in the tab the mode opened.
    if (before !== null && selectionRef.current.length === 0) setSidebarTab(before);
  }, [picking, penning, cardOnScreen]);

  /**
   * Each thread's targets' states, in target order — the stored one, or the
   * fresher answer this sweep found for the targets it could check (§5.4).
   *
   * The sweep wins where it has an answer: `threads` is only refetched when
   * something else forces it, so its stored states are the older of the two.
   */
  const targetStatesById = useMemo(() => {
    const sweptBy = new Map(resolved.map((entry) => [entry.threadId, entry]));
    const map = new Map<string, Array<AnchorState | null>>();
    for (const thread of threads) {
      const swept = sweptBy.get(thread.id);
      map.set(
        thread.id,
        thread.targets.map(
          (target, position) =>
            swept?.checked.find((check) => check.position === position)?.state ?? target.state,
        ),
      );
    }
    return map;
  }, [threads, resolved]);

  /**
   * Spec 32 §5 — how each thread's places came out, counted.
   *
   * The tally and not the state is the memo, because the two summaries below it
   * need different halves of it: the lane wants one state, and the row's word
   * wants `1 of 4`. Deriving the count back out of a state is impossible, so the
   * count is what is kept.
   */
  const tallyById = useMemo(() => {
    const map = new Map<string, PlaceTally>();
    for (const [threadId, states] of targetStatesById) map.set(threadId, tallyPlaces(states));
    return map;
  }, [targetStatesById]);

  /**
   * Spec 32 §2 — a thread is lost only when EVERY place it has is lost, and the
   * ones nobody has looked at count in neither direction (§5.4). Null when
   * nobody has looked at any of them.
   */
  const stateById = useMemo(() => {
    const map = new Map<string, AnchorState | null>();
    for (const [threadId, tally] of tallyById) map.set(threadId, threadState(tally));
    return map;
  }, [tallyById]);

  /**
   * The same two facts per PLACE rather than per thread: what it is, and which
   * line it is on now. Only the sweep can answer either — both are read off the
   * live DOM — so a place in a document that is not open has neither, and the
   * card falls back to what its stored anchor says.
   */
  const targetPlacesById = useMemo(() => {
    const sweptBy = new Map(resolved.map((entry) => [entry.threadId, entry]));
    const map = new Map<string, PlaceFacts[]>();
    for (const thread of threads) {
      const swept = sweptBy.get(thread.id);
      map.set(
        thread.id,
        thread.targets.map((_, position) => {
          const check = swept?.checked.find((entry) => entry.position === position);
          // Spec 35 §3 — and the line it ends on, from the same sweep.
          return {
            label: check?.label ?? null,
            line: check?.line ?? null,
            lineEnd: check?.lineEnd ?? null,
          };
        }),
      );
    }
    return map;
  }, [threads, resolved]);

  const numbers = useMemo(
    () => new Map(threads.map((thread, position) => [thread.id, position + 1])),
    [threads],
  );

  /**
   * Spec 30 §2 — which lane each comment is in, from the MERGED state.
   *
   * One map, read by the panel's five counts and by what the paper draws, so
   * the list and the page cannot disagree about where a comment belongs.
   */
  const laneById = useMemo(() => {
    const map = new Map<string, Lane>();
    for (const thread of threads) {
      map.set(thread.id, laneOf(thread.status, stateById.get(thread.id) ?? null));
    }
    return map;
  }, [threads, stateById]);

  /**
   * Spec 30 §5 — the filter reaches the paper, and this is the whole of it.
   *
   * `MarginBars`, the block outlines and the gap rules in `PaneMarks` all read
   * one `ResolvedThread[]`, so filtering it once moves all three and they cannot
   * disagree. **`threads` is never filtered**: §5.2 — both `MarginBars` and
   * `Sidebar` number comments by position in the full list, and narrowing it
   * would renumber the document every time a pill was pressed.
   *
   * §5.3 — the open comment passes whatever the pill says. Open a resolved
   * comment, then press `open`: the card is still on screen, and a reviewer
   * reading a comment is not asking to have it hidden.
   */
  const onPaper = useCallback(
    (entry: ResolvedThread): boolean =>
      entry.threadId === activeId || laneById.get(entry.threadId) === lane,
    [laneById, lane, activeId],
  );
  const paneShown = useMemo(
    () => ({
      current: paneResolved.current.filter(onPaper),
      original: paneResolved.original.filter(onPaper),
    }),
    [paneResolved, onPaper],
  );

  // ── Resolution sweep (§6.5, §6.6) ───────────────────────────

  /**
   * Spec 05 §6 — every selected place, measured against the document as it is
   * now rather than as it was when it was clicked.
   *
   * Part of the sweep and not an effect of its own, because it answers the same
   * question the sweep does — where is this anchor? — and every reason to run
   * one is a reason to run the other. Rows in another document are left alone:
   * their box is still true of the document they belong to.
   */
  const remeasureSelection = useCallback(async (openDocumentId: string): Promise<void> => {
    // Spec 24 §3.3 — the places waiting on every open comment are measured
    // too, for the same reason and by the same code: their outlines are drawn
    // from these boxes. Every comment's, not the open one's only, so a card the
    // reviewer returns to has boxes that are true of the document as it is.
    const items = [...selectionRef.current, ...[...pendingRef.current.values()].flat()];
    const here = items.filter((item) => item.documentId === openDocumentId);
    if (here.length === 0) return;

    // Spec 16 §4 — each row is measured in the pane it was taken from, and only
    // falls to the other one when its own no longer has it. That is what makes
    // a place survive an approve: the original pane goes, and the row's box is
    // re-found in the one version that is left.
    const measured = new Map<string, { place: MeasuredPlace | null; pane: DocumentVersion }>();
    for (const pane of ["current", "original"] as const) {
      const surface = pane === "original" ? originalSurfaceRef.current : surfaceRef.current;
      const wanted = here.filter(
        (item) => !measured.has(item.id) || measured.get(item.id)?.place === null,
      );
      if (!surface || wanted.length === 0) continue;
      const places = await surface.rectsForAnchors(
        wanted.map((item) => ({ anchor: item.anchor, kind: item.kind })),
      );
      wanted.forEach((item, position) => {
        const place = places[position] ?? null;
        // Its own pane's answer stands even when it is null, unless the other
        // pane can do better — a row that resolves nowhere keeps no box at all.
        if (place !== null || !measured.has(item.id)) measured.set(item.id, { place, pane });
      });
    }

    // The same list back when nothing moved: this runs on every sweep, and a
    // fresh array each time would re-render the panel and the outlines for
    // nothing.
    const remeasured = (current: SelectionItem[]): SelectionItem[] => {
      let moved = false;
      const next = current.map((item) => {
        const found = measured.get(item.id);
        if (!found) return item;
        const rect = found.place?.rect ?? null;
        const lines = found.place?.lines ?? null;
        if (
          same(item.rect, rect) &&
          sameLines(item.lines, lines) &&
          item.zoom === zoomRef.current &&
          item.pane === found.pane
        )
          return item;
        moved = true;
        return { ...item, rect, lines, pane: found.pane, zoom: zoomRef.current };
      });
      return moved ? next : current;
    };

    setSelection(remeasured);
    setPendingByThread((current) => {
      let changed = false;
      const next = new Map<string, SelectionItem[]>();
      for (const [threadId, list] of current) {
        const after = remeasured(list);
        if (after !== list) changed = true;
        next.set(threadId, after);
      }
      return changed ? next : current;
    });
  }, []);

  const sweep = useCallback(async (): Promise<AnchorSummary> => {
    const surface = surfaceRef.current;
    const originalSurface = originalSurfaceRef.current;
    const current = docRef.current;
    const summary: AnchorSummary = { ok: 0, moved: 0, orphaned: 0, total: 0 };
    if (!current || (!surface && !originalSurface)) return summary;

    const inCurrent = surface
      ? await surface.resolve(
          threadsRef.current,
          current.contentChanged,
          current.documentId,
          activeIdRef.current,
        )
      : [];

    // Spec 16 §5.2 — `documentChanged` is ALWAYS false in the original pane.
    // It shows `base`, the file exactly as it was when the working copy was
    // forked, so nothing in it can have moved under an anchor written against
    // it. Passing the document's own `contentChanged` here would report every
    // comment on unchanged text as `moved` the moment any working copy existed.
    const inOriginal = originalSurface
      ? await originalSurface.resolve(
          threadsRef.current,
          false,
          current.documentId,
          activeIdRef.current,
        )
      : [];

    const entries = mergeResolved([inCurrent, inOriginal]);
    resolvedRef.current = entries;
    setResolved(entries);
    setPaneResolved({ current: inCurrent, original: inOriginal });
    setGaps(surface?.gaps() ?? []);
    // Spec 28 §5.2 — the index was just rebuilt, so every find range and every
    // ruler mark measured against the old one is stale. The current match
    // stays where it was; only the paint and the marks follow.
    find.refind();
    await remeasureSelection(current.documentId);

    // Invariant I1 — main stores anchor states but cannot compute them. One call
    // per *target* the sweep could check: §5.4 forbids restating the others,
    // whose documents were never on screen.
    await Promise.all(
      entries.flatMap((entry) =>
        entry.checked.map((check) =>
          window.rex.anchorRestate({
            threadId: entry.threadId,
            position: check.position,
            anchorState: check.state,
          }),
        ),
      ),
    );

    // §5.8 — the summary counts checked targets, not threads. It is a report on
    // what this sweep just did, and it could only do one document's worth.
    for (const entry of entries) {
      for (const check of entry.checked) {
        summary[check.state]++;
        summary.total++;
      }
    }
    return summary;
  }, [remeasureSelection, find.refind]);

  /** §5.6.1 — the boxes for a pending Apply, in whichever document is open. */
  const refreshChangeBoxes = useCallback(async (): Promise<void> => {
    const surface = surfaceRef.current;
    const current = docRef.current;
    const pending = pendingApplyRef.current;
    if (!surface || !current || (!pending && !current.working)) {
      setChangeBoxes([]);
      return;
    }
    const path = current.ref.value;
    // Spec 15 §6.2 — the working copy's own added blocks when there is one. It
    // outlives the run that made it, so `pendingApply` is the wrong source the
    // moment a second run lands or the reviewer reopens the document.
    //
    // Spec 16 §4.1 — with a working copy these are also exactly the blocks that
    // answer a gesture here, which is why the outline needs no companion: what
    // is outlined is what responds.
    const ranges =
      liveRangesOf(current) ??
      (pending?.regions ?? [])
        .filter((region) => region.file === path)
        .map((region) => ({ from: region.from, to: region.to }));
    setChangeBoxes(ranges.length > 0 ? await surface.boxesForLines(ranges) : []);
  }, []);

  /**
   * A resize re-resolves, because an outline is geometry.
   *
   * An anchor on a whole element or a region of one is stored as fractions and
   * drawn as a box in document pixels, and only `sweep()` turns one into the
   * other. Without this the stored anchor stays perfectly correct while the box
   * on screen keeps the size it had at the old width — measured on 2026-08-21
   * on a PDF, where narrowing the window left a region outline 1.23× the width
   * of the page it was cut from. It matters most for a PDF, whose pages scale
   * with the pane instead of reflowing, but it is wrong for every format.
   *
   * DocumentView watches the pane rather than the window, because a splitter
   * drag and the explorer opening both resize the pane without resizing the
   * window — see `Props.onPaneResized`.
   */
  const onPaneResized = useCallback((): void => {
    void sweep();
    void refreshChangeBoxes();
  }, [sweep, refreshChangeBoxes]);

  /**
   * The page was redrawn at a new size, so every box the overlay holds is
   * stale. Geometry, exactly as a resize is, so it re-resolves for the same
   * reason (see the resize effect above). Skipped before there is a surface:
   * this fires once on mount, and sweeping then would clear the list the load
   * is about to fill.
   *
   * Spec 27 §5.4 renamed this from `onZoomApplied`. It has three callers now —
   * the zoom, the width switch and a Mermaid redraw — and a callback named
   * after one of them is how the other two get forgotten.
   */
  const onReflowed = useCallback((): void => {
    if (!surfaceRef.current) return;
    void sweep();
    void refreshChangeBoxes();
  }, [sweep, refreshChangeBoxes]);

  /**
   * §6 — opening a comment recolours its passages, and closing it puts them
   * back.
   *
   * A repaint and not a sweep: the sweep resolves every thread and writes each
   * checked target's state back to the database, and opening a card changes no
   * state at all. The surface still holds the ranges the last sweep found.
   */
  useEffect(() => {
    surfaceRef.current?.repaintActive(activeId);
    // Spec 16 §5.1 — a comment can be about text that only the original has, so
    // opening it has to recolour that pane's passages too.
    originalSurfaceRef.current?.repaintActive(activeId);
  }, [activeId]);

  /**
   * Spec 16 §4.1 — the live set is recomputed whenever the working copy moves:
   * a new revision, an undo, an approve, a discard.
   *
   * A document whose proposal has just been approved or discarded has no
   * working copy any more, so this hands back `null` and the whole pane answers
   * again — which is what Reading mode is.
   *
   * `doc` is the dependency because `doc` is what says the working copy moved;
   * the ranges themselves are read through a ref at call time.
   */
  useEffect(() => {
    surfaceRef.current?.setLiveBlocks(liveRangesRef.current);
  }, [doc]);

  /**
   * Leaving pick mode forgets a deliberate widening.
   *
   * Here rather than only in `leavePick`, because three routes turn pick mode
   * off without going through it: the `P` key, the ⌥ keyup, and the toolbar
   * toggle. A widening remembered across a visit the reviewer had ended would
   * choose their next place for them.
   */
  useEffect(() => {
    if (!picking) pickChosenByHand.current = false;
  }, [picking]);

  const onSurfaceReady = useCallback(
    async (pane: DocumentVersion, surface: DocumentSurface | null): Promise<void> => {
      if (pane === "original") {
        originalSurfaceRef.current = surface;
        // The left lane has nothing in it until this sweep runs, and a comment
        // on removed text has nowhere at all until then.
        await sweep();
        // Spec 28 §5.5 — a Search hit waiting for this pane lands now.
        if (surface) find.surfaceReady("original");
        return;
      }

      surfaceRef.current = surface;
      if (!surface) return;
      // §4.1 — before the first sweep and long before the first gesture: a pane
      // that has not been told what is live would take a comment on anything.
      surface.setLiveBlocks(liveRangesRef.current);
      const summary = await sweep();
      await refreshChangeBoxes();
      // Spec 28 §5.5 — a Search hit waiting for this document lands now, on
      // the first DOM there is to land on.
      find.surfaceReady("current");

      // §3.3 — a row clicked while its document was closed asked to be scrolled
      // to, and this is the first moment there is a DOM to scroll.
      const waiting = scrollWhenReady.current;
      if (waiting && waiting.documentId === docRef.current?.documentId) {
        scrollWhenReady.current = null;
        surface.scrollToAnchor(waiting.anchor);
        // Spec 26 §4.5 — the row asked to be widened, and this is the first
        // moment there is a chain to widen it through. Written out rather than
        // through `focusPlace`, which is declared below `surfaceFor` and cannot
        // be named in this effect's dependency array — and the surface this one
        // wants is the argument it was handed.
        const probe = await surface.scopesForAnchor(waiting.anchor, waiting.kind);
        if (probe && probe.scopes.length > 0) {
          // Spec 26 §4.8 — the refs alongside, exactly as `showChain` does.
          // `showChain` itself is declared below this effect and so cannot be
          // named in its dependency array.
          pathScopesRef.current = probe.scopes;
          pathActiveRef.current = probe.active;
          pathPaneRef.current = waiting.pane;
          setPathScopes(probe.scopes);
          setPathActive(probe.active);
          setPathPane(waiting.pane);
          const focus: PathFocus = {
            itemId: waiting.id,
            threadId: threadOf(pendingRef.current, waiting.id),
            pane: waiting.pane,
            base: { anchor: waiting.anchor, kind: waiting.kind },
          };
          pathFocusRef.current = focus;
          setPathFocus(focus);
        }
      }

      // Spec 07 §8.1 — the same moment, for a finding's Open.
      const jump = anchorWhenReady.current;
      if (jump && docRef.current?.ref.value === jump.path) {
        anchorWhenReady.current = null;
        surface.scrollToAnchor(jump.anchor);
      }

      // Spec 53 §5.6 — and for a link's `#fragment`, or the place Back is on
      // its way to. The path guard is what stops a second navigation started
      // before this one finished from landing the wrong jump.
      const arrival = arriveWhenReady.current;
      if (arrival && docRef.current?.ref.value === arrival.path) {
        arriveWhenReady.current = null;
        if (arrival.at.kind === "place") {
          surface.scrollToPlace(arrival.at.place);
        } else if (!surface.scrollToFragment(arrival.at.id)) {
          // §4.2 — the file opened, the place in it does not exist. The
          // reviewer asked for the file and the file is what REX has.
          setNotice(`No "#${arrival.at.id}" in ${fileNameOf(arrival.path)}.`);
        }
      }

      const waiter = sweepWaiter.current;
      if (waiter) {
        sweepWaiter.current = null;
        waiter(summary);
      }
    },
    [sweep, refreshChangeBoxes, find.surfaceReady],
  );

  // ── Opening documents ───────────────────────────────────────

  const zoomBy = useCallback((factor: number): void => {
    setZoom((current) => clampZoom(current * factor));
  }, []);

  const resetZoom = useCallback((): void => setZoom(1), []);

  /** Spec 06 §5.1 — `esc`, and every route that leaves a mode behind. */
  const leavePen = useCallback((): void => setPenning(false), []);

  /**
   * Spec 26 §4.5 — the bar stops being about a place.
   *
   * Declared here rather than beside the rest of §4's code because four things
   * that run earlier in the file end a focus: opening a document, Ask, `clear`,
   * and leaving pick mode. A `useCallback` dependency array is evaluated during
   * render, so a reference to a `const` declared further down throws.
   */
  /**
   * Spec 26 §4.8 — put a chain on the bar: the state AND its ref, together.
   *
   * The refs above are assigned during render, which is a whole render behind
   * the setter. Every reader of `pathActiveRef` is an event handler, and events
   * do not wait for React: a wheel notch that widens and a click that follows
   * it are two events with no guaranteed render in between, so the click read
   * the index from *before* the widening. That is one of the two ways a click
   * could take the child while the outline showed the parent (§9.6).
   *
   * `probe` and `commitAt` also `await` the surface mid-way, which opens the
   * same window inside a single handler.
   */
  const showChain = useCallback(
    (pane: DocumentVersion, scopes: PickScope[] | null, active: number): void => {
      pathPaneRef.current = pane;
      pathScopesRef.current = scopes;
      pathActiveRef.current = active;
      setPathPane(pane);
      setPathScopes(scopes);
      setPathActive(active);
    },
    [],
  );

  const dropFocus = useCallback((): void => {
    pathFocusRef.current = null;
    pathScopesRef.current = null;
    setPathFocus(null);
    setPathScopes(null);
  }, []);

  const leavePick = useCallback((): void => {
    setPicking(false);
    setArming(false);
    pathScopesRef.current = null;
    pathActiveRef.current = 0;
    setPathScopes(null);
    setPathActive(0);
    // Spec 26 §4.5 — `esc` gives the bar up as well as the mode. The place
    // stays: removing one is the trash button, and it always was.
    pathFocusRef.current = null;
    setPathFocus(null);
    pickChosenByHand.current = false;
  }, []);

  /** What `thread:list` is scoped to — the workspace, or this document's folder. */
  const listRequest = useCallback(
    (documentId: string | null) => ({
      root: workspaceRef.current?.root ?? null,
      documentId,
    }),
    [],
  );

  /**
   * Spec 14 §5.3 — the groups of the open workspace, or none.
   *
   * With no workspace there is no root to hang a group on, so the panel shows a
   * flat list and hides the group controls. Emptying the state here is what
   * makes that true rather than leaving the last workspace's groups on screen.
   */
  const refreshGroups = useCallback(async (): Promise<void> => {
    const root = workspaceRef.current?.root ?? null;
    const list = root ? await window.rex.groupList({ root }) : [];
    setGroups(list);
    // A ref as well as state, for the same reason `threadsRef` is one: the debug
    // report (spec 13 §4.2) is assembled inside a callback that must not depend
    // on this render's closure.
    groupsRef.current = list;
  }, []);

  /**
   * Spec 53 §5.4 — opening a document, with nothing said about history.
   *
   * Split out of `openDocument` so that Back and Forward can reuse every step
   * of it without pushing the place they are travelling FROM. A back that
   * recorded itself would never leave the last two files.
   */
  const loadDocument = useCallback(
    async (ref: DocumentRef): Promise<void> => {
      setSelectedPath(ref.value);
      // §4.7 — an `href` is relative to the file it is written in, so the
      // answers cached for the last document are answers to other questions.
      // The tip itself goes because the link it pointed at is about to stop
      // existing.
      if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
      tipCache.current.clear();
      setLinkTip(null);
      const opened = await window.rex.docOpen(ref);
      await refreshGroups();
      const list = await window.rex.threadList(listRequest(opened.documentId));
      surfaceRef.current = null;
      originalSurfaceRef.current = null;
      // Spec 24 §11.1 — the open card SURVIVES a change of document. Until spec
      // 24 this closed it, on the grounds that the comment being read need not
      // be about the document just opened. That is still true and no longer a
      // reason: the list is workspace-wide (spec 05 §5.3), a card already
      // lists places in documents that are not on screen, and the one thing a
      // reviewer does with a card open and another document opening is point
      // at something in it — which lands in the card only while the card is
      // there. The trace sheet goes, because it covers the document pane and
      // the reviewer has just asked to see a document.
      setTraceId(null);
      setResolved([]);
      setPaneResolved({ original: [], current: [] });
      setGaps([]);
      resolvedRef.current = [];
      // §3.3 — the panel survives. Only the chain belongs to the old DOM, and a
      // chain holds live elements that are about to stop existing. Spec 26 §4.5
      // — so the bar goes with it rather than pointing at a dead element.
      dropFocus();
      leavePick();
      leavePen();
      setThreads(list);
      setDoc(opened);
    },
    [leavePen, leavePick, listRequest, refreshGroups],
  );

  /**
   * Spec 53 §5.4 rule 1 — every route to another document comes through here,
   * and every one of them remembers the place it left.
   *
   * `leavingLine` is a link click's own line, which is the sentence the
   * reviewer was reading. Absent for every other route — the explorer, a search
   * hit, the Open dialog — and then the top of the screen is what there is.
   */
  const openDocument = useCallback(
    async (ref: DocumentRef, leavingLine?: number | null): Promise<void> => {
      const leaving = surfaceRef.current?.placeHere() ?? null;
      // Not when the reviewer is already here: re-opening one document is not a
      // journey, and recording it would put a Back on the button that goes
      // nowhere.
      if (leaving && leaving.path !== ref.value) {
        setHistory(
          pushPlace(
            historyRef.current,
            leavingLine === undefined ? leaving : { ...leaving, line: leavingLine },
          ),
        );
      }
      await loadDocument(ref);
    },
    [loadDocument, setHistory],
  );

  /** The surface for one pane. Spec 16 §4.2 — there are two of them now. */
  const surfaceFor = useCallback(
    (pane: DocumentVersion): DocumentSurface | null =>
      pane === "original" ? originalSurfaceRef.current : surfaceRef.current,
    [],
  );

  const guard = useCallback(async (task: () => Promise<void>): Promise<void> => {
    try {
      await task();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // Spec 28 — filled every render, read at call time. See `findDeps`.
  findDeps.current = {
    surface: surfaceFor,
    pane: readPane,
    documentPath: () => docRef.current?.ref.value ?? null,
    openDocument: (path) => guard(() => openDocument({ kind: "file", value: path })),
  };

  // ── Spec 53 — following a link, and getting back ────────────

  /**
   * §4.3 — one step along the history, in whichever direction.
   *
   * The document is only re-opened when it is not the one already on screen.
   * Walking back and forth inside one file is a scroll, and reloading it would
   * throw away every resolved anchor to land in the same place.
   */
  const travel = useCallback(
    async (step: { history: History; to: DocumentPlace }): Promise<void> => {
      setHistory(step.history);
      if (docRef.current?.ref.value === step.to.path) {
        surfaceRef.current?.scrollToPlace(step.to);
        return;
      }
      arriveWhenReady.current = { path: step.to.path, at: { kind: "place", place: step.to } };
      await loadDocument({ kind: "file", value: step.to.path });
    },
    [loadDocument, setHistory],
  );

  const goBackOne = useCallback((): void => {
    const here = surfaceRef.current?.placeHere();
    if (!here) return;
    const step = goBack(historyRef.current, here);
    if (step) void guard(() => travel(step));
  }, [guard, travel]);

  const goForwardOne = useCallback((): void => {
    const here = surfaceRef.current?.placeHere();
    if (!here) return;
    const step = goForward(historyRef.current, here);
    if (step) void guard(() => travel(step));
  }, [guard, travel]);

  /**
   * §2 — a link the frame caught and stopped.
   *
   * Both panes come here and both name the same file: the original pane is one
   * document's earlier version, not a second document, so `docRef` is the path
   * either of them is written relative to.
   */
  /**
   * §4.7 — the hover tip: where a link goes, before it is clicked.
   *
   * The answer comes from main, so it is cached for the life of the document.
   * A table of contents is twenty links to the same handful of files, and the
   * pointer crosses them all on its way anywhere.
   */
  const onHoverLink = useCallback(
    (pane: DocumentVersion, link: { href: string; rect: ScopeRect } | null): void => {
      if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
      if (!link) {
        setLinkTip(null);
        return;
      }
      const from = docRef.current?.ref.value;
      if (!from) return;
      // A delay, so the pointer crossing a line of prose with three links in it
      // does not flash three tips. Long enough to mean "resting here", short
      // enough that the answer feels like part of the hover.
      tipTimer.current = window.setTimeout(() => {
        void (async () => {
          const cached = tipCache.current.get(link.href);
          const answer = cached ?? (await window.rex.linkResolve(from, link.href));
          tipCache.current.set(link.href, answer);
          setLinkTip({ pane, view: { rect: link.rect, ...describeLink(answer) } });
        })();
      }, LINK_TIP_DELAY);
    },
    [],
  );

  const onFollowLink = useCallback(
    (_pane: DocumentVersion, href: string, line: number | null): void => {
      const from = docRef.current?.ref.value;
      if (!from) return;
      void guard(async () => {
        const answer = await window.rex.linkResolve(from, href);
        switch (answer.kind) {
          case "self":
            // The frame tried this fragment first and nothing here carried it.
            setNotice(
              answer.fragment
                ? `No "#${answer.fragment}" in ${fileNameOf(from)}.`
                : `That link points nowhere.`,
            );
            return;
          case "document": {
            // A link to this same file is a jump, not a journey. Re-opening it
            // would reload the page to land where a scroll already lands.
            if (answer.path === from) {
              if (answer.fragment && !surfaceRef.current?.scrollToFragment(answer.fragment)) {
                setNotice(`No "#${answer.fragment}" in ${fileNameOf(from)}.`);
              }
              return;
            }
            arriveWhenReady.current = answer.fragment
              ? { path: answer.path, at: { kind: "fragment", id: answer.fragment } }
              : null;
            await openDocument({ kind: "file", value: answer.path }, line);
            return;
          }
          case "external":
            await window.rex.linkExternal(answer.url);
            return;
          case "refused":
            setNotice(answer.reason);
            return;
        }
      });
    },
    [guard, openDocument],
  );

  /**
   * Spec 26 §4.5 — put a place on the path bar, and rebuild its chain.
   *
   * The chain is rebuilt from the anchor rather than remembered from when the
   * place was made, for `scopeChainForAnchor`'s own reason: a chain holds live
   * `Element`s, they die when the document re-renders, and a stale one resolves
   * to *somewhere* and looks entirely fine.
   *
   * A place whose document is not open, or whose anchor no longer resolves,
   * gets no chain and therefore no bar (§4.7). That is the honest answer, and
   * the panel row already says it in words.
   *
   * **Every route into the bar comes through here, a fresh commit included.**
   * A `Selected` already carries the chain that produced it, and using that
   * chain looked free — but it is not the chain `anchorFromAnchorScope` indexes
   * into when the reviewer then presses ↑, and for a text drag the two differ
   * in length. Measured on 2026-08-31 by the §7.1 run at step 11: the bar read
   * `document › section › paragraph › [text]`, and one ↑ produced the SECTION
   * rather than the paragraph, because the rebuilt chain had no text scope and
   * index 1 meant something else in it. One chain, built one way.
   */
  const focusPlace = useCallback(
    (item: SelectionItem, threadId: string | null) => {
      void guard(async () => {
        const surface = surfaceFor(item.pane);
        const probed = await surface?.scopesForAnchor(item.anchor, item.kind);
        if (!probed || probed.scopes.length === 0) {
          dropFocus();
          return;
        }
        showChain(item.pane, probed.scopes, probed.active);
        // Spec 26 §4.8 — the ref with the state. A click is followed by `↑`
        // more often than by anything else, and `widenBy` reads the ref.
        const focus: PathFocus = {
          itemId: item.id,
          threadId,
          pane: item.pane,
          base: { anchor: item.anchor, kind: item.kind },
        };
        pathFocusRef.current = focus;
        setPathFocus(focus);
      });
    },
    [dropFocus, guard, showChain, surfaceFor],
  );

  /**
   * Spec 13 §4 — what the overlay knows about itself, measured at the click.
   *
   * `frameChildren` is read here rather than tracked, because the case it
   * exists for is the frame never coming up at all: an empty `<body>` beside a
   * non-zero `documentBytes` is that failure stated. It stays nullable — a
   * frame that has not loaded has no `contentDocument` to count, which is
   * "not measurable", never "empty".
   */
  const viewState = useCallback((): ViewState => {
    const open = docRef.current;
    const list = threadsRef.current;
    const frame = appRef.current?.querySelector<HTMLIFrameElement>("iframe") ?? null;
    const box = frame?.getBoundingClientRect() ?? null;
    let frameChildren: number | null = null;
    try {
      frameChildren = frame?.contentDocument?.body?.childElementCount ?? null;
    } catch {
      frameChildren = null;
    }

    return {
      window: { width: window.innerWidth, height: window.innerHeight },
      workspaceRoot: workspaceRef.current?.root ?? null,
      document: open
        ? {
            documentId: open.documentId,
            value: open.ref.value,
            kind: open.ref.kind,
            title: open.title,
            presentation: open.presentation.kind,
            documentBytes: open.presentation.kind === "html" ? open.presentation.html.length : null,
            contentChanged: open.contentChanged,
            surfaceReady: surfaceRef.current !== null,
            frameChildren,
            frameWidth: box ? Math.round(box.width) : null,
            frameHeight: box ? Math.round(box.height) : null,
          }
        : null,
      centre: centreRef.current,
      sidebarTab: sidebarTabRef.current,
      zoom: zoomRef.current,
      threads: list.length,
      groups: groupsRef.current.length,
      unanswered: list.filter((thread) => thread.messages.length === 0).length,
      activeThreadId: activeIdRef.current,
      traceOpen: traceIdRef.current !== null,
      selectionItems: selectionRef.current.length,
      notice: noticeRef.current,
    };
  }, []);

  const copyDebug = useCallback(
    () =>
      guard(async () => {
        await window.rex.debugSnapshot(viewState());
        setNotice("Debug report copied — paste it to Claude Code.");
      }),
    [guard, viewState],
  );

  const pick = useCallback(
    () =>
      guard(async () => {
        const ref = await window.rex.docPick();
        if (ref) await openDocument(ref);
      }),
    [guard, openDocument],
  );

  /**
   * Spec 05 §5.3 — the panel lists the WORKSPACE's comments, so an open
   * document is not what it needs to have one.
   *
   * The open document only widens the scope: `thread:list` takes it as well as
   * the root so that a single file opened by path still brings its own comments
   * (§5.3, and `scopeOf` in main). With neither, the scope is empty and the
   * empty list is the right answer — which is also what makes `Delete all`
   * clear the panel when nothing is open, instead of leaving dead rows on it.
   */
  const refreshThreads = useCallback(async (): Promise<ThreadWithMessages[]> => {
    // Both, always. The list arrives in the walk order main computed from these
    // very groups (§4.4); fetching one without the other is how a row ends up
    // drawn under a group that is no longer there.
    await refreshGroups();
    const list = await window.rex.threadList(listRequest(docRef.current?.documentId ?? null));
    setThreads(list);
    threadsRef.current = list;
    return list;
  }, [listRequest, refreshGroups]);

  // ── The name, the order and the groups (spec 14) ────────────
  //
  // Every one of these is the same three steps: send the gesture, then reload
  // the list and the groups together. Nothing is predicted locally — main
  // computes every position (§4.2), and a renderer that guessed one would be
  // right until the first time it was not.

  const renameThread = useCallback(
    (threadId: string, title: string | null) =>
      guard(async () => {
        await window.rex.threadRename({ threadId, title });
        await refreshThreads();
      }),
    [guard, refreshThreads],
  );

  const createGroup = useCallback(
    async (parentId: string | null, name: string): Promise<string | null> => {
      const root = workspaceRef.current?.root;
      if (!root) return null;
      try {
        const group = await window.rex.groupCreate({ root, parentId, name });
        await refreshThreads();
        return group.id;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [refreshThreads],
  );

  const updateGroup = useCallback(
    (request: { groupId: string; name?: string; collapsed?: boolean }) =>
      guard(async () => {
        await window.rex.groupUpdate(request);
        await refreshThreads();
      }),
    [guard, refreshThreads],
  );

  const deleteGroup = useCallback(
    (groupId: string) =>
      guard(async () => {
        await window.rex.groupDelete({ groupId });
        await refreshThreads();
      }),
    [guard, refreshThreads],
  );

  const moveComment = useCallback(
    (move: CommentMove) =>
      guard(async () => {
        await window.rex.commentsMove(move);
        await refreshThreads();
      }),
    [guard, refreshThreads],
  );

  // ── Workspace (spec 02) ─────────────────────────────────────

  const openWorkspace = useCallback(
    (ref: WorkspaceRef) =>
      guard(async () => {
        setWorkspace(ref);
        workspaceRef.current = ref;
        setGraph(null);
        setTree(await window.rex.workspaceTree(ref, showSkipped));
        // Spec 14 §5.3 — groups belong to a root, so they change with it, and
        // spec 05 §5.3 — so do the comments. Opening a folder is the moment the
        // panel gets its list: before this it only ever arrived with a document,
        // so a fresh start on a workspace full of comments showed none of them
        // until the reviewer clicked a file. `refreshThreads` fetches the groups
        // too, which is why it replaces the `refreshGroups` that stood here.
        await refreshThreads();
      }),
    [guard, refreshThreads, showSkipped],
  );

  /**
   * Re-scans the tree so comment counts follow what just happened.
   *
   * Read through refs rather than closed over, so this keeps one identity for
   * the life of the app — spec 21 §4.1 calls it from the `apply:ready`
   * listener, and that effect registers IPC subscriptions. An unstable
   * dependency there would tear the listeners down and rebuild them every time
   * the reviewer opened a folder or toggled the skipped rows, and a run whose
   * event landed in the gap would report nothing at all.
   */
  const refreshTree = useCallback(
    () =>
      guard(async () => {
        const current = workspaceRef.current;
        if (current) setTree(await window.rex.workspaceTree(current, showSkippedRef.current));
      }),
    [guard],
  );

  /**
   * Spec 10 §3.4 — one path in or out of the review.
   *
   * The tree is re-scanned rather than patched: the rule main writes depends on
   * the rule already there, so what a path ends up as is main's answer to give.
   * A renderer that predicted it would be right until the first time it was not.
   */
  const setExcluded = useCallback(
    (path: string, exclude: boolean) =>
      guard(async () => {
        const current = workspaceRef.current;
        if (!current) return;
        await window.rex.workspaceExclude({ root: current.root, path, exclude });
        setTree(await window.rex.workspaceTree(current, showSkipped));
        // The graph is a view of the same scan, so it is now stale. Dropping it
        // makes the next visit rebuild; rebuilding it here would pay for a
        // reference walk nobody has asked to look at.
        setGraph(null);
      }),
    [guard, showSkipped],
  );

  const toggleShowSkipped = useCallback(
    () =>
      guard(async () => {
        const next = !showSkipped;
        setShowSkipped(next);
        const current = workspaceRef.current;
        if (current) setTree(await window.rex.workspaceTree(current, next));
      }),
    [guard, showSkipped],
  );

  const pickFolder = useCallback(
    () =>
      guard(async () => {
        const ref = await window.rex.workspacePick();
        if (ref) await openWorkspace(ref);
      }),
    [guard, openWorkspace],
  );

  const showCentre = useCallback(
    (which: Centre) =>
      guard(async () => {
        setCentre(which);
        if (which === "document") {
          await sweep();
          return;
        }
        leavePick();
        leavePen();
        if (which === "graph" && workspace) {
          setGraph(await window.rex.workspaceGraph(workspace));
        }
      }),
    [guard, leavePen, leavePick, sweep, workspace],
  );

  // ── Spec 15 §6 and §7 — the working copy ────────────────────

  /** §7.1 — how many documents are waiting, for `Approve all`. */
  const refreshWorking = useCallback(async (): Promise<void> => {
    setWorking(await window.rex.workList());
  }, []);

  useEffect(() => {
    void refreshWorking();
  }, [refreshWorking]);

  /**
   * §6.1 — the left-hand pane follows the right one.
   *
   * Rendered from the file every time the working copy changes, because that is
   * the only moment it can have: `base` and the file agree until somebody edits
   * the file, and §7.3 is what refuses when they stop agreeing.
   */
  useEffect(() => {
    let live = true;
    const wanted = doc?.working && paneMode !== "new" ? doc.ref : null;
    if (!wanted) {
      setOriginal(null);
      return;
    }
    void window.rex
      .docOpen(wanted, "original")
      .then((opened) => {
        if (live) setOriginal(opened);
      })
      .catch(() => {
        if (live) setOriginal(null);
      });
    return () => {
      live = false;
    };
  }, [doc?.working, doc?.ref, paneMode]);

  /** Every route that changes what is on disk ends here: re-render and re-sweep. */
  const reopenDocument = useCallback(async (): Promise<void> => {
    const current = docRef.current;
    if (!current) return;
    const reopened = await window.rex.docOpen(current.ref);
    surfaceRef.current = null;
    setDoc(reopened);
    await refreshWorking();
  }, [refreshWorking]);

  // ── Spec 23 — the reviewer's own file acts ──────────────────

  /**
   * §5.4 — everything that has to catch up after a file moved or went.
   *
   * `to` is the new path, or null for a delete. The open document is read
   * *before* the tree is re-scanned, because the scan is what removes the row
   * this decision is about.
   *
   * The tree is re-scanned rather than patched, for spec 10 §3.4's reason: what
   * a path ends up as is main's answer to give.
   */
  const afterFileAct = useCallback(
    async (from: string, to: string | null): Promise<void> => {
      const open = docRef.current?.ref.value ?? null;
      // `to ?? from` asks the same question of a delete: was the open document
      // this path, or under it?
      const moved = open === null ? null : movedPath(open, from, to ?? from);

      await refreshTree();
      // A view of the same scan, so it is now stale. Dropping it makes the next
      // visit rebuild, as `setExcluded` does.
      setGraph(null);
      await refreshThreads();
      // §4.1 — a working copy followed its file, so the pending list moved too.
      await refreshWorking();

      if (moved === null) return;
      if (to === null) {
        setDoc(null);
        setNotice(
          "That file is in the Bin. Its comments are kept — put the file back and they return.",
        );
        return;
      }
      try {
        await openDocument({ kind: "file", value: moved });
      } catch {
        // §4.3 — the extension changed to something REX cannot render. The file
        // and its comments are both fine; only the pane cannot stay.
        setDoc(null);
        setNotice(`Renamed. REX cannot open it under that name, so the pane is closed.`);
      }
    },
    [openDocument, refreshThreads, refreshTree, refreshWorking],
  );

  const renameEntry = useCallback(
    (path: string, name: string): void => {
      void guard(async () => {
        const current = workspaceRef.current;
        if (!current) return;
        const answer = await window.rex.workspaceRename({ root: current.root, path, name });
        // §2.2 — a refusal is a sentence to read, not a failure of REX.
        if (!answer.ok) {
          setNotice(answer.reason);
          return;
        }
        await afterFileAct(path, answer.path);
      });
    },
    [afterFileAct, guard],
  );

  const deleteEntry = useCallback(
    (path: string): void => {
      void guard(async () => {
        const current = workspaceRef.current;
        if (!current) return;
        const answer = await window.rex.workspaceDelete({ root: current.root, path });
        if (!answer.ok) {
          setNotice(answer.reason);
          return;
        }
        await afterFileAct(path, null);
      });
    },
    [afterFileAct, guard],
  );

  /**
   * Spec 40 §2 — one row, into one folder.
   *
   * The notice is set BEFORE `afterFileAct`, deliberately. That call has two
   * branches with something more urgent to say — the open document went, or it
   * cannot be opened under its new path — and whichever speaks last is what the
   * reviewer reads.
   */
  const moveEntry = useCallback(
    (path: string, parent: string): void => {
      void guard(async () => {
        const current = workspaceRef.current;
        if (!current) return;
        const answer = await window.rex.workspaceMove({ root: current.root, path, parent });
        if (!answer.ok) {
          setNotice(answer.reason);
          return;
        }
        // §3.1 — a drop into the folder it is already in answers ok and moved
        // nothing. Nothing has to catch up, and "Moved" would be a lie.
        if (answer.path === path) return;

        // §3.3 — no confirm, so the notice is what makes an unmeant drag
        // legible: it names both ends, at the moment it happens.
        const what = path.split("/").pop() ?? path;
        const where =
          parent === current.root ? "the workspace root" : `"${parent.split("/").pop() ?? parent}"`;
        setNotice(`Moved "${what}" into ${where}.`);
        await afterFileAct(path, answer.path);
      });
    },
    [afterFileAct, guard],
  );

  /**
   * Spec 39 §5.3 — the empty path, and what follows it landing.
   *
   * Not `afterFileAct`: nothing moved and nothing went, so the open document,
   * the threads and the pending copies are all exactly as they were. The tree
   * is re-scanned and the graph dropped, and that is the whole catch-up.
   */
  const createEntry = useCallback(
    (parent: string, name: string, kind: "file" | "directory"): void => {
      void guard(async () => {
        const current = workspaceRef.current;
        if (!current) return;
        const answer = await window.rex.workspaceCreate({ root: current.root, parent, name, kind });
        if (!answer.ok) {
          setNotice(answer.reason);
          return;
        }

        await refreshTree();
        // A view of the same scan, so it is now stale — `setExcluded`'s reason.
        setGraph(null);

        // §5.3 — a new empty document nobody opens is a create the reviewer has
        // to follow with a click. A folder, and a file REX cannot render, are
        // both left where they are, and the second says so.
        if (answer.opens) await openDocument({ kind: "file", value: answer.path });
        const created = answer.opens
          ? "Created."
          : kind === "directory"
            ? "Folder created."
            : "Created. REX cannot open that kind of file, so it is only listed.";
        setNotice(answer.note === null ? created : `${created} ${answer.note}`);
      });
    },
    [guard, openDocument, refreshTree],
  );

  const approveWorking = useCallback(
    (documentId: string) =>
      guard(async () => {
        const answer = await window.rex.workApprove(documentId);
        if (!answer.ok) {
          // §7.3 — the file moved under the copy. Nothing was written, and the
          // reviewer is told in the same sentence why and what to do.
          setNotice(answer.reason);
          await refreshWorking();
          return;
        }
        await reopenDocument();
        const summary = answer.reanchored;
        setNotice(
          summary
            ? `Approved. ${summary.ok} anchor(s) still exact, ${summary.moved} moved, ${summary.orphaned} orphaned.`
            : "Approved.",
        );
      }),
    [guard, refreshWorking, reopenDocument],
  );

  /** §7.1 — every waiting document, in turn, and one report at the end. */
  const approveAllWorking = useCallback(
    () =>
      guard(async () => {
        const all = await window.rex.workList();
        // Spec 15 §7.3 and spec 34 §5.2 — each refusal carries its own reason:
        // the file moved on disk, or an agent is working on it. Both are named.
        const refused: string[] = [];
        for (const copy of all) {
          const answer = await window.rex.workApprove(copy.documentId);
          if (!answer.ok) refused.push(`${copy.name} — ${answer.reason ?? "refused"}`);
        }
        await reopenDocument();
        setNotice(
          refused.length === 0
            ? `Approved ${all.length} document(s).`
            : `Approved ${all.length - refused.length} of ${all.length}. Left alone: ${refused.join("; ")}`,
        );
      }),
    [guard, reopenDocument],
  );

  const discardWorking = useCallback(
    (documentId: string) =>
      guard(async () => {
        const answer = await window.rex.workDiscard(documentId);
        // Spec 34 §5.2 — refused while a run holds the copy. Said in the same
        // words the greyed button carries, for the reviewer who got past it.
        if (!answer.ok) {
          setNotice(answer.reason ?? "Discard was refused.");
          return;
        }
        await reopenDocument();
        setNotice("Discarded. Your file was never changed.");
      }),
    [guard, reopenDocument],
  );

  const undoWorking = useCallback(
    (documentId: string) =>
      guard(async () => {
        const answer = await window.rex.workUndo(documentId);
        if (!answer.ok) {
          setNotice(answer.reason ?? "Undo was refused.");
          return;
        }
        await reopenDocument();
      }),
    [guard, reopenDocument],
  );

  // ── §8.7 step 6 — main drives the post-Apply sweep through here ──

  useEffect(() => {
    window.__rexReanchor = async (changedDocumentIds: string[]): Promise<AnchorSummary> => {
      const current = docRef.current;
      if (!current) return NO_SUMMARY;

      const list = await window.rex.threadList(listRequest(current.documentId));
      threadsRef.current = list;
      setThreads(list);

      // Nothing on screen changed, so there is nothing to re-render; the sweep
      // still runs, because the thread list it resolves against just moved.
      if (!changedDocumentIds.includes(current.documentId)) return await sweep();

      // The file changed underneath, so re-render it before re-resolving.
      const reopened = await window.rex.docOpen(current.ref);
      const waited = new Promise<AnchorSummary>((done) => {
        sweepWaiter.current = done;
      });
      surfaceRef.current = null;
      setDoc(reopened);
      return waited;
    };
    return () => {
      window.__rexReanchor = undefined;
    };
  }, [listRequest, sweep]);

  // `rex <path>` — open what the command line named, once. A directory is a
  // workspace, a file is a single document (spec 02 §7).
  useEffect(() => {
    void (async () => {
      const target = await window.rex.docInitial();
      if (!target) return;
      if (target.kind === "workspace") await openWorkspace(target.ref);
      else await guard(() => openDocument(target.ref));
    })();
  }, [guard, openDocument, openWorkspace]);

  // ── Streams from main ───────────────────────────────────────

  useEffect(() => {
    const offStep = window.rex.onStreamStep((message: Message) => {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === message.threadId
            ? { ...thread, messages: [...thread.messages, message] }
            : thread,
        ),
      );
    });

    // Spec 11 §7.4.2 and §7.4.5 — main holds the deck and can draw neither a
    // Mermaid diagram nor a video's poster frame: one needs a live layout to
    // measure text with, the other needs a decoder and a canvas. Both are here.
    // So main asks, and this answers with a PNG.
    const offRender = window.rex.onRenderRequest((request) => {
      const draw = async (): Promise<{ png: Uint8Array; durationSeconds?: number }> =>
        request.kind === "poster"
          ? await posterFramePng(request.source)
          : { png: await drawDiagramPng(request.source) };

      void draw()
        .then((drawn) =>
          window.rex.renderResult({
            id: request.id,
            pngBase64: btoa(String.fromCharCode(...drawn.png)),
            error: null,
            ...(drawn.durationSeconds === undefined
              ? {}
              : { durationSeconds: drawn.durationSeconds }),
          }),
        )
        .catch((error: unknown) =>
          // The Apply run fails with this sentence rather than inserting an
          // empty box, because a picture nobody can read is worse than a
          // refusal a reviewer can act on.
          window.rex.renderResult({
            id: request.id,
            pngBase64: null,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    });

    // Spec 15 §7.4 — the run is over and its change is in a working copy. The
    // document on screen is re-rendered from that copy if it is one of the ones
    // that changed, so the reviewer reads the new version beside the old.
    const offApply = window.rex.onApplyReady((event) => {
      // §7.4 — a run that produced a working copy has already said everything
      // this bar used to say, in the head of the pane the change is in. Keeping
      // both would put two answers on screen, and the bar's are now wrong: it
      // offers OK and Undo, and neither exists any more.
      //
      // A deck run still has it, because spec 11 §7.7's pipeline is untouched
      // and is still accepted through `apply:confirm`.
      //
      // Spec 17 §3.4 — and a stopped run has said everything too, in the
      // STOPPED block the reviewer's own press produced. "This document was not
      // changed" under it is REX reporting the absence of a result nobody was
      // waiting for any more.
      //
      // Spec 21 §4.2 — so has a run that created a file. It makes no working
      // copy, so this bar used to open behind the created-file notice and say
      // "The agent changed no files" under a sentence naming the file it wrote.
      // Both were true and together they read as a contradiction; the notice is
      // the one that tells the reviewer something.
      //
      // Spec 21 §13 — and so has a run that wrote into REX's store. It changed
      // no working copy, so this bar would open under a notice naming the file
      // and say "The agent changed no files" — true, and the least useful of the
      // two sentences on screen.
      const notice =
        event.working.length === 0 &&
        !event.stopped &&
        event.created.length === 0 &&
        event.misplaced.length === 0
          ? event
          : null;
      setPendingApply(notice);
      pendingApplyRef.current = notice;
      // Before anything is re-rendered or re-swept — see the ref's own note.
      orphansBeforeApply.current = new Set(
        resolvedRef.current.filter((e) => e.state === "orphaned").map((e) => e.threadId),
      );
      // §4.3 and spec 21 §4.2 — what the run did outside its own list. Never
      // silent, in either direction: a document nobody commented on is not part
      // of a review, and a file that now exists is one the reviewer must be
      // told about.
      const said: string[] = [];
      if (event.restored.length > 0) {
        said.push(
          `The agent also changed ${event.restored.join(", ")}. REX put ${
            event.restored.length === 1 ? "it" : "them"
          } back — a change outside this comment's documents cannot be reviewed here.` +
            // Spec 21 §4.3 — the bytes have always been kept and the reviewer
            // was never told where, so a put-back read as a deletion.
            (event.restoredDir ? ` What it wrote is in ${event.restoredDir}.` : ""),
        );
      }
      if (event.created.length > 0) {
        said.push(
          `The agent created ${event.created.join(", ")}. ${
            event.created.length === 1 ? "It is" : "They are"
          } in your workspace now.`,
        );
      }
      // Spec 22 §5.1 — edited under the workspace root and held, not put back.
      // The file on disk is unchanged and the agent's version is a working
      // copy like the anchored document's. Said, because from the reviewer's
      // side a run that changed a file they did not comment on and reported
      // nothing about it is spec 22 §1.1's 08:43 with the roles reversed.
      if (event.changed.length > 0) {
        const one = event.changed.length === 1;
        said.push(
          `The agent changed ${event.changed.join(", ")}. REX holds ${
            one ? "it" : "them"
          } as a new version beside the original — open ${one ? "it" : "them"} to review and approve.`,
        );
      }
      // Spec 21 §13 — the silent case. REX will not move these and will not
      // delete them: `base` lives in that directory, and guessing where a file
      // was meant to go is how the wrong file gets overwritten. So it says
      // where they are, in full, and the reviewer decides.
      if (event.misplaced.length > 0) {
        said.push(
          `The agent wrote ${event.misplaced.join(", ")} into REX's own store, not into your workspace. ${
            event.misplaced.length === 1 ? "It is" : "They are"
          } not in your file tree. Move ${
            event.misplaced.length === 1 ? "it" : "them"
          } where you want ${event.misplaced.length === 1 ? "it" : "them"}, or ask again and name the path.`,
        );
      }
      if (said.length > 0) setNotice(said.join(" "));
      // Spec 21 §4.1 — the file is on disk, so the sidebar has to agree. Without
      // this the row appears only after the reviewer reloads the tree by hand,
      // which reads exactly like the file not being there.
      if (event.created.length > 0) void refreshTree();
      void refreshWorking();
      const current = docRef.current;
      const path = current?.ref.value ?? null;
      if (!current || !path || !event.files.includes(path)) {
        void refreshChangeBoxes();
        return;
      }
      // Both panes come back, because the reviewer is now comparing.
      setPaneMode("both");
      void guard(async () => {
        const reopened = await window.rex.docOpen(current.ref);
        surfaceRef.current = null;
        setDoc(reopened);
      });
    });

    return () => {
      offStep();
      offApply();
      offRender();
    };
  }, [guard, refreshChangeBoxes, refreshTree, refreshWorking]);

  // ── Commands ────────────────────────────────────────────────

  /**
   * Read through a ref rather than closed over, so this callback keeps one
   * identity for the life of the app.
   *
   * DocumentView's tier 1 effect depends on it: give it a new identity and the
   * effect re-runs, which rewrites the iframe's `srcdoc` — reloading the
   * document under review, throwing away its scroll position and the scope
   * chain the panel's chips point into. Arming a region did exactly that, so
   * the drag that followed had nothing left to cut from.
   */
  const armingRef = useRef(false);
  armingRef.current = arming;

  /** One `Selected` as the panel stores it. */
  const itemFor = useCallback(
    (next: Selected, current: OpenedDocument, pane: DocumentVersion): SelectionItem => {
      return newSelectionItem({
        kind: next.scopes[next.active]?.kind ?? "text",
        documentId: current.documentId,
        // Spec 16 §4 — which pane it was taken from, so its outline is drawn
        // where it was measured and its box is re-found there on every sweep.
        pane,
        documentRef: current.ref,
        documentName: nameOf(current.ref),
        anchor: next.anchor,
        label: next.label,
        rect: next.rect,
        lines: next.lines,
        zoom: zoomRef.current,
      });
    },
    [],
  );

  /**
   * Spec 24 §3.1 — where a selection lands: the open comment when its card is
   * on screen, the panel otherwise. Every gesture that makes a place comes
   * through here, so the rule is written once.
   *
   * The comment's own places count as taken (§3.1): pointing at place 2 again
   * is refused the way picking the same cell twice is.
   */
  /**
   * Spec 26 §4.2 — it reports which list it wrote to and which place survived
   * the three rules, because the path bar has to take that place.
   *
   * The decision is made against the refs and then applied, rather than made
   * inside the state updater: a caller needs the answer now, and the two
   * cannot disagree — every ref is assigned during render, so both read the
   * same list this handler was fired against.
   *
   * Null when nothing landed. That is a duplicate being refused silently, and
   * the bar must not then point at a row that is not there.
   */
  const place = useCallback(
    (items: SelectionItem[]): { item: SelectionItem; threadId: string | null } | null => {
      const card = cardOnScreen();
      const before = card ? (pendingRef.current.get(card.id) ?? []) : selectionRef.current;
      const taken = card ? card.targets : [];
      const after = items.reduce((list, item) => addSelectionItem(list, item, taken), before);

      if (card) {
        setPendingByThread((map) => {
          const next = new Map(map);
          next.set(card.id, after);
          return next;
        });
      } else {
        setSelection(after);
      }

      // The last one asked for, if the rules kept it. An extended drag REPLACES
      // the newest row with this one, so its id is in `after` either way; a
      // duplicate is not, and that is the case this test exists for.
      const last = items.at(-1);
      return last && after.some((one) => one.id === last.id)
        ? { item: last, threadId: card?.id ?? null }
        : null;
    },
    [cardOnScreen],
  );

  /**
   * §3.1 — everything selected is added. The three rules live in selection.ts.
   *
   * Spec 26 §4.2 — and the place it made goes on the path bar, so ↑ widens the
   * thing that was just taken rather than adding a second row beside it. The
   * chain is the one the commit already built: every `Selected` carries the
   * chain that produced it, so this costs no second pass over the DOM.
   */
  const addSelected = useCallback(
    (next: Selected, pane: DocumentVersion): void => {
      const current = docRef.current;
      if (!current) return;
      const landed = place([itemFor(next, current, pane)]);
      if (landed) focusPlace(landed.item, landed.threadId);
    },
    [focusPlace, itemFor, place],
  );

  /**
   * Spec 06 §4.3 — a whole file, from the tree, without opening it.
   *
   * `doc:open` is what registers a file and hands back its id, and it is used
   * here for exactly that and nothing else: the pane is left showing whatever
   * the reviewer was reading. Rendering it is the price of a real `documentId`
   * and a real title, and it is the same work opening it would have done.
   *
   * The anchor is `createDocumentAnchor()` — all four layers null. §4.5 calls
   * it the one anchor that cannot move, so it needs no rect, draws no outline
   * (§6.4) and resolves in any document that still opens.
   */
  /**
   * One whole-file place, for either route into it.
   *
   * `shownAs` overrides the row's name and exists for the folder route alone.
   * Spec 05 §3.5 says the panel shows the file name and never the whole path,
   * and for a file the reviewer picked by hand that is right — they know which
   * one they clicked. A folder adds forty at once, and a repository where four
   * of them are called `README.md` gives four identical rows with nothing to
   * tell them apart. The path relative to the chosen folder is the shortest
   * string that still names one file.
   *
   * Display only. `documentName` never leaves the renderer: main builds
   * `thread.documentNames` itself from the `document` rows.
   */
  const wholeFileItem = useCallback(
    (path: string, documentId: string, shownAs?: string): SelectionItem => {
      const ref: DocumentRef = { kind: "file", value: path };
      return newSelectionItem({
        kind: "element",
        documentId,
        // The file itself, not a version of it — §4.5 of spec 06 calls this the
        // one anchor that cannot move, and it resolves in whichever pane is on
        // screen.
        pane: "current",
        documentRef: ref,
        documentName: shownAs ?? nameOf(ref),
        anchor: createDocumentAnchor(),
        label: "The whole document",
        rect: null,
        lines: null,
        zoom: zoomRef.current,
      });
    },
    [],
  );

  const selectWholeFile = useCallback(
    (path: string): void => {
      void guard(async () => {
        const opened = await window.rex.docOpen({ kind: "file", value: path });
        // Spec 24 §3.1 — a whole file joins the open comment when its card is
        // on screen, like any other place. Decided before the row is made, so
        // the tab only moves when the row went to the panel.
        const toCard = cardOnScreen() !== null;
        place([wholeFileItem(path, opened.documentId)]);
        // The panel is where the row landed, so that is where to look.
        if (!toCard) setSidebarTab("composer");
      });
    },
    [cardOnScreen, guard, place, wholeFileItem],
  );

  /**
   * Spec 06 §4.3 — every document under one folder, as whole-file places.
   *
   * The same act as `selectWholeFile`, repeated: "is this folder consistent?"
   * and "does this whole section still match what we shipped?" are questions
   * about a set of files, and there was no way to ask one without right-clicking
   * each file in turn.
   *
   * `Explorer` decides WHICH files, because it is the only side that holds the
   * tree — it walks the subtree in the order it draws, skips what REX cannot
   * render, and skips an excluded subtree for free (the scan never walked it).
   * The order matters beyond looks: `targets[0]` is what Apply's prompt leads
   * with, so it has to be the order the reviewer can see.
   *
   * One `place()` call at the end, never one per file. `place` reads the current
   * list from a ref that only moves when React re-renders, so a call per file in
   * this loop would read a stale list and silently drop rows.
   *
   * Each file is opened on its own and a failure is kept rather than thrown: one
   * unreadable file in a folder of forty must not lose the thirty-nine that
   * worked, and the reviewer has to be told the count is short.
   */
  const selectWholeFolder = useCallback(
    (folder: string, paths: string[]): void => {
      void guard(async () => {
        if (paths.length === 0) return;
        const folderName = folder.split("/").pop() ?? folder;
        const many = paths.length > FOLDER_SELECT_CONFIRM;
        if (many) {
          const proceed = window.confirm(
            `Add ${paths.length} files from "${folderName}" to the selection?\nEach one is opened and rendered, so this can take a moment.`,
          );
          if (!proceed) return;
          setNotice(`Opening ${paths.length} files from "${folderName}"…`);
        }

        const items: SelectionItem[] = [];
        let failed = 0;
        for (const path of paths) {
          try {
            const opened = await window.rex.docOpen({ kind: "file", value: path });
            // The prefix carries the separator, so a sibling `docs-old/` is
            // never read as living inside `docs/` — the same test `movedPath`
            // makes, in a second place.
            const inside = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
            items.push(wholeFileItem(path, opened.documentId, inside));
          } catch (error) {
            failed += 1;
            console.warn("[rex] could not open", path, error);
          }
        }

        if (items.length === 0) {
          setNotice(`None of the ${paths.length} files in "${folderName}" could be opened.`);
          return;
        }
        const toCard = cardOnScreen() !== null;
        place(items);
        // Silence when every file landed: the rows themselves are the report,
        // and a progress line left on screen reads as an unfinished job. The
        // count named is what FAILED, never what was added — `place` refuses a
        // file the panel already holds, so "added 40" would be a number the
        // reviewer can see is wrong.
        setNotice(
          failed === 0
            ? null
            : `${failed} of the ${paths.length} files in "${folderName}" could not be opened — see the console.`,
        );
        if (!toCard) setSidebarTab("composer");
      });
    },
    [cardOnScreen, guard, place, wholeFileItem],
  );

  /**
   * Spec 06 §5.3 and §6.2 — a finished drawing fills the panel.
   *
   * It adds its places the same way a click does, through the same three rules,
   * so everything spec 05 provides comes free: reorder the rows, drop one that
   * was caught by accident, widen one with the chips, add a sixth by clicking.
   * A drawing is a fast way to fill the panel, not a second way to make a
   * comment.
   *
   * **The drawing itself is not kept.** It is a gesture, not a record: once it
   * has named the places, the places are the comment and the ink has nothing
   * left to say. Leaving it on the paper covered the prose it was drawn around,
   * and a comment carrying *how* it was selected told the agent nothing the
   * targets did not already say. Reported on 2026-08-26.
   */
  const finishDrawing = useCallback(
    (pane: DocumentVersion, strokes: Stroke[]): void => {
      void guard(async () => {
        const surface = pane === "original" ? originalSurfaceRef.current : surfaceRef.current;
        const current = docRef.current;
        setPenning(false);
        if (!surface || !current) return;

        // Spec 16 §5.5 — in the new version a drawing that crosses one changed
        // block and two unchanged ones makes a comment about the changed one
        // only. The surface filters; nothing here knows the rule.
        const found = await surface.targetsFromDrawing(strokes, zoomRef.current);
        if (found.targets.length === 0) return;

        const added = found.targets.map((one) => itemFor(one, current, pane));

        // Spec 16 §4 — BOTH panes can finish on one keypress: a drawing in each,
        // and `enter` commits both. The two calls land here in the same tick, so
        // a list built from `selectionRef` — which only catches up on the next
        // render — drops whichever pane got here first. Measured on 2026-08-26:
        // the left pane's circle silently ate the right pane's. `place` uses
        // the updater, which is the only thing that sees the list as it really
        // is; the ref is left to the render that follows.
        place(added);
      });
    },
    [guard, itemFor, place],
  );

  const onSelectionChanged = useCallback(
    async (pane: DocumentVersion) => {
      const surface = pane === "original" ? originalSurfaceRef.current : surfaceRef.current;
      if (!surface || armingRef.current) return;
      // Spec 16 §4.1 — in the new version a selection outside every live block
      // returns null and nothing happens: no panel, no notice, no refusal to
      // dismiss. The surface is where that rule lives.
      const next = await surface.selectionMade();
      // A click with nothing selected adds nothing — and, unlike the composer it
      // replaces, takes nothing away either (§4, fault 3).
      if (next) addSelected(next, pane);
    },
    [addSelected],
  );

  /**
   * Remove a comment for good. Shared by the card's header and the list's rows,
   * because "delete this comment" must mean exactly one thing wherever it is
   * asked for — including what it tidies up afterwards.
   *
   * The confirm belongs to the caller, next to the control the reviewer
   * pressed; by the time this runs the decision is made.
   */
  const removeThread = useCallback(
    (threadId: string): void => {
      void guard(async () => {
        await window.rex.threadDelete(threadId);
        // Whatever was showing this comment is now showing one that does not
        // exist, and the trace sheet belongs to a single comment.
        setActiveId((current) => (current === threadId ? null : current));
        setTraceId((current) => (current === threadId ? null : current));
        await refreshThreads();
        // The tree carries per-file comment counts, and one of them just moved.
        await refreshTree();
      });
    },
    [guard, refreshThreads, refreshTree],
  );

  /**
   * Start over: every comment in the workspace, gone.
   *
   * The scope is `listRequest` — the very object `refreshThreads` sends — so
   * what goes is what the Comments tab was counting. Building a second one here
   * would be a second answer to "which comments are these", and the two would
   * drift the first time either changed.
   *
   * The confirm belongs to the menu that was pressed, as it does for one
   * comment. Folders survive; main's `deleteThreadsInScope` says why.
   */
  const removeAllThreads = useCallback((): void => {
    void guard(async () => {
      await window.rex.threadDeleteAll(listRequest(docRef.current?.documentId ?? null));
      // Both were showing a comment that no longer exists.
      setActiveId(null);
      setTraceId(null);
      await refreshThreads();
      // The tree carries per-file comment counts, and every one of them is 0.
      await refreshTree();
    });
  }, [guard, listRequest, refreshThreads, refreshTree]);

  const withBusy = useCallback(
    async (threadId: string, task: () => Promise<void>): Promise<void> => {
      setBusyThreads((current) => [...current, threadId]);
      try {
        // Spec 34 §5.3 — a run holds its documents from the moment it starts,
        // and `held` rides on the pending list, so the list is re-read here
        // and the three buttons grey out while the agent is still thinking.
        // Fired and not awaited: the run must not wait on a paint.
        void refreshWorking();
        await task();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyThreads((current) => current.filter((id) => id !== threadId));
        // Spec 17 §3.3 — the run is over however it ended, so the stopping
        // state goes with the busy one. Leaving it behind would grey out the
        // button on the comment's NEXT run.
        setStoppingThreads((current) => current.filter((id) => id !== threadId));
        await refreshThreads();
        await refreshTree();
        // And the hold is released, so the buttons come back.
        await refreshWorking();
      }
    },
    [refreshThreads, refreshTree, refreshWorking],
  );

  /**
   * End a comment, or put it back.
   *
   * One callback for both surfaces — the open card's button and the list row's
   * tick. They are the same act on the same thread, and two copies of it would
   * be two places for the busy handling and the refresh to drift apart.
   */
  const resolveThread = useCallback(
    (threadId: string, resolved: boolean): void => {
      void withBusy(threadId, async () => {
        await window.rex.threadResolve({ threadId, resolved });
      });
    },
    [withBusy],
  );

  /**
   * Spec 17 §2.1 — end this comment's running work.
   *
   * `busy` is deliberately not cleared here. The run has not stopped yet — the
   * SDK closes the agent's stdin and gives it about two seconds — and the
   * invoke that started it is still open. It clears where it always did, in
   * `withBusy`'s `finally`, when the run actually ends.
   */
  const stopThread = useCallback(
    (threadId: string): void => {
      setStoppingThreads((current) => [...current, threadId]);
      void guard(async () => {
        const stopped = await window.rex.threadStop(threadId);
        // §3.1 — zero means it finished between the paint and the click. Said
        // out loud, because a button that appears to do nothing reads as broken.
        if (stopped === 0) setNotice("That run had already finished.");
      });
    },
    [guard],
  );

  /** §3.4 — one thread, every item as a target, in panel order. */
  const askAboutSelection = useCallback((): void => {
    void guard(async () => {
      const items = selection;
      const note = selectionNote.trim();
      if (items.length === 0 || note.length === 0) return;

      const mode = selectionMode;
      const targets = items.map((item) => ({ documentId: item.documentId, anchor: item.anchor }));

      /*
        Spec 30 §3.2 — a draft is PROMOTED, never duplicated.

        Sending a draft has to end with one comment, not with a draft plus the
        comment it became. So an existing draft has its places and question
        written back and then moves lane; only a composer that was never left
        creates a row here.

        `thread:note` does the same promotion on main's side for NOTE, which is
        why nothing below has to special-case it: `markThreadNoted` moves a
        draft, and `markThreadSent` moves one for ASK and ACT.
      */
      const editing = draftIdRef.current;
      // Born in the lane the mode names. NOTE lands in `note` and stops; ASK and
      // ACT land in `open`, because the send is a few lines below and cannot
      // fail in between.
      const status = mode === "note" ? "note" : "open";
      const title = selectionTitleRef.current.trim() || null;
      const thread = editing
        ? await window.rex.threadDraftSave({ threadId: editing, targets, note, status, title })
        : await window.rex.threadCreate({ targets, note, status, title });
      setDraftId(null);

      setSelection([]);
      setSelectionNote("");
      // §3.6 — the name went with the comment, so the composer starts empty for
      // the next one. Left behind it would name the following comment too.
      setSelectionTitle("");
      setExpandedItemId(null);
      dropFocus();
      // §3.4 — the panel is empty, so nothing in REX is about that passage any
      // more. The browser's own selection is not the panel's and does not go
      // with it, so it is dropped by hand or the text stays blue in the
      // document with nothing left pointing at it.
      surfaceRef.current?.clearTextSelection();
      originalSurfaceRef.current?.clearTextSelection();
      leavePick();
      leavePen();

      await refreshThreads();
      await sweep();
      setActiveId(thread.id);

      // Spec 12 §3.2 and §4 — the panel's mode becomes the new thread's mode,
      // and decides which channel this first send reaches. ACT here is the flow
      // §1.3 says was missing: a reviewer who already knows what they want does
      // not have to ask a question first.
      setMode(thread.id, mode);
      // Spec 25 §7.1 — and the panel's model, the same way. A reviewer who
      // escalated the panel to Fable meant this comment, so the comment it
      // creates keeps the pick.
      setModel(thread.id, selectionModel);
      // Spec 31 §2.2 — and the panel's style, which the first send then writes
      // to the comment so it is still there tomorrow.
      setStyle(thread.id, selectionStyle);
      // Spec 43 §4 — and the panel's gateway, for the same reason: a reviewer
      // who pointed the panel at LiteLLM meant this comment. Spec 44 §3 — and
      // its agent, which is the same rule one control further left.
      setGateway(thread.id, panelGateway);
      setSdkByThread((current) => ({ ...current, [thread.id]: panelSdk }));

      // NOTE stops here, and that is the whole feature: the comment is written
      // down, nothing runs, nothing is spent. No `withBusy` either — there is
      // no work to be busy with, and a spinner over an instant save is a lie.
      if (mode === "note") return;

      // Spec 43 §2.1 — all four, as the panel had them. The comment did not
      // exist a moment ago, so there is nothing it "last used" to fall back to.
      const choices: SendChoices = {
        sdk: panelSdk,
        gatewayId: panelGateway,
        model: selectionModel ?? choicesFor(panelSdk, panelGateway).chosen,
        style: stylesFor(panelSdk) ? selectionStyle : null,
      };
      await withBusy(thread.id, async () => {
        // Spec 21 §3 — the open workspace, so a file the agent creates can be
        // scoped to somewhere the reviewer will actually see it.
        if (mode === "act")
          await window.rex.threadApply({
            threadId: thread.id,
            note,
            root: workspaceRef.current?.root ?? null,
            ...choices,
          });
        else await window.rex.threadAsk({ threadId: thread.id, ...choices });
      });
    });
  }, [
    guard,
    leavePen,
    leavePick,
    modelList,
    refreshThreads,
    selection,
    selectionMode,
    selectionModel,
    selectionStyle,
    selectionNote,
    sweep,
    withBusy,
  ]);

  /**
   * Drop one place, wherever it is waiting — the panel, or an open comment's
   * strip. One function, because the outline's own trash button (`PaneMarks`)
   * knows only the id, and a place is drawn the same way from either list.
   */
  const removeItem = useCallback((id: string): void => {
    setSelection((items) => {
      if (!items.some((item) => item.id === id)) return items;
      const next = items.filter((item) => item.id !== id);
      // §3.4 — a note with nothing to attach it to is not a thing REX has a
      // place for, and keeping it invisibly to reappear later is worse.
      if (next.length === 0) setSelectionNote("");
      return next;
    });
    setPendingByThread((map) => {
      let changed = false;
      const next = new Map<string, SelectionItem[]>();
      for (const [threadId, list] of map) {
        const kept = list.filter((item) => item.id !== id);
        if (kept.length !== list.length) changed = true;
        // Spec 24 §3.2 — removing the last one removes the strip.
        if (kept.length > 0) next.set(threadId, kept);
      }
      return changed ? next : map;
    });
    setExpandedItemId((current) => (current === id ? null : current));
  }, []);

  // ── Spec 24 — places waiting on an open comment ──────────────

  /** The pending list, gone. After a send that took them, or `new comment ›`. */
  const clearPending = useCallback((threadId: string): void => {
    setPendingByThread((map) => {
      if (!map.has(threadId)) return map;
      const next = new Map(map);
      next.delete(threadId);
      return next;
    });
  }, []);

  /** Spec 24 §3.2 — the strip's rows reorder like the panel's. */
  const movePending = useCallback((threadId: string, from: number, to: number): void => {
    setPendingByThread((map) => {
      const list = map.get(threadId);
      if (!list) return map;
      const next = new Map(map);
      next.set(threadId, moveSelectionItem(list, from, to));
      return next;
    });
  }, []);

  /**
   * Spec 24 §3.2 — `new comment ›`: the one escape hatch for a reviewer who
   * meant to start comment 5 after all. The places move to the panel, where
   * they number from 1, and the tab follows them.
   */
  const pendingToNewComment = useCallback(
    (threadId: string): void => {
      const items = pendingRef.current.get(threadId) ?? [];
      if (items.length === 0) return;
      clearPending(threadId);
      setSelection((list) => items.reduce((acc, item) => addSelectionItem(acc, item), list));
      setSidebarTab("composer");
    },
    [clearPending],
  );

  const clearSelection = useCallback((): void => {
    setSelection([]);
    setSelectionNote("");
    // Spec 30 §3.6 — `Clear` empties the composer, and the name is part of it.
    setSelectionTitle("");
    setExpandedItemId(null);
    dropFocus();
    // The same reason as Ask's — see the note there. Both panes: the browser's
    // selection belongs to whichever frame it was dragged in.
    surfaceRef.current?.clearTextSelection();
    originalSurfaceRef.current?.clearTextSelection();
  }, []);

  /**
   * Spec 30 §3.1 — the `＋` button: the composer's second door.
   *
   * It does NOT clear a standing draft. While one is being built the button
   * reads as "back to what you were writing" (§3.3), and throwing the places
   * away would make the way back the one gesture that destroys them. `Clear` is
   * still the only thing that empties the panel — spec 05 §3.2, unchanged.
   */
  const openComposer = useCallback((): void => {
    setActiveId(null);
    setTraceId(null);
    setSidebarTab("composer");
  }, []);

  /**
   * Spec 30 §3.2 — the back arrow, and the whole of its rule.
   *
   * The gesture carries the decision and there is no dialog either way:
   *
   * - **No places** — nothing is saved, and any draft being edited is deleted.
   *   §2.4: a comment with no places has no document either, so there is no row
   *   to write. That is `ipc.ts`'s oldest refusal, not a rule invented here.
   * - **One or more** — saved as a draft. An existing draft is UPDATED, which is
   *   what `draftId` is for: a draft edited five times is one comment.
   *
   * The lane moves to `draft` on a save (§3.3) so the row the reviewer just made
   * is on screen rather than behind a pill they did not press.
   */
  const leaveComposer = useCallback((): void => {
    const items = selectionRef.current;
    const editing = draftIdRef.current;
    const note = selectionNoteRef.current.trim();

    void guard(async () => {
      if (items.length === 0) {
        // A draft the reviewer emptied is a draft they threw away. `Clear` did
        // not delete it, because `Clear` does not know it is being left.
        if (editing) {
          await window.rex.threadDelete(editing);
          await refreshThreads();
        }
      } else {
        const targets = items.map((item) => ({
          documentId: item.documentId,
          anchor: item.anchor,
        }));
        // §3.6 — the name goes with the places. A draft the reviewer named and
        // walked away from comes back named.
        const title = selectionTitleRef.current.trim() || null;
        if (editing) {
          await window.rex.threadDraftSave({ threadId: editing, targets, note, title });
        } else {
          await window.rex.threadCreate({ targets, note, status: "draft", title });
        }
        await refreshThreads();
        await sweep();
        setLane("draft");
      }

      setDraftId(null);
      clearSelection();
      setSidebarTab("list");
    });
  }, [guard, refreshThreads, sweep, clearSelection]);

  /**
   * Spec 30 §3.2 — reopening a draft puts its places back in the composer.
   *
   * Every field a `SelectionItem` carries that a stored target does not is
   * rebuilt rather than invented:
   *
   * - `kind` — from the anchor's own shape. A pure text anchor has a quote and
   *   no element; everything else was picked as a thing on the page. `create.ts`
   *   gives both the same fields, which is why `SelectionItem` carried it in the
   *   first place (spec 05 §3.5).
   * - `rect` — **null, and it must be**. Spec 05 §3.5: a box measured against an
   *   older render points at whatever has moved into it since. The sweep that
   *   runs on the next line re-measures every one of them.
   * - `label` — what the last sweep found this place to be, falling back to the
   *   anchor's own quote.
   */
  const openDraft = useCallback(
    (thread: ThreadWithMessages): void => {
      const places = targetPlacesById.get(thread.id) ?? [];
      setSelection(
        thread.targets.map((target, at) =>
          newSelectionItem({
            kind: target.anchor.quote && !target.anchor.element ? "text" : "element",
            documentId: target.documentId,
            pane: "current",
            documentRef: thread.targetRefs[at] ?? { kind: "file", value: "" },
            documentName: thread.documentNames[at] ?? thread.documentNames[0] ?? "",
            anchor: target.anchor,
            label: places[at]?.label ?? target.anchor.quote?.exact ?? "",
            rect: null,
            // Null for the same reason `rect` is: the sweep on the next line
            // measures both, and a shape from an older render is not a shape.
            lines: null,
            zoom: zoomRef.current,
          }),
        ),
      );
      setSelectionNote(thread.note);
      // §3.6 — null is "named by the note", which the box shows as empty.
      setSelectionTitle(thread.title ?? "");
      setDraftId(thread.id);
      setActiveId(null);
      setTraceId(null);
      setSidebarTab("composer");
      void guard(async () => {
        await sweep();
      });
    },
    [targetPlacesById, guard, sweep],
  );

  /**
   * Spec 30 §3.5 — **Turn into a comment**: a note becomes a draft, and the
   * composer opens on it.
   *
   * `openDraft` does the loading, so the note's places and its words arrive in
   * the composer by exactly the route a draft's do. Main refuses the move on
   * anything that is not a note, which is why nothing is checked here.
   */
  const promoteNote = useCallback(
    (threadId: string): void => {
      void guard(async () => {
        const promoted = await window.rex.threadPromote(threadId);
        // The refreshed list, not the row main handed back: `openDraft` reads
        // the document names and refs that `withDetail` adds, and a bare
        // `Thread` carries none of them.
        const fresh = await refreshThreads();
        const loaded = fresh.find((one) => one.id === promoted.id);
        if (loaded) openDraft(loaded);
      });
    },
    [guard, refreshThreads, openDraft],
  );

  /**
   * Spec 30 §3 — a draft opens the composer; everything else opens its card.
   *
   * One function on the row's `onSelect`, so the list has one gesture and the
   * lane decides what it means.
   */
  const openComment = useCallback(
    (threadId: string): void => {
      const thread = threadsRef.current.find((one) => one.id === threadId);
      if (thread?.status === "draft") openDraft(thread);
      else setActiveId(threadId);
    },
    [openDraft],
  );

  /**
   * Spec 10 §3.3 — the excluded paths, live, for the fan-out below.
   *
   * A ref because `askAll` is on a keyboard binding whose effect must not be
   * torn down and rebuilt every time the tree is re-scanned.
   */
  const excludedRef = useRef<string[]>([]);
  excludedRef.current = tree?.excluded ?? [];

  const askAll = useCallback(async (): Promise<void> => {
    // Spec 30 §2 — the two unsent lanes are both skipped, and for one reason
    // between them: "Ask all" is the one command that could send a comment
    // behind the reviewer's back. A note is one they chose not to send; a draft
    // is one they have not finished, and its question may still be empty.
    const waiting = threadsRef.current.filter(
      (thread) => thread.messages.length === 0 && !UNSENT_STATUS.includes(thread.status),
    );
    // §3.3 — a comment about nothing but excluded documents is not asked. It
    // stays in the list and can still be asked on its own; what it stops doing
    // is costing money on a fan-out over a folder the reviewer has set aside.
    const excluded = excludedRef.current;
    const unanswered = waiting.filter((thread) => !outOfReviewScope(thread.targetRefs, excluded));
    const skipped = waiting.length - unanswered.length;
    if (unanswered.length === 0) {
      // Saying nothing here would read as "there was nothing to ask", which is
      // the opposite of what happened.
      if (skipped > 0) {
        setNotice(
          `Nothing asked — ${skipped} unanswered comment${skipped === 1 ? " is" : "s are"} about documents excluded from the review.`,
        );
      }
      return;
    }
    if (skipped > 0) {
      setNotice(
        `Skipped ${skipped} comment${skipped === 1 ? "" : "s"} about documents excluded from the review.`,
      );
    }
    if (unanswered.length > FAN_OUT_CONFIRM) {
      // §8.8 point 4 — a deliberate gate before spending money on a fan-out.
      const estimate = (unanswered.length * ESTIMATED_USD_PER_ASK).toFixed(2);
      const proceed = window.confirm(
        `Ask ${unanswered.length} comments? Each is its own session, so the estimate is about $${estimate}.`,
      );
      if (!proceed) return;
    }
    // Main caps real concurrency at five (§8.8 point 2).
    //
    // Spec 25 §5 — each comment on its own model: the one it was set to, or the
    // default. "Ask all" is not a place to make a choice, so it makes none.
    await Promise.all(
      unanswered.map((thread) =>
        withBusy(thread.id, () =>
          // Spec 43 §4.0 — each comment on its own combination: the one it was
          // set to, or the one it last used, or the default. "Ask all" is not a
          // place to make a choice, so it makes none.
          window.rex.threadAsk({ threadId: thread.id, ...choicesOf(thread.id) }),
        ),
      ),
    );
    // `modelFor` is rebuilt every render, so the two states it reads are the
    // dependencies. Naming the function instead would make this callback new
    // every render and the memo pointless.
  }, [modelByThread, modelList, styleByThread, withBusy]);

  // ── Picking (design/selection) ──────────────────────────────

  const probe = useCallback(
    (pane: DocumentVersion, x: number, y: number, cause: "move" | "scroll") => {
      void (async () => {
        /*
          Spec 26 §4.8 — **a scroll never gives up a deliberate widening.**

          The wheel re-probes because the document moved under a cursor that did
          not, so what is under the cursor really has changed. That is right for
          an ordinary hover, and wrong the moment the reviewer has chosen a scope
          by hand: `keptIndex` keeps their choice only while the chosen element
          is still in the chain, and scrolling out of a section takes it out of
          the chain. The reviewer had not changed their mind — they were reading
          the section they had just selected, which is the whole point of
          selecting one.

          Reported 2026-09-01: *"it selects the parent element ... but when I
          click it still selects the element I am on top of, not the parent
          element that I scroll on"*.

          A pointer that MOVES still re-probes and `keptIndex` still decides, so
          pointing somewhere else drops the choice exactly as it always did.
        */
        if (cause === "scroll" && pickChosenByHand.current && pathPaneRef.current === pane) {
          return;
        }
        // Spec 26 §4.2 — the pointer moved, so the bar goes back to the hover.
        // A commit hands the bar to the place it made and it stays there until
        // exactly this happens: the reviewer's hand is what decides which of
        // the two ↑ moves, and the outline on the page says which it is.
        //
        // Cleared here and not in the layer's own `pointermove`, because this
        // is the one thing every probe has in common — the wheel re-probes too,
        // and the document moving under a still cursor changes what is under it.
        const focused = pathFocusRef.current !== null;
        if (focused) {
          pathFocusRef.current = null;
          setPathFocus(null);
        }
        const keep =
          !focused && pickChosenByHand.current && pathPaneRef.current === pane
            ? pathActiveRef.current
            : NO_KEPT_SCOPE;
        // §4.1 — in the new version the probe answers nothing outside the live
        // blocks, so the path bar never offers a scope a click cannot take.
        const found = (await surfaceFor(pane)?.probeAt(x, y, keep)) ?? null;
        if (!found) return;
        // Usually the smallest anchorable element; the surface says otherwise when
        // the reviewer had already widened and that element is still in the chain.
        showChain(pane, found.scopes, found.active);
      })();
    },
    [showChain, surfaceFor],
  );

  /**
   * ↑ ↓, a crumb, or ⌥ with the wheel. This, and only this, is a deliberate
   * widening — and from here on the click owes the reviewer what it shows.
   */
  const choosePickScope = useCallback((index: number): void => {
    pickChosenByHand.current = true;
    // Spec 26 §4.8 — the ref too, or the very next click reads the index from
    // before this one. See `showChain`.
    pathActiveRef.current = index;
    setPathActive(index);
  }, []);

  const scrollDocument = useCallback(
    (pane: DocumentVersion, dx: number, dy: number) => {
      surfaceFor(pane)?.scrollBy(dx, dy);
    },
    [surfaceFor],
  );

  /**
   * A click in pick mode adds a place and stays in pick mode.
   *
   * §3.1 — nothing replaces anything and no modifier is involved, so picking a
   * fourth and a fifth costs one click each. `P` or escape leaves.
   */
  const commitScope = useCallback(
    (index: number) => {
      void (async () => {
        const pane = pathPaneRef.current;
        const next = await surfaceFor(pane)?.anchorFromScope(index);
        if (next) addSelected(next, pane);
      })();
    },
    [addSelected, surfaceFor],
  );

  /**
   * Spec 29 §4.2 — a part clicked in the lightbox becomes a place, exactly as
   * a pick in the page does: the surface makes the anchor and `addSelected`
   * puts the row where a pick would. The lightbox only ever shows the current
   * pane's diagram (`DocumentView` is the one pane that opens a preview).
   */
  const pickDiagramPart = useCallback(
    (part: DiagramPart) => {
      const figure = preview;
      if (figure?.kind !== "diagram") return;
      void (async () => {
        const next = await surfaceFor("current")?.anchorFromDiagramPart(figure.blockId, part);
        if (next) addSelected(next, "current");
      })();
    },
    [addSelected, preview, surfaceFor],
  );

  /**
   * Spec 16 §6.1 — the gap the reviewer clicked becomes a place in the panel.
   *
   * From there it behaves exactly as any other place: type the note, pick the
   * mode, send. Add names a place; it does not decide what happens there.
   */
  const commitGap = useCallback(
    (index: number) => {
      void (async () => {
        const next = await surfaceRef.current?.anchorFromGap(index);
        if (next) addSelected(next, "current");
      })();
    },
    [addSelected],
  );

  /**
   * Spec 16 §6.1 — `A` adds a place without reaching for the mouse.
   *
   * The gap under the pointer when there is one, because that is what the rule
   * and the pill are already promising; otherwise the gap nearest the middle of
   * what is on screen, which is the honest reading of "here" for a keyboard.
   * The row that appears names its neighbour either way, so a wrong guess is
   * visible before anything is sent.
   */
  const addAtNearestGap = useCallback((): void => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const index = offeredGap.current ?? surface.nearestGap();
    if (index === null) return;
    commitGap(index);
  }, [commitGap]);

  const rememberOfferedGap = useCallback((index: number | null): void => {
    offeredGap.current = index;
  }, []);

  /**
   * A click in pick mode: probe where it landed, then commit that.
   *
   * The probe is repeated rather than assumed, because the click is the first
   * moment REX is certain where the reviewer meant. Both of the ways the old
   * "commit whatever the last pointer move found" could come up empty are the
   * same failure to a reviewer — pick mode simply does nothing:
   *
   *   · No pointer move since entering pick mode, so nothing was ever probed.
   *     That is the common case immediately after reading or selecting text,
   *     when the pointer is already resting where the reviewer is looking.
   *   · A chain left null by something else. `selectionMade` used to do exactly
   *     that on any mouse-up that selected nothing.
   *
   * **A deliberate widening is not re-probed at all** (spec 26 §4.8). It used
   * to survive by the same `keep` the hover probe uses, and `keptIndex` carries
   * the chosen ELEMENT into the new chain — but only when that element is still
   * in it. When it is not, `keptIndex` falls back to the narrowest scope, by
   * design: for a pointer that MOVED somewhere else, the narrow scope is the
   * right answer again.
   *
   * A scroll is not a pointer that moved. The document slid under a cursor that
   * did not, and the reviewer widened on purpose and can see the outline. Then
   * the fallback silently handed them the paragraph inside the section they were
   * pointing at. Reported 2026-09-01 as *"it selects the element I am on top of,
   * not the parent I scrolled to"*, and *"it works in maybe 80% of cases"* —
   * the 20% being a scroll far enough to put the click under a different
   * heading, which is exactly what "widen to the section, scroll to see where it
   * ends, click" does.
   */
  const commitAt = useCallback(
    (pane: DocumentVersion, x: number, y: number) => {
      void (async () => {
        const surface = surfaceFor(pane);
        if (!surface) return;

        /*
          The outline is REX's promise about what a click takes, and a hand-made
          choice is the one case where the promise is not simply "the smallest
          thing under the cursor". So take it, and do not ask again.

          There is nothing to lose by not re-probing. The two cases the re-probe
          exists for are both cases where NO chain exists — a first click with no
          pointer move, or a chain something else nulled — and `pickChosenByHand`
          cannot be true without a chain to have chosen in. A pointer that moves
          away re-probes through `probe` on the way, so what is shown is already
          the answer for where the pointer now is.
        */
        if (
          pickChosenByHand.current &&
          pathPaneRef.current === pane &&
          pathScopesRef.current?.length
        ) {
          const shown = await surface.anchorFromScope(pathActiveRef.current);
          if (shown) addSelected(shown, pane);
          return;
        }

        const found = await surface.probeAt(x, y, NO_KEPT_SCOPE);
        if (!found) {
          // Nothing anchorable under the point: a margin, or the gap between
          // two blocks. `probe` leaves the outline where it was in exactly this
          // case, so the reviewer is looking at a highlighted table while the
          // click lands on `<body>` — and doing nothing here is what made a
          // wide block feel unselectable. Measured on 2026-08-23: six pixels
          // outside a table on any of its four sides, the outline still read
          // `table` and the click added nothing.
          //
          // The outline is REX's promise about what a click takes, so take it.
          // Where the probe DOES find something the outline is already showing
          // that same thing, so this branch changes nothing about a normal
          // click — it only stops the promise being broken.
          if (!pathScopesRef.current?.length || pathPaneRef.current !== pane) return;
          const shown = await surface.anchorFromScope(pathActiveRef.current);
          if (shown) addSelected(shown, pane);
          return;
        }
        showChain(pane, found.scopes, found.active);
        const next = await surface.anchorFromScope(found.active);
        if (next) addSelected(next, pane);
      })();
    },
    [addSelected, showChain, surfaceFor],
  );

  // ── The selection panel ─────────────────────────────────────

  /** §3.3 and §4.1 — focus a row: open its document, scroll to it, offer chips. */
  /**
   * Spec 08 §7 — take me to this place.
   *
   * The same two steps a finding's Open takes: scroll if the document is
   * already here, otherwise open it and let `onSurfaceReady` do the scrolling,
   * because there is no DOM to scroll until then.
   */
  const goToPlace = useCallback(
    (thread: ThreadWithMessages, position: number) => {
      const target = thread.targets[position];
      const ref = thread.targetRefs[position];
      if (!target) return;

      void guard(async () => {
        if (docRef.current?.documentId === target.documentId) {
          // Spec 16 §5.1 — a place that only the original has is scrolled to
          // there. Both panes are asked; the one that cannot find it does
          // nothing, which is what `scrollToAnchor` already does for an anchor
          // it cannot resolve.
          surfaceRef.current?.scrollToAnchor(target.anchor);
          originalSurfaceRef.current?.scrollToAnchor(target.anchor);
          return;
        }
        // Nothing to open with — the document record is gone. Saying so beats
        // a click that silently does nothing.
        if (!ref) {
          setNotice(`${thread.targetNames[position] ?? "That document"} is no longer in REX.`);
          return;
        }
        setCentre("document");
        anchorWhenReady.current = { path: ref.value, anchor: target.anchor };
        await openDocument(ref);

        // `openDocument` closes the open card, because in general the comment
        // you were reading need not be about the document you just opened. A
        // place jump is the case where it always is — and closing the card
        // takes away the list of places the reviewer is working through.
        setActiveId(thread.id);
      });
    },
    [guard, openDocument],
  );

  const expandRow = useCallback(
    (item: SelectionItem) => {
      void guard(async () => {
        if (docRef.current?.documentId !== item.documentId) {
          setExpandedItemId(item.id);
          scrollWhenReady.current = item;
          await openDocument(item.documentRef);
          return;
        }

        // The row belongs to one pane, and widening it has to act on that
        // pane's DOM — see `SelectionItem.pane`.
        surfaceFor(item.pane)?.scrollToAnchor(item.anchor);

        if (expandedItemId === item.id) {
          setExpandedItemId(null);
          dropFocus();
          return;
        }

        setExpandedItemId(item.id);
        focusPlace(item, threadOf(pendingRef.current, item.id));
      });
    },
    [dropFocus, expandedItemId, focusPlace, guard, openDocument, surfaceFor],
  );

  /**
   * Spec 26 §4.1 — widening a place is exactly re-anchoring it.
   *
   * One function for both lists, the way `removeItem` is: a place is drawn the
   * same from either, and only the write-back needs to know which one holds it.
   *
   * The chain is rebuilt from `focus.base` — the anchor the place had when the
   * bar took it — and never from the anchor it has now. Re-anchoring to the
   * section and then rebuilding from *that* drops every scope narrower than the
   * section, and the reviewer could widen once and never come back.
   */
  const rescope = useCallback(
    (index: number) => {
      void guard(async () => {
        const focus = pathFocusRef.current;
        const surface = focus ? surfaceFor(focus.pane) : null;
        if (!focus || !surface) return;

        const next = await surface.anchorFromAnchorScope(focus.base.anchor, focus.base.kind, index);
        if (!next) return;

        const patch = (item: SelectionItem): SelectionItem =>
          item.id === focus.itemId
            ? {
                ...item,
                kind: next.scopes[next.active]?.kind ?? item.kind,
                anchor: next.anchor,
                label: next.label,
                rect: next.rect,
                lines: next.lines,
                zoom: zoomRef.current,
              }
            : item;

        if (focus.threadId === null) {
          setSelection((items) => items.map(patch));
        } else {
          setPendingByThread((map) => {
            const list = map.get(focus.threadId as string);
            if (!list) return map;
            const copy = new Map(map);
            copy.set(focus.threadId as string, list.map(patch));
            return copy;
          });
        }

        // Spec 26 §4.8 — refs with the state, so a second `↑` before React has
        // re-rendered steps from where the first one landed and not from where
        // it started. Two quick notches of ⌥ + wheel used to widen once.
        showChain(focus.pane, next.scopes, next.active);
        setArming(false);
      });
    },
    [guard, showChain, surfaceFor],
  );

  /**
   * Spec 26 §4.5 — the outline's number badge, which knows only an id.
   *
   * Both lists are searched, because the badge is drawn the same way over a
   * panel place and over one waiting on the open comment's strip.
   */
  const focusItemById = useCallback(
    (itemId: string): void => {
      const threadId = threadOf(pendingRef.current, itemId);
      const list =
        threadId === null ? selectionRef.current : (pendingRef.current.get(threadId) ?? []);
      const item = list.find((one) => one.id === itemId);
      if (item) focusPlace(item, threadId);
    },
    [focusPlace],
  );

  /**
   * Spec 26 §2 — one step along the chain, whatever the bar is about.
   *
   * The single entry point for ↑, ↓ and ⌥ with the wheel, so the three can
   * never drift apart. Positive widens, because the chain is built narrow to
   * wide and the crumbs read wide to narrow — "up" is out, in both.
   *
   * Which of the two things moves is `pathFocus` and nothing else: a place when
   * one is focused, the pick when the pointer has moved since the last commit.
   * §4.2 — the reviewer's hand decides, and the outline on the page says which.
   */
  const widenBy = useCallback(
    (by: number): void => {
      const scopes = pathScopesRef.current;
      if (!scopes || scopes.length === 0) return;
      const to = Math.max(0, Math.min(pathActiveRef.current + by, scopes.length - 1));
      if (to === pathActiveRef.current) return;
      if (pathFocusRef.current) rescope(to);
      else choosePickScope(to);
    },
    [choosePickScope, rescope],
  );

  const armRegion = useCallback(() => {
    // The layer has to be up to catch the drag, and the chain it needs is
    // already the one on the bar — in the pane that chain came from.
    if (!pathScopesRef.current) return;
    setPicking(true);
    setArming(true);
  }, []);

  /** A dragged box re-anchors the focused place, exactly as a crumb does. */
  const takeRegion = useCallback(
    (index: number, box: ScopeRect) => {
      void guard(async () => {
        const focus = pathFocusRef.current;
        const next = await surfaceFor(pathPaneRef.current)?.anchorFromRegion(index, box);
        setArming(false);
        setPicking(false);
        if (!next || !focus) return;

        const patch = (item: SelectionItem): SelectionItem =>
          item.id === focus.itemId
            ? {
                ...item,
                // A region is always cut from an element, whatever the place was
                // before, and the chain has to be rebuilt through that element.
                kind: "element",
                anchor: next.anchor,
                label: next.label,
                rect: next.rect,
                lines: next.lines,
                zoom: zoomRef.current,
              }
            : item;

        if (focus.threadId === null) {
          setSelection((items) => items.map(patch));
        } else {
          setPendingByThread((map) => {
            const list = map.get(focus.threadId as string);
            if (!list) return map;
            const copy = new Map(map);
            copy.set(focus.threadId as string, list.map(patch));
            return copy;
          });
        }
      });
    },
    [guard, surfaceFor],
  );

  // ── Keyboard (design/screens/Main) ──────────────────────────
  //
  // Bare letters, because every one of these is a thing the reviewer does
  // dozens of times in a session and a chord would be slower than the mouse.
  // They are all suppressed while a field has focus — `typing()` — so writing
  // the word "pd" in a comment never switches panes.
  //
  // ⌥ held for a moment is pick mode too: hover never outlines things while you
  // are only reading, and it never competes with dragging a text selection.
  //
  // The boolean and not the list: the sweep hands back a new `gaps` array on
  // every scroll, and depending on the array itself would tear both listeners
  // down and put them back each time. What the keyboard needs to know is only
  // whether there is one.
  const hasGaps = gaps.length > 0;
  /**
   * Whether pick mode is on **because ⌥ is being held**, rather than because
   * `P` or the strip turned it on.
   *
   * The two have to be told apart, because only one of them can be left behind:
   * a hold ends on a key the window may never see (`onBlur` below), and a
   * toggle ends when the reviewer says so. A ref and not state — nothing draws
   * from it, and it is written from inside listeners that must not be rebuilt.
   */
  const heldPick = useRef(false);
  /**
   * Spec 26 §4.8 — whether pick mode is on, readable from inside the listeners.
   *
   * The ⌥ timer fires 250ms after the key went down and has to know whether it
   * is the thing turning pick mode on or merely arriving on top of a `P` that
   * already did. A ref, because the keyboard effect is deliberately not rebuilt
   * when `picking` changes.
   */
  const pickingRef = useRef(false);
  pickingRef.current = picking;
  /** The same question about Add, which is a ⇧ hold and a strip toggle too. */
  const heldAdd = useRef(false);
  useEffect(() => {
    let altTimer: number | null = null;
    /** §6.6 — the ⇧ hold that arms Add. Its own timer, its own mode. */
    let shiftTimer: number | null = null;

    /**
     * `composedPath()[0]`, not `event.target`.
     *
     * REX draws inside a shadow root (§7), and an event that crosses that
     * boundary is retargeted: by the time it reaches `document` the target is
     * the shadow *host*, never the field that has focus. So this test never
     * matched, every bare letter fired its shortcut while the reviewer was
     * typing a comment, and `preventDefault` swallowed the character on the way
     * out. Measured on 2026-08-21: typing "pdga" into the note left the note
     * empty and the app showing the graph.
     */
    const typing = (event: KeyboardEvent): boolean => {
      const node = event.composedPath()[0];
      return (
        node instanceof HTMLElement &&
        (node.tagName === "TEXTAREA" || node.tagName === "INPUT" || node.isContentEditable)
      );
    };

    const canPick = doc !== null && centre === "document";

    /*
      Spec 16 §6.4 — Add exists where there is a gap to add at, and nowhere else.

      A gap is measured between two blocks carrying `data-src-line`, which only
      the Markdown renderer stamps. A PDF, a DOCX, a PPTX and a hand-written HTML
      file carry none, so their gap list is empty and every part of Add is dead:
      the strip drew a button that did nothing, ⇧ armed a mode with nothing in it
      and `A` fell through `addAtNearestGap`'s null. Measured on 2026-08-26 on a
      27-slide deck — `[data-src-line]` count 0, `⇧ add` on the strip.

      The gap list is the test rather than the file extension, so nothing here
      has to be kept in step with what each format stamps.
    */
    const canAdd = canPick && hasGaps;

    /*
      Spec 27 §4.2 — the two switches exist on the page REX typeset itself, and
      nowhere else. The extension is the test here and not the gap list, because
      that is genuinely the question: it is not "does this page carry
      `data-src-line`" but "did REX write this page's stylesheet". A DOCX
      carries neither and shares the stylesheet; a hand-written HTML file
      carries neither and does not.
    */
    const canPaper = canPick && doc !== null && isMarkdownPath(doc.ref.value);

    const onKeyDown = (event: KeyboardEvent): void => {
      /*
        Spec 14 §4.5 — Alt inside the comments panel belongs to the panel.

        Holding Alt arms pick mode, and the keys that move a row are Alt plus an
        arrow. Without this the two collide: reordering three rows in a row
        turns the document into a pick surface behind the reviewer's back. Alt
        is the panel's while the focus is in it, and pick's everywhere else.
      */
      const inCommentList = event
        .composedPath()
        .some((node) => node instanceof HTMLElement && node.classList.contains("rex-side-scroll"));

      /*
        Spec 26 §5.4 — ↑ and ↓ walk the path bar's chain.

        Handled before the modifier guard below, because ⌥ has to be allowed:
        holding ⌥ is what arms pick mode, and reaching for ↑ while it is held is
        the whole flow §4.4 exists for. ⌥ with an arrow inside the comment list
        still belongs to the list (spec 14 §4.5), which is why that is tested
        first and not after.

        They moved up out of `PickLayer` because the bar outlives that layer
        now, and a place taken with a text drag never had one at all.
      */
      if (
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !inCommentList &&
        !typing(event) &&
        pathScopesRef.current !== null &&
        pathScopesRef.current.length > 0
      ) {
        event.preventDefault();
        widenBy(event.key === "ArrowUp" ? 1 : -1);
        return;
      }

      /*
        Spec 26 §4.5 — `esc` gives the bar up, and the bar says so.

        `PickLayer` answers `esc` too, and that was the only place it was
        answered: with pick mode off the layer is unmounted, so a bar left over
        from a committed place could not be dismissed at all while its own hint
        read `esc done`. Found by the §7.1 live run at step 7.

        Only when a place is focused. A bare `esc` with no focus and no mode is
        not this binding, and pick mode's own `esc` keeps working through the
        layer — both end at `leavePick`, which is idempotent.
      */
      if (event.key === "Escape" && pathFocusRef.current !== null && !typing(event)) {
        event.preventDefault();
        leavePick();
        return;
      }

      if (
        event.key === "Alt" &&
        altTimer === null &&
        !arming &&
        !penning &&
        canPick &&
        !inCommentList &&
        !typing(event)
      ) {
        altTimer = window.setTimeout(() => {
          // Spec 26 §4.8 — **only a hold that actually turns pick mode ON owns
          // the release.** `P` is a toggle, and ⌥ is how the wheel widens
          // (§4.4), so a reviewer in sticky pick mode who reaches for ⌥ + wheel
          // was having their mode ended by letting go of ⌥ — after which the
          // click that followed landed on the document and added nothing.
          // Reported 2026-09-01. `onBlur` below already tested this; the keyup
          // did not.
          heldPick.current = !pickingRef.current;
          setPicking(true);
        }, ALT_PICK_DELAY);
        return;
      }

      /*
        Spec 16 §6.6 — held ⇧ arms Add, exactly as held ⌥ arms pick.

        The same delay, and for a weaker version of the same reason: ⇧A is a
        binding, so a shifted letter must not flash the rule across the page on
        its way to being typed. `event.key === "Shift"` fires on the modifier
        ALONE, so ⇧A never reaches here — this is the guard for the gap between
        pressing ⇧ and pressing the letter.
      */
      if (
        event.key === "Shift" &&
        shiftTimer === null &&
        !picking &&
        !penning &&
        canAdd &&
        !inCommentList &&
        !typing(event)
      ) {
        shiftTimer = window.setTimeout(() => {
          heldAdd.current = true;
          setAdding(true);
        }, ALT_PICK_DELAY);
        return;
      }
      /*
        Spec 28 §4.1, §4.2 — ⌘F finds in the page, ⌘⇧F searches the workspace.

        Both modifiers, as the send chord takes both (`keys.tsx`). Before the
        `typing()` guard on purpose: ⌘F pressed in a comment's textarea opens
        the bar, as it does in every browser — the guard is for bare letters.
        A copy of the chord arrives here from inside the frame too (§5.3).
      */
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.key === "f" || event.key === "F")
      ) {
        event.preventDefault();
        if (event.shiftKey) {
          // With a single file open there is no tree to search. Said, rather
          // than nothing happening.
          if (!workspace) setNotice("Open a folder to search across documents.");
          else find.openSearch();
          return;
        }
        if (!doc) return;
        // A find is about the page, so the page comes back in front of the graph.
        if (centre !== "document") void showCentre("document");
        find.openBar();
        return;
      }

      /*
        Spec 53 §4.3 — ⌘[ back, ⌘] forward.

        What macOS already means by back and forward, in Safari and in Finder,
        and it pairs with the bare `[` and `]` that hide the two side panels:
        the left key means left in both. Before the zoom block below, which
        returns on any key it does not know.

        A copy of the chord arrives here from inside the frame too (§5.7).
        Nothing in the frame answers either key, so unlike ⌘+ a forwarded copy
        cannot double an effect.
      */
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (event.key === "[") {
          event.preventDefault();
          goBackOne();
          return;
        }
        if (event.key === "]") {
          event.preventDefault();
          goForwardOne();
          return;
        }
      }

      // Zoom the document, the way every reader expects: ⌘/ctrl with + − 0.
      // Handled before the modifier guard below, because the modifier is the
      // binding. `=` as well as `+`, so the key does not need ⇧ on a US layout.
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
        else if (event.key === "-" || event.key === "_") zoomBy(1 / ZOOM_STEP);
        else if (event.key === "0") setZoom(1);
        else return;
        event.preventDefault();
        return;
      }

      // ⇧ is a modifier one of these bindings uses, so it is not disqualifying;
      // the rest are.
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event)) return;

      switch (event.key) {
        case "p":
        case "P":
          if (!canPick) return;
          setPenning(false);
          setPicking((on) => !on);
          break;
        case "n":
        case "N":
          // Spec 06 §5.1 — `P` is already pick, and `N` is the free letter in
          // "pen". Both layers swallow the pointer, so only one can be on.
          if (!canPick) return;
          setPicking(false);
          setPenning((on) => !on);
          break;
        case "d":
        case "D":
          void showCentre("document");
          break;
        case "g":
        case "G":
          // The graph is a view of a workspace; without one there is nothing to
          // draw, and the button is not offered either.
          if (!workspace) return;
          void showCentre("graph");
          break;
        case "a":
          // Spec 16 §6.1 — Add, from the keyboard. Bare `a`, because it costs
          // nothing: it puts a row in the panel and runs no agent. Its shifted
          // twin below is the one that spends money, which is why that one
          // needs the modifier and this one does not.
          if (!canAdd) return;
          addAtNearestGap();
          break;
        case "A":
          // Shift+A only. A bare `a` would fire a fan-out of paid sessions on a
          // keystroke, which §8.8 point 4 already treats as worth confirming.
          if (!event.shiftKey) return;
          /*
            Spec 16 §6.6 — while Add is armed, ⇧A is Add.

            Holding ⇧ is what arms Add, so ⇧A is the combination a reviewer's
            hand arrives at the moment they can see the rules on the page: hold
            to look, press A to take one. The other meaning of ⇧A opens a paid
            session for every unanswered comment in the workspace, and reaching
            it by accident from inside a mode that costs nothing is the one
            collision on this keyboard worth spending a branch on.
          */
          if (adding) {
            if (canAdd) addAtNearestGap();
            break;
          }
          void askAll();
          break;
        case "b":
        case "B":
          // Spec 13 §4.1 — the free letter, and the mnemonic one. It writes a
          // string to the clipboard, so unlike ⇧A it needs no shift to be safe.
          void copyDebug();
          break;
        case "w":
        case "W":
          // Spec 27 §4.1 — the width. Both switches change how a page is drawn
          // and nothing about what it says, so neither needs a modifier and
          // neither can cost anything.
          if (!canPaper) return;
          togglePaperWide();
          break;
        case "t":
        case "T":
          // `T` for theme. `D` is the Document view, and a letter that means
          // two things is a letter that means neither.
          if (!canPaper) return;
          togglePaperDark();
          break;
        /*
          The two panels, from the keyboard. `[` is the one on the left and `]`
          the one on the right, so the position is the whole mnemonic and the
          pair is learnt as one fact rather than two.

          Not `E` and `C`: those name the panels, but the two letters have
          nothing to do with each other, so a hand that knows one is no closer
          to the other. Not ⌘B either, which is what VS Code uses — bare `b` is
          already the debug report here, and every other shortcut in REX is a
          bare letter, so a chord would be the only one of its kind.

          Neither can cost anything, so neither needs a modifier.
        */
        case "[":
          // Nothing to hide until a folder is open, and the button is not
          // drawn then either.
          if (tree === null) return;
          setExplorerShown((on) => !on);
          break;
        case "]":
          setCommentsShown((on) => !on);
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === "Shift") {
        if (shiftTimer !== null) {
          window.clearTimeout(shiftTimer);
          shiftTimer = null;
        }
        heldAdd.current = false;
        setAdding(false);
        return;
      }
      if (event.key !== "Alt") return;
      if (altTimer !== null) {
        window.clearTimeout(altTimer);
        altTimer = null;
      }
      const wasHeld = heldPick.current;
      heldPick.current = false;
      // Only what the hold turned on is turned off — the same rule `onBlur`
      // below already applies, and for the same reason.
      if (!arming && wasHeld) setPicking(false);
    };

    /**
     * A hold that ends off-screen is not a hold.
     *
     * ⌥ and ⇧ arm their modes on the press and end them on the release, and the
     * release is not guaranteed to arrive. This machine switches macOS desktops
     * with ⌥ and a digit: REX sees the ⌥ press, the desktop changes, and the
     * release lands on whatever app is over there. Pick mode then stayed on for
     * as long as REX was away, and the Selection tab it pulled forward was
     * still in front when the reviewer came back. Reported on 2026-08-31.
     *
     * **Only what a hold turned on is turned off.** Pick and Add are toggles
     * too — `P`, `A` and the strip — and a reviewer who switched to another app
     * to copy a sentence must find the mode exactly as they left it.
     *
     * `hasFocus()` is the test for "the window, not a frame in it": focus
     * moving into the document iframe blurs this window too, and that is a
     * reviewer working, not a reviewer leaving. It stays true while any frame
     * of this window holds focus.
     */
    const onBlur = (): void => {
      if (document.hasFocus()) return;
      if (altTimer !== null) {
        window.clearTimeout(altTimer);
        altTimer = null;
      }
      if (shiftTimer !== null) {
        window.clearTimeout(shiftTimer);
        shiftTimer = null;
      }
      if (heldPick.current) {
        heldPick.current = false;
        setPicking(false);
      }
      if (heldAdd.current) {
        heldAdd.current = false;
        setAdding(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (altTimer !== null) window.clearTimeout(altTimer);
      if (shiftTimer !== null) window.clearTimeout(shiftTimer);
    };
  }, [
    addAtNearestGap,
    adding,
    arming,
    askAll,
    centre,
    copyDebug,
    doc,
    find.openBar,
    find.openSearch,
    goBackOne,
    goForwardOne,
    hasGaps,
    leavePick,
    penning,
    showCentre,
    togglePaperDark,
    togglePaperWide,
    tree,
    widenBy,
    workspace,
    zoomBy,
  ]);

  // ── Apply (§8.7, spec 05 §5.6.1) ────────────────────────────

  const decideApply = useCallback(
    (accept: boolean) =>
      guard(async () => {
        const target = pendingApply;
        if (!target) return;
        // Cleared first, so the sweep main drives from inside `applyConfirm`
        // does not redraw change outlines over a document that was just undone.
        setPendingApply(null);
        pendingApplyRef.current = null;
        setChangeBoxes([]);

        const before = orphansBeforeApply.current;

        const response = await window.rex.applyConfirm({
          applyRunId: target.applyRunId,
          accept,
        });
        const list = await refreshThreads();

        if (!accept) {
          setNotice("Undone — every file was restored with git checkout.");
          return;
        }

        // §8.7 step 7 — report the sweep, and name what it cost. "1 newly
        // orphaned" is complete; *which one* is what the reviewer needs.
        const newlyOrphaned = resolvedRef.current
          .filter((entry) => entry.state === "orphaned" && !before.has(entry.threadId))
          .map((entry) => list.find((thread) => thread.id === entry.threadId))
          .filter((thread): thread is ThreadWithMessages => thread !== undefined);

        setApplyOutcome({ summary: response.reanchored, files: target.files, newlyOrphaned });
      }),
    [guard, pendingApply, refreshThreads],
  );

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  /**
   * One reply path, two boxes. The comment card has one and the trace sheet has
   * one, and they send the same message to the same thread — so the handler is
   * written once here rather than inlined at each of them, where the two could
   * quietly stop agreeing about what a reply does.
   */
  /**
   * Spec 12 §4 — one gesture, two destinations.
   *
   * The card and the trace sheet both call this, and the mode decides which
   * channel it reaches. That is the whole change: before, the reply box always
   * went to the read profile, so "yes, do that" could not be sent and the
   * reviewer had to find a different button and let the agent infer the
   * instruction from the transcript.
   */
  const replyToActive = (text: string): void => {
    if (!active) return;
    const threadId = active.id;
    const mode = modeOf(threadId);

    // Spec 24 §4 — the places waiting on this comment go with the message.
    const places = pendingByThread.get(threadId) ?? [];
    const targets = places.map((item) => ({ documentId: item.documentId, anchor: item.anchor }));
    const had = active.targets.length;

    /**
     * §4.4 — the strip gives way to the head's rows and the turn's chips as
     * soon as main has the places, not when the run ends minutes later.
     *
     * Main writes them before its first `await` (`addPlaces` in `ipc.ts`), and
     * Electron delivers one renderer's IPC in order, so a `thread:list` sent
     * after the send already sees the grown comment. If the send then fails
     * WITHOUT having taken them — a document REX no longer has — they come back,
     * because nothing the reviewer picked is lost to a failed send.
     */
    const sent = async (run: Promise<unknown>): Promise<void> => {
      if (targets.length === 0) {
        await run;
        return;
      }
      clearPending(threadId);
      try {
        await refreshThreads();
        await sweep();
      } catch {
        // The run below is what reports; a failed refresh must not mask it.
      }
      try {
        await run;
      } catch (error) {
        const now = threadsRef.current.find((one) => one.id === threadId)?.targets.length ?? had;
        if (now < had + targets.length) {
          setPendingByThread((map) => {
            const next = new Map(map);
            next.set(threadId, [...places, ...(map.get(threadId) ?? [])]);
            return next;
          });
        }
        throw error;
      }
    };

    // Spec 25 §4.1, spec 31 §2.1 and spec 43 §2.1 — the comment's own agent,
    // gateway, model and style, or the ones it last used, or the defaults.
    const choices = choicesOf(threadId);

    if (mode === "act") {
      void withBusy(threadId, () =>
        sent(
          window.rex.threadApply({
            threadId,
            note: text,
            root: workspaceRef.current?.root ?? null,
            targets,
            ...choices,
          }),
        ),
      );
      return;
    }
    // NOTE writes the text into the comment and runs nothing. No `withBusy`:
    // there is no turn to wait for, and the notice bar still reports a failure
    // because `guard` is where that lives.
    if (mode === "note") {
      void guard(async () => {
        // §2.3 and spec 43 §5.4 — a NOTE runs nothing, so it names no agent,
        // no gateway, no model and no style. Null in all four is the honest
        // record of a message no agent ever saw.
        await sent(
          window.rex.threadNote({
            threadId,
            text,
            targets,
            sdk: null,
            gatewayId: null,
            model: null,
            style: null,
          }),
        );
        await refreshThreads();
      });
      return;
    }
    void withBusy(threadId, () =>
      sent(window.rex.threadReply({ threadId, text, targets, ...choices })),
    );
  };

  /**
   * Spec 24 §3.2 — a pending place's row, clicked: take me there. The same two
   * steps the panel's row takes, minus the widening chips.
   */
  const goToPending = (item: SelectionItem): void => {
    void guard(async () => {
      if (docRef.current?.documentId === item.documentId) {
        surfaceFor(item.pane)?.scrollToAnchor(item.anchor);
        return;
      }
      const threadId = activeIdRef.current;
      scrollWhenReady.current = item;
      setCentre("document");
      await openDocument(item.documentRef);
      // `openDocument` closes the card, as `goToPlace` explains; the places
      // being pointed at belong to this comment, so it comes back.
      if (threadId) setActiveId(threadId);
    });
  };

  // Spec 24 §3.3 — the strip's places, and their outlines, only while the card
  // that owns them is on screen.
  const shownCard = active && sidebarTab === "list" && active.kind !== "synthesis";
  const pending = shownCard ? (pendingByThread.get(active.id) ?? []) : [];
  const pendingFrom = shownCard ? active.targets.length : 0;

  /**
   * Spec 26 §4.1 — the number the bar wears, which is the number the focused
   * place's outline draws.
   *
   * Computed here rather than stored on the focus, because it is a position in
   * a list and the list moves: dropping place 1 makes place 2 into place 1, and
   * a remembered number would then name a row that is no longer there. Null
   * while the bar is about a hover, and for a place whose list is not on
   * screen — a strip belongs to one card, and `pending` is already empty when
   * that card is not shown.
   */
  const focusedNumber = ((): number | null => {
    if (!pathFocus) return null;
    if (pathFocus.threadId === null) {
      const at = selection.findIndex((item) => item.id === pathFocus.itemId);
      return at >= 0 ? at + 1 : null;
    }
    const at = pending.findIndex((item) => item.id === pathFocus.itemId);
    return at >= 0 ? pendingFrom + at + 1 : null;
  })();

  const applyTarget = pendingApply
    ? (threads.find((thread) => thread.id === pendingApply.threadId) ?? null)
    : null;

  /*
    Two reasons to hide the comments column, and they are a union.

    §3.3 — it is hidden behind the graph, but never while the panel holds
    something. Losing sight of a half-built selection because you went to look
    at the graph is the same fault as losing it to a stray click.

    The reviewer's own switch is the second reason, and it is only ever a reason
    to HIDE. It cannot pull the column back out from behind the graph, because
    that rule is about there being nothing to show, not about preference.
  */
  const sideHidden = !commentsShown || (centre !== "document" && selection.length === 0);

  // Spec 28 — the bar while it is open, the ruler while there is a mark to
  // draw. Both go to the pane being read; `DocumentView` decides which.
  const findBar = find.bar.open ? (
    <FindBar
      query={find.bar.query}
      count={find.bar.count}
      current={find.current}
      capped={find.bar.capped}
      focusToken={find.barFocus}
      onQuery={find.setQuery}
      onNext={find.next}
      onPrevious={find.previous}
      onClose={find.closeBar}
    />
  ) : null;
  const findRuler =
    find.marks.length > 0 ? (
      <FindRuler marks={find.marks} current={find.current} onPick={find.goTo} />
    ) : null;

  return (
    <div className="rex-app" ref={appRef}>
      <TopBar
        doc={doc}
        workspace={workspace}
        centre={centre}
        zoom={zoom}
        onResetZoom={resetZoom}
        onCentre={showCentre}
        onOpenFile={pick}
        onOpenFolder={pickFolder}
        onSettings={() => settings.show("gateways")}
        onTrace={openTraffic}
        onDebug={copyDebug}
        explorerShown={tree === null ? null : explorerShown}
        onExplorer={() => setExplorerShown((on) => !on)}
        canBack={canGoBack(history)}
        canForward={canGoForward(history)}
        onBack={goBackOne}
        onForward={goForwardOne}
        commentsShown={commentsShown}
        onComments={() => setCommentsShown((on) => !on)}
      />

      {notice ? (
        <div className="rex-notice">
          <span>{notice}</span>
          <span className="rex-spacer" />
          <button type="button" className="rex-link" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      ) : null}

      <div className="rex-body">
        {tree ? (
          <>
            <Explorer
              tree={tree}
              width={explorerWidth}
              hidden={!explorerShown}
              activePath={selectedPath}
              changes={changeCounts}
              showSkipped={showSkipped}
              onOpen={(path) => void guard(() => openDocument({ kind: "file", value: path }))}
              onReload={refreshTree}
              onSelectFile={selectWholeFile}
              onSelectFolder={selectWholeFolder}
              onExclude={(path, exclude) => void setExcluded(path, exclude)}
              onRename={renameEntry}
              onDelete={deleteEntry}
              onCreate={createEntry}
              onMove={moveEntry}
              onToggleSkipped={() => void toggleShowSkipped()}
              tab={find.tab}
              onTab={find.setTab}
              search={{
                root: tree.root,
                query: find.search.query,
                busy: find.search.busy,
                result: find.search.result,
                folded: find.search.folded,
                focusToken: find.searchFocus,
                onQuery: find.setSearchQuery,
                onRun: () => void guard(() => find.runSearch(tree.root)),
                onClear: find.clearSearch,
                onFold: find.toggleFold,
                onOpen: (path, hit) => void guard(() => find.openHit(path, hit)),
              }}
            />
            {/*
              The handle goes with the panel. Left behind, it is a 5px strip of
              `col-resize` cursor in the middle of the window that resizes
              something nobody can see.
            */}
            {explorerShown ? (
              <Splitter
                width={explorerWidth}
                min={200}
                max={640}
                direction={1}
                label="the explorer"
                onChange={setExplorerWidth}
              />
            ) : null}
          </>
        ) : null}

        <div className="rex-centre">
          {/*
            DocumentView stays mounted behind the graph rather than being
            swapped out: unmounting it would drop the iframe, and with it the
            anchor surface and the highlight registry the resolver just built.
          */}
          {/*
            Spec 08 §6.1 — the trace covers the document pane and nothing else.
            The pane is hidden rather than unmounted, for the same reason it is
            hidden behind the graph: unmounting drops the iframe, and with it
            the anchor surface and the highlight registry the resolver built.
          */}
          <div
            className={`rex-pane${centre === "document" && traceId === null ? "" : " rex-pane-hidden"}`}
          >
            <DocumentView
              doc={doc}
              original={original}
              removedLines={doc?.working?.removed ?? []}
              patch={doc?.working?.patch ?? ""}
              workingBar={
                doc?.working
                  ? {
                      // Spec 34 §5.3 — `held` comes from the pending list, which
                      // is re-read around every run; the view `doc:open` handed
                      // over is only as fresh as the last open.
                      view: {
                        ...doc.working,
                        held:
                          working.find((view) => view.documentId === doc.working?.documentId)
                            ?.held ?? doc.working.held,
                      },
                      others: working.length - 1,
                      onApprove: () => approveWorking(doc.working?.documentId ?? ""),
                      onApproveAll: approveAllWorking,
                      onUndo: () => undoWorking(doc.working?.documentId ?? ""),
                      onDiscard: () => discardWorking(doc.working?.documentId ?? ""),
                    }
                  : null
              }
              paneMode={paneMode}
              onPaneMode={setPaneMode}
              resolved={paneShown.current}
              originalResolved={paneShown.original}
              threads={threads}
              activeId={activeId}
              selection={selection}
              pending={pending}
              pendingFrom={pendingFrom}
              hoveredItemId={hoveredItemId}
              onHoverItem={setHoveredItemId}
              onRemoveItem={removeItem}
              onFocusItem={focusItemById}
              changeBoxes={changeBoxes}
              adding={adding}
              onToggleAdd={() => {
                setPicking(false);
                setPenning(false);
                setAdding((on) => !on);
              }}
              picking={picking}
              pathScopes={pathScopes}
              pathActive={pathActive}
              pathPane={pathPane}
              // Spec 26 §4.1 — the bar says which place it is about, and the
              // number is the one that place's outline draws.
              pathNumber={focusedNumber}
              onPathScope={pathFocus ? rescope : choosePickScope}
              onPathDone={leavePick}
              arming={arming}
              penning={penning}
              hoveredThreadId={hoveredThreadId}
              onHoverThread={setHoveredThreadId}
              hoveredPlace={hoveredPlace}
              onTogglePick={() => {
                setPenning(false);
                setPicking((on) => !on);
              }}
              onTogglePen={() => {
                setPicking(false);
                setPenning((on) => !on);
              }}
              onDrawn={finishDrawing}
              onPenCancel={leavePen}
              onSurfaceReady={onSurfaceReady}
              onSelectionChanged={onSelectionChanged}
              onFollowLink={onFollowLink}
              onHoverLink={onHoverLink}
              linkTip={linkTip}
              onPreview={setPreview}
              onPaneResized={onPaneResized}
              onSelectMarker={setActiveId}
              onScrollBy={scrollDocument}
              zoom={zoom}
              onZoomBy={zoomBy}
              onZoomReset={resetZoom}
              onReflowed={onReflowed}
              paper={paper}
              paperable={doc !== null && isMarkdownPath(doc.ref.value)}
              onPaperWide={togglePaperWide}
              onPaperDark={togglePaperDark}
              findPane={readPane}
              corner={findBar}
              ruler={findRuler}
              onProbe={probe}
              onWiden={widenBy}
              onPickCommit={commitScope}
              onPickCommitAt={commitAt}
              onPickCancel={leavePick}
              onRegion={takeRegion}
              gaps={gaps}
              onGapOffer={rememberOfferedGap}
              onGapPick={commitGap}
            />
          </div>

          {/*
            Only where the document pane is. The trace covers that pane; over
            the graph it would be covering someone else's. The id survives the
            trip, so coming back brings the sheet back.
          */}
          {centre === "document" && traceId !== null && active !== null ? (
            <TraceSheet
              thread={active}
              number={numbers.get(active.id) ?? 0}
              tokenClass={tokenClass(active.status, stateById.get(active.id) ?? null)}
              busy={busyThreads.includes(active.id)}
              // Spec 38 §4 — the sheet's foot is the card's composer, reading
              // and writing the same state, so the two cannot disagree about
              // what the next send does.
              mode={active.status === "note" ? "note" : modeOf(active.id)}
              onMode={(mode) => setMode(active.id, mode)}
              models={choicesFor(sdkOf(active.id), gatewayOf(active.id))}
              model={modelOf(active.id)}
              onModel={(model) => setModel(active.id, model)}
              agents={agentChoices}
              sdk={sdkOf(active.id)}
              onSdk={(sdk) => setSdk(active.id, sdk)}
              gateways={gatewayChoice(sdkOf(active.id), gatewayOf(active.id), active.messages)}
              gateway={gatewayOf(active.id)}
              onGateway={(id) => setGateway(active.id, id)}
              onManageGateways={() => settings.show("gateways")}
              supportsStyles={stylesFor(sdkOf(active.id))}
              style={styleOf(active.id)}
              onStyle={(style) => setStyle(active.id, style)}
              pending={pending}
              hoveredItemId={hoveredItemId}
              onHoverItem={setHoveredItemId}
              onRemovePending={removeItem}
              onReorderPending={(from, to) => movePending(active.id, from, to)}
              onGoToPending={goToPending}
              onPendingToNewComment={() => pendingToNewComment(active.id)}
              // Spec 38 §3.2 — the places under each `YOU`, in the head's cells.
              targetPlaces={targetPlacesById.get(active.id) ?? []}
              targetStates={targetStatesById.get(active.id) ?? []}
              openDocumentId={doc?.documentId ?? null}
              hoveredPlace={hoveredPlace}
              onHoverPlace={setHoveredPlace}
              onGoToPlace={(position) => goToPlace(active, position)}
              onClose={() => setTraceId(null)}
              onReply={replyToActive}
            />
          ) : null}

          {centre === "graph" ? (
            graph ? (
              <GraphView
                graph={graph}
                selectedPath={selectedPath}
                onSelect={(path) => {
                  // Selecting stays on the graph so the connections it just lit
                  // up remain visible. A document is opened behind it, which is
                  // what syncs the explorer and loads its comments; an external
                  // or missing file is selected and nothing more.
                  setSelectedPath(path);
                  const node = graph.nodes.find((n) => n.id === path);
                  if (node?.kind === "document") {
                    void guard(() => openDocument({ kind: "file", value: path }));
                  }
                }}
                onOpen={(path) => {
                  setCentre("document");
                  void guard(async () => {
                    await openDocument({ kind: "file", value: path });
                  });
                }}
              />
            ) : (
              <p className="rex-meta rex-graph-loading">Reading the workspace…</p>
            )
          ) : null}
        </div>

        {/*
          Hidden rather than unmounted so an in-progress reply survives a look
          at the graph.
        */}
        {sideHidden ? null : (
          <Splitter
            width={commentsWidth}
            min={300}
            max={commentsMax}
            direction={-1}
            label="the comments panel"
            onChange={setCommentsWidth}
          />
        )}
        <aside
          className={`rex-side${sideHidden ? " rex-pane-hidden" : ""}`}
          style={{ width: commentsWidth }}
        >
          {/*
            Spec 30 §3 — the composer is a SCREEN, not a tab, so it carries the
            same back arrow the card has always carried. The tab bar that used
            to sit here is gone; §8.1 records what that reverses, and its `⋮`
            menu moved into the list's own header row.
          */}
          {sidebarTab === "composer" ? (
            <>
              <nav className="rex-side-head rex-composer-head">
                <button
                  type="button"
                  className="rex-icon-button"
                  aria-label="Back to the comments"
                  data-tip={
                    selection.length > 0
                      ? `Keep this as a draft — ${selection.length} place${selection.length === 1 ? "" : "s"}`
                      : "Back to the comments"
                  }
                  onClick={leaveComposer}
                >
                  <ChevronLeft />
                </button>
                {/*
                  Spec 30 §3.6 — the name, from the moment the composer opens.

                  The screen's title IS the name box rather than a field below
                  it. A comment is named the same way a file is: you type over
                  the heading. And it is here rather than in `SelectionPanel`
                  because that panel is one line of prose until the first place
                  is picked — a name box inside it could not be reached until
                  after the click, which is the whole complaint.

                  Empty is not a name. It writes NULL, and spec 14 §3.1's rule
                  stands: the comment is then named by its own first line.
                */}
                <input
                  className="rex-side-name"
                  value={selectionTitle}
                  placeholder={draftId === null ? "New comment" : "Draft"}
                  aria-label="Name for this comment"
                  title="A name for this comment. Left empty, it is named by its own first line."
                  onChange={(event) => setSelectionTitle(event.target.value)}
                />
              </nav>
              <SelectionPanel
                items={selection}
                note={selectionNote}
                openDocumentId={doc?.documentId ?? null}
                expandedId={expandedItemId}
                // Spec 26 §5.2 — the chips and the bar read the same chain now,
                // so they cannot disagree about what the expanded row is.
                scopes={pathFocus?.itemId === expandedItemId ? pathScopes : null}
                scopeActive={pathActive}
                arming={arming}
                hoveredId={hoveredItemId}
                mode={selectionMode}
                onMode={setSelectionMode}
                models={choicesFor(panelSdk, panelGateway)}
                model={selectionModel}
                onModel={setSelectionModel}
                agents={agentChoices}
                sdk={panelSdk}
                onSdk={(sdk) => {
                  setSelectionSdk(sdk);
                  const moved = gatewayForAgent(gateways?.gateways ?? [], sdk, panelGateway);
                  if (moved) setSelectionGateway(moved);
                }}
                gateways={gatewayChoice(panelSdk, panelGateway, [])}
                gateway={panelGateway}
                onGateway={setSelectionGateway}
                onManageGateways={() => settings.show("gateways")}
                supportsStyles={stylesFor(panelSdk)}
                style={selectionStyle}
                onStyle={setSelectionStyle}
                onNote={setSelectionNote}
                onExpand={expandRow}
                onScope={rescope}
                onArmRegion={armRegion}
                onRemove={removeItem}
                onClear={clearSelection}
                onAsk={askAboutSelection}
                onHover={setHoveredItemId}
                onReorder={(from, to) =>
                  setSelection((items) => moveSelectionItem(items, from, to))
                }
              />
            </>
          ) : active ? (
            <CommentCard
              onTraffic={(threadId) => openTrafficChat(threadId, false)}
              thread={active}
              number={numbers.get(active.id) ?? 0}
              tally={tallyById.get(active.id) ?? NO_PLACES}
              targetStates={targetStatesById.get(active.id) ?? []}
              targetPlaces={targetPlacesById.get(active.id) ?? []}
              busy={busyThreads.includes(active.id)}
              stopping={stoppingThreads.includes(active.id)}
              onStop={() => stopThread(active.id)}
              // Spec 30 §3.5 — a note has already chosen: nothing runs. The
              // card draws no mode switch for one, so this is the mode its
              // Save sends under and `onMode` is never reached.
              mode={active.status === "note" ? "note" : modeOf(active.id)}
              onMode={(mode) => setMode(active.id, mode)}
              onPromote={() => promoteNote(active.id)}
              models={choicesFor(sdkOf(active.id), gatewayOf(active.id))}
              model={modelOf(active.id)}
              onModel={(model) => setModel(active.id, model)}
              agents={agentChoices}
              sdk={sdkOf(active.id)}
              onSdk={(sdk) => setSdk(active.id, sdk)}
              gateways={gatewayChoice(sdkOf(active.id), gatewayOf(active.id), active.messages)}
              gateway={gatewayOf(active.id)}
              onGateway={(id) => setGateway(active.id, id)}
              onManageGateways={() => settings.show("gateways")}
              supportsStyles={stylesFor(sdkOf(active.id))}
              style={styleOf(active.id)}
              onStyle={(style) => setStyle(active.id, style)}
              tracing={traceId === active.id}
              openDocumentId={doc?.documentId ?? null}
              hoveredPlace={hoveredPlace}
              onHoverPlace={setHoveredPlace}
              onGoToPlace={(position) => goToPlace(active, position)}
              pending={pending}
              hoveredItemId={hoveredItemId}
              onHoverItem={setHoveredItemId}
              onRemovePending={removeItem}
              onReorderPending={(from, to) => movePending(active.id, from, to)}
              onGoToPending={goToPending}
              onPendingToNewComment={() => pendingToNewComment(active.id)}
              onShowTrace={() => setTraceId(traceId === active.id ? null : active.id)}
              onBack={() => {
                setActiveId(null);
                // The sheet belongs to one comment, so it goes with it.
                setTraceId(null);
              }}
              onReply={replyToActive}
              onResolve={(resolvedFlag) => resolveThread(active.id, resolvedFlag)}
              onDelete={() => removeThread(active.id)}
              onRename={(title) => void renameThread(active.id, title)}
            />
          ) : (
            <Sidebar
              threads={threads}
              lane={lane}
              onLane={setLane}
              onlyThisFile={onlyThisFile}
              onOnlyThisFile={setOnlyThisFile}
              // §3.3 — the `＋` says how many places are waiting, so a draft
              // being built is never a thing the reviewer has to remember.
              draftPlaces={selection.length}
              onNewComment={openComposer}
              onDeleteAll={removeAllThreads}
              openDocument={doc ? { id: doc.documentId, name: nameOf(doc.ref) } : null}
              statesById={targetStatesById}
              busyThreads={busyThreads}
              groups={groups}
              root={workspace?.root ?? null}
              // Spec 30 §3 — one gesture, and the lane decides what it opens: a
              // draft goes back to the composer, everything else to its card.
              onSelect={openComment}
              onHover={setHoveredThreadId}
              onDelete={removeThread}
              onResolve={resolveThread}
              onRename={renameThread}
              onGroupCreate={createGroup}
              onGroupRename={(groupId, name) => void updateGroup({ groupId, name })}
              onGroupCollapse={(groupId, collapsed) => void updateGroup({ groupId, collapsed })}
              onGroupDelete={deleteGroup}
              onMove={moveComment}
              onSynthesise={(refThreadIds, note) =>
                void guard(async () => {
                  const current = docRef.current;
                  if (!current) return;
                  const thread = await window.rex.threadSynthesise({
                    documentId: current.documentId,
                    refThreadIds,
                    note,
                  });
                  await refreshThreads();
                  setActiveId(thread.id);
                  // Spec 25 — a synthesis comment is made and sent in one act,
                  // so it has no composer to have picked from: the default.
                  await withBusy(thread.id, () =>
                    window.rex.threadAsk({
                      threadId: thread.id,
                      sdk: defaultSdk,
                      gatewayId: defaultGateway,
                      model: choicesFor(defaultSdk, defaultGateway).chosen,
                      style: DEFAULT_STYLE,
                    }),
                  );
                })
              }
            />
          )}
        </aside>
      </div>

      {/*
        Spec 43 §4.5 — the sheet, over everything, because it is configuration
        about REX rather than about the document. It renders itself from the
        descriptor and knows the name of no gateway.
      */}
      {/*
        Spec 46 §8 — Settings, on the tab the caller asked for. It reads its own
        data when it opens rather than on every render: a discovery call per
        keystroke would bill a paid provider for a screen nobody was looking at.
      */}
      {settings.open && gateways ? (
        <Settings
          tab={settings.tab}
          onTab={settings.setTab}
          gateways={gateways.gateways}
          builtin={builtin}
          catalogue={providerCatalogue}
          providers={providers}
          health={storageHealth}
          traffic={trafficSize}
          busy={settingsBusy}
          onEnable={(enabled) =>
            settingsWork(async () => {
              setBuiltin(await window.rex.gatewayBuiltinEnable(enabled));
              refreshGateways(await window.rex.gatewayList());
            })
          }
          onProviderSave={(draft) =>
            settingsWork(async () => {
              setProviders(await window.rex.gatewayProviderSave(draft));
              setBuiltin(await window.rex.gatewayBuiltinState());
            })
          }
          onProviderRemove={(providerId) =>
            settingsWork(async () => {
              setProviders(await window.rex.gatewayProviderRemove(providerId));
              setBuiltin(await window.rex.gatewayBuiltinState());
            })
          }
          onDiscover={async (providerId) => {
            const found = await window.rex.gatewayProviderDiscover(providerId);
            // §6 — "a cached list is dated". Main records WHEN it asked, so the
            // list has to be re-read or the card keeps saying "Not asked yet"
            // about a list it is currently showing.
            setProviders(await window.rex.gatewayProviderList());
            return found;
          }}
          onModels={(providerId, models) =>
            settingsWork(async () => {
              setProviders(await window.rex.gatewayModelsSave({ providerId, models }));
              setBuiltin(await window.rex.gatewayBuiltinState());
              // §4.5 — the ticked models reach `gateway_route.models`, so the
              // composer's model picker has to be re-asked or it keeps the list
              // it had before the save.
              refreshGateways(await window.rex.gatewayList());
            })
          }
          onSecret={(providerId, value) =>
            settingsWork(async () => {
              await window.rex.gatewaySecretSet({ providerId, value });
              setProviders(await window.rex.gatewayProviderList());
            })
          }
          onSecretClear={(providerId) =>
            settingsWork(async () => {
              await window.rex.gatewaySecretClear(providerId);
              setProviders(await window.rex.gatewayProviderList());
            })
          }
          onBodies={(capture) =>
            settingsWork(async () => setTrafficSize(await window.rex.gatewayTrafficBodies(capture)))
          }
          onClearTraffic={() =>
            settingsWork(async () => setTrafficSize(await window.rex.gatewayTrafficClear()))
          }
          // The agents that actually have an adapter, so Original's list grows
          // when spec 47 or 48 lands and shrinks for nobody.
          agents={descriptor?.sdks ?? []}
          onManageExternal={() => setGatewaysOpen(true)}
          onClose={settings.hide}
        />
      ) : null}

      {/*
        Spec 51 §5 — TRAFFIC, at four depths, and one screen at a time.

        Depths 1, 2 and 3 are PAGES because `design/traffic/` draws them as
        pages: same width, a breadcrumb head, and a forward control. Depth 4 is
        the one narrow artboard, so it is a dialog over the turn it came from.

        `back` walks the path. It never leaves the feature — the first build's
        `Open turn` landed on the comment's trace sheet, which is the hybrid the
        reviewer rejected.
      */}
      {traffic?.depth === 1 ? (
        <TrafficPage
          chats={trafficChats}
          onOpenChat={(threadId) => openTrafficChat(threadId, true)}
          onClose={() => setTraffic(null)}
        />
      ) : null}

      {/*
        §5.2 — depth 2, where the comment card's traffic button lands.

        The chat comes back WITH its exchanges rather than out of `threads`,
        because depth 1 crosses documents and `threads` holds only the open
        one's. Measured against the running app on 2026-09-09: picking a chat at
        depth 1 opened nothing at all.
      */}
      {traffic?.depth === 2 && trafficChat?.thread ? (
        <TrafficChat
          thread={trafficChat.thread}
          rows={trafficChat.rows}
          available={trafficChat.available}
          reason={trafficChat.reason}
          onOpenTurn={(runId) => {
            // The LAST exchange, not the first. Every exchange re-sends the
            // whole conversation, so the last one contains every message the
            // turn ever sent — which is what depth 3 draws as one list.
            const rows = trafficChat.rows.filter((row) => row.run === runId);
            const whole = rows.at(-1)?.id ?? null;
            setTraffic({ ...traffic, depth: 3, runId, rowId: whole });
            readExchange(whole);
          }}
          onBack={traffic.fromChats ? openTraffic : null}
          onClose={() => setTraffic(null)}
        />
      ) : null}

      {/* §5.3 — depth 3, one turn: its exchanges and the messages in each. */}
      {traffic?.depth === 3 && trafficChat?.thread && turnOf(trafficChat.thread, traffic.runId) ? (
        <TrafficTurn
          chatName={commentName(trafficChat.thread)}
          chatId={trafficChat.thread.id}
          turn={turnOf(trafficChat.thread, traffic.runId) as Turn}
          exchanges={trafficChat.rows.filter((row) => row.run === traffic.runId)}
          bodies={trafficBodies}
          onOpenMessage={(at) => setTraffic({ ...traffic, depth: 4, at })}
          onBack={() => openTrafficChat(traffic.threadId, traffic.fromChats)}
          onClose={() => setTraffic(null)}
        />
      ) : null}

      {/*
        §5.4 — depth 4, one message. A PAGE since 2026-09-11, so the turn is
        UNMOUNTED behind it rather than covered by a 760px sheet: a request body
        is tens of kilobytes of JSON and a reviewer on a large display was
        reading it through a slot.

        Mounting one screen is also what gives `Escape` one listener. Both were
        mounted before, both bound the key, and the walk back to depth 3 worked
        only because the turn registered its handler first.
      */}
      {traffic?.depth === 4 && trafficChat?.thread && turnOf(trafficChat.thread, traffic.runId) ? (
        <TrafficMessage
          where={whereOf(trafficChat.thread, traffic.runId)}
          bodies={trafficBodies}
          start={traffic.at}
          onBack={() => setTraffic({ ...traffic, depth: 3 })}
          onClose={() => setTraffic(null)}
        />
      ) : null}

      {gatewaysOpen && descriptor && gateways ? (
        <ManageGateways
          descriptor={descriptor}
          list={gateways}
          built={descriptor.sdks.map((sdk) => sdk.id)}
          buildRoutes={buildRoutes}
          validate={validateGateway}
          onSave={(draft) =>
            guard(async () => refreshGateways(await window.rex.gatewaySave(draft)))
          }
          onDelete={(gatewayId) =>
            guard(async () => refreshGateways(await window.rex.gatewayDelete(gatewayId)))
          }
          // §4.5 — the target is a saved gateway or the sheet's own answers, and
          // main rebuilds the route either way. Spec 44 §2 — and the sheet says
          // which agent's route it is asking about, because the two address
          // different paths on the same host.
          onVerify={(target, sdk) => window.rex.gatewayVerify({ ...target, sdk })}
          onTest={(target, sdk, model) => window.rex.gatewayTest({ ...target, sdk, model })}
          onDefault={async (gatewayId) => {
            // Spec 44 §3 — *Use as default* is what writes `agent.sdk`, and the
            // agent it writes is the PANEL's. The panel is the surface that
            // decides what a new comment starts on, so "make this the default"
            // means the row the reviewer has set there, not the row that was
            // already stored.
            await window.rex.gatewayDefault({
              sdk: panelSdk,
              gatewayId,
              model: choicesFor(panelSdk, gatewayId).chosen,
            });
            refreshGateways(await window.rex.gatewayList());
          }}
          onHasEnv={(name) => window.rex.gatewayHasEnv(name)}
          // Spec 47 §2.1 — app-wide, so it is main that holds it and not this
          // gateway. The sheet only draws the answer.
          onOpenCodeStatus={() => window.rex.openCodeStatus()}
          onOpenCodeExecutable={(override) => window.rex.openCodeExecutable(override)}
          onClose={() => setGatewaysOpen(false)}
        />
      ) : null}

      {pendingApply ? (
        <DiffDialog
          event={pendingApply}
          thread={applyTarget}
          number={numbers.get(pendingApply.threadId) ?? 0}
          places={tallyById.get(pendingApply.threadId) ?? NO_PLACES}
          outlined={changeBoxes.length}
          openDocumentPath={doc?.ref.value ?? null}
          onOpenFile={(path) => void guard(() => openDocument({ kind: "file", value: path }))}
          onDecide={decideApply}
        />
      ) : null}

      {/*
        Spec 10 §2.3 — over everything, including the two bars above, because it
        is a thing you open, read and dismiss rather than a thing you work
        beside. It takes the keyboard with it: its own capture-phase listener on
        `document` runs before the bindings below and stops them, so no guard is
        needed here and there is only one place that decides.
      */}
      {preview ? (
        <Lightbox
          figure={preview}
          onClose={() => setPreview(null)}
          onPick={pickDiagramPart}
          places={diagramPlacesFor(preview, selection, pendingByThread, threads, doc)}
          comments={diagramCommentsFor(preview, threads, doc)}
        />
      ) : null}

      {applyOutcome ? (
        <ApplyResult
          summary={applyOutcome.summary}
          files={applyOutcome.files}
          newlyOrphaned={applyOutcome.newlyOrphaned}
          onClose={() => setApplyOutcome(null)}
          onShowOrphans={() => {
            const first = applyOutcome.newlyOrphaned[0];
            setApplyOutcome(null);
            if (first) setActiveId(first.id);
          }}
        />
      ) : null}
    </div>
  );
}
