// SPEC.md §10 — every IPC channel name and payload type.
//
// Invariant I3: commands are `ipcRenderer.invoke`, agent output is
// `webContents.send`. There is no HTTP server, no SSE and no listening port,
// so this file is the entire surface between the two processes.

import type {
  AgentAuth,
  AgentGateway,
  AgentSdk,
  DescribeResult,
  GatewayKind,
  RouteCapabilities,
  VerifyResult,
} from "./agent-protocol.ts";
import type {
  AgentChoices,
  AnchorState,
  AnchorSummary,
  ChangedRegion,
  CommentGroup,
  CommentMove,
  DocumentRef,
  DocumentVersion,
  Message,
  OpenedDocument,
  PaperView,
  ReferenceGraph,
  SendChoices,
  SkippedDocument,
  TargetDraft,
  Thread,
  ThreadStatus,
  ThreadWithMessages,
  ViewState,
  WorkingCopyView,
  WorkspaceRef,
  WorkspaceSearchResult,
  WorkspaceTree,
} from "./types.ts";

/**
 * What `rex <path>` named. Spec 02 §7 — a directory opens as a workspace, a
 * file as a single document, and the renderer cannot tell which without asking.
 */
export type InitialTarget =
  | { kind: "document"; ref: DocumentRef }
  | { kind: "workspace"; ref: WorkspaceRef };

/** Renderer → main, via `ipcRenderer.invoke`. */
export const COMMAND = {
  /**
   * Not in §10's table. §1 step 1 is "open a document" and nothing in the
   * contract lets the renderer ask for one, so this opens the file dialog in
   * main — where `dialog` lives — and returns what the user chose.
   */
  docPick: "doc:pick",
  /**
   * The document named on the command line (`rex <file>`), if any. Also not in
   * §10 — main parses argv and the renderer has no other way to learn of it.
   */
  docInitial: "doc:initial",
  docOpen: "doc:open",
  /** Spec 02 §7 — the workspace explorer and the reference graph. */
  workspacePick: "workspace:pick",
  workspaceTree: "workspace:tree",
  workspaceGraph: "workspace:graph",
  /** Spec 10 §3.4 — take a folder or a file out of the review, or put it back. */
  workspaceExclude: "workspace:exclude",
  /**
   * Spec 23 §2 — the reviewer's own file acts, from the tree's menu.
   *
   * The second door REX has ever had into the folder under review, and the
   * reason it is allowed is that nothing proposes these: the reviewer picked
   * the row. Every check is main's (§2.2), and the agent can reach neither.
   */
  workspaceRename: "workspace:rename",
  workspaceDelete: "workspace:delete",
  /** Spec 39 §2 — the third act at that door: an empty file, or an empty folder. */
  workspaceCreate: "workspace:create",
  /** Spec 40 §2 — the fourth: a row dragged into another folder. */
  workspaceMove: "workspace:move",
  /** Spec 28 §4.2 — every match of a query across the documents in the tree. */
  workspaceSearch: "workspace:search",
  threadList: "thread:list",
  threadCreate: "thread:create",
  threadAsk: "thread:ask",
  /**
   * Spec 17 §2.1 — end this comment's running work.
   *
   * Its own channel and not a flag on anything: it is the one command that acts
   * on a run rather than on a comment, and it is the only one a reviewer
   * presses while another command of theirs is still in flight.
   */
  threadStop: "thread:stop",
  threadReply: "thread:reply",
  threadResolve: "thread:resolve",
  threadDelete: "thread:delete",
  /**
   * The whole list at once, for starting a review over.
   *
   * Its own channel and not a `thread:delete` with the id left off, for the
   * reason `group:delete` is not a `group:update`: a command that empties the
   * panel must never be reachable by forgetting a field. It carries the SAME
   * payload as `thread:list`, so what it destroys is by construction what the
   * panel drew.
   */
  threadDeleteAll: "thread:delete-all",
  threadSynthesise: "thread:synthesise",
  threadApply: "thread:apply",
  /**
   * NOTE mode — record what was typed in a comment, and run nothing.
   *
   * Its own channel and not a flag on `thread:reply`: that one always reaches
   * an agent, and a channel that means "send" or "do not send" depending on a
   * boolean is the kind of economy that ends with a paid run nobody asked for.
   */
  threadNote: "thread:note",
  /**
   * Spec 30 §3.2 — the reviewer left the composer with places in it.
   *
   * Replaces a draft's places and its question in one transaction. Refuses any
   * thread that is not a draft: a comment that has been sent has messages
   * pointing at its places (spec 24 §5.2), and replacing those wholesale would
   * cut a message loose from what it was about.
   */
  threadDraftSave: "thread:draft-save",
  /**
   * Spec 30 §3.5 — **Turn into a comment**: a note becomes a draft.
   *
   * The one move that goes backwards through the lanes, and the only way out of
   * `note` that is not the trash. Refuses anything that is not a note.
   */
  threadPromote: "thread:promote",
  /** Spec 14 §3 — the name on a comment. Null goes back to the note. */
  threadRename: "thread:rename",
  /** Spec 14 §5 — the reviewer's own arrangement of the list. */
  groupList: "group:list",
  groupCreate: "group:create",
  groupUpdate: "group:update",
  groupDelete: "group:delete",
  /**
   * Spec 14 §4.2 — one drop, whatever kind of row was dragged.
   *
   * One channel and not two: the panel has exactly one drag gesture, and its
   * payload differs only in a discriminator. `group:delete` stays separate and
   * always will — it is the one that rearranges other rows, and a channel that
   * deletes should never be reachable by leaving a field off another one.
   */
  commentsMove: "comments:move",
  applyConfirm: "apply:confirm",
  /**
   * Spec 15 §7 — the working copy, and the three things a reviewer does to one.
   *
   * They are separate channels rather than one carrying a verb, for the reason
   * `group:delete` is separate from `group:update`: `work:approve` is the one
   * that writes into the reviewer's own file, and a channel that does that only
   * when a string says so is a channel that does it when the string is wrong.
   */
  workList: "work:list",
  workApprove: "work:approve",
  workDiscard: "work:discard",
  workUndo: "work:undo",
  anchorRestate: "anchor:restate",
  /**
   * Spec 11 §7.4.2 — the renderer's answer to `render:request`.
   *
   * The one place a command flows the "wrong" way round: main asked, and this
   * carries the picture back. It is still `invoke`, so invariant I3 holds — the
   * renderer is the one calling, exactly as it is for every other command.
   */
  renderResult: "render:result",
  /**
   * Spec 08 §6.2 — this run's identifiers, on the clipboard.
   *
   * Not in §10's table. It has to be a command rather than something the
   * renderer assembles, because every field that makes the report worth pasting
   * — the agent's cwd, the SDK's transcript path, the database, the versions —
   * exists only in main. The clipboard is written there too: Electron owns it,
   * and a copy that depends on the renderer being focused fails exactly when a
   * reviewer is trying to report a bug.
   */
  debugCopy: "debug:copy",
  /**
   * Spec 13 §4 — the app's own state, on the clipboard.
   *
   * A separate channel from `debug:copy` rather than a nullable argument on it.
   * That one names a thread and always will; the failure this one is for
   * happens before any thread exists, and a channel that means two things
   * depending on a null is the kind of economy that costs an afternoon later.
   */
  debugSnapshot: "debug:snapshot",
  /**
   * Spec 25 §6.3 — what the CLI offers this account, and the app-wide default.
   *
   * It answers both at once so a picker never has to reason about a stored
   * default missing from the list. `model:default` was its writer and is gone
   * with the top bar's picker (2026-09-04): the default is now written only
   * where a default is chosen, which is **Manage gateways…** (§4.0).
   */
  modelList: "model:list",
  /**
   * Spec 43 §11 — the gateway surface.
   *
   * The renderer receives gateway rows, their routes, and credential
   * **availability**. It never receives environment contents, and main re-reads
   * the row and resolves the credential itself before every run: IPC data is
   * never used as executable SDK configuration without a database lookup.
   *
   * There is deliberately no `gateway:retire`. Nothing needs retiring, because
   * §5.3 made history independent of these rows — a message carries copies.
   */
  gatewayDescribe: "gateway:describe",
  gatewayList: "gateway:list",
  gatewaySave: "gateway:save",
  gatewayDelete: "gateway:delete",
  /** §2.4 — what the server publishes, checked against the kind. Writes nothing. */
  gatewayVerify: "gateway:verify",
  /** An explicit, read-only one-turn test of one route. A remote model may charge. */
  gatewayTest: "gateway:test",
  /** §4.0 — sets the `setting.agent.*` values a NEW comment starts on. */
  gatewayDefault: "gateway:default",
  /** Whether a named variable is set. **True or false, never the value.** */
  gatewayHasEnv: "gateway:has-env",
  /**
   * Spec 47 §2.1 — where the `opencode` program is, and the override for it.
   *
   * App-wide and **not part of a route**: every OpenCode route must use the same
   * server version, so a per-gateway override would let two gateways disagree
   * about which program REX is talking to. A path is not a secret, so unlike a
   * key this one does come back to the screen — a reviewer who typed a path must
   * be able to see the one REX resolved.
   */
  openCodeStatus: "opencode:status",
  openCodeExecutable: "opencode:executable",
  /**
   * Spec 46 §12 — the built-in gateway, its providers and its models.
   *
   * > **No channel returns a secret.** `gateway:secret:set` takes a value and
   * > answers `true`. The renderer displays untrusted document content
   * > (invariant I2) and must never be able to ask for a key, **not even its
   * > own** — so there is no `gateway:secret:get` and there never will be.
   *
   * Everything a provider reports comes back as data and is drawn as text
   * (§14 rule 6): these strings come from a remote server, not from a table REX
   * wrote, so spec 42 §10's warning applies here with more force.
   */
  gatewayBuiltinState: "gateway:builtin:state",
  /** §15 — the reviewer has read the note about removed gateways. Clears it. */
  gatewayRetiredSeen: "gateway:retired:seen",
  /** Flips the switch. Starts or stops the child; **deletes nothing** (§4.1). */
  gatewayBuiltinEnable: "gateway:builtin:enable",
  /** §5.2 — the six descriptors, so the screen can draw controls it did not write. */
  gatewayProviderCatalogue: "gateway:provider:catalogue",
  /** §6 — what an EXTERNAL LiteLLM serves, from its own `/v1/models`. */
  gatewayRemoteModels: "gateway:remote-models",
  gatewayProviderList: "gateway:provider:list",
  gatewayProviderSave: "gateway:provider:save",
  gatewayProviderRemove: "gateway:provider:remove",
  /** §5.3 — what one provider serves, now. A failure is a result, not a throw. */
  gatewayProviderDiscover: "gateway:provider:discover",
  /** The ticked models. Rewrites `config.yaml` and restarts the child (§4.3). */
  gatewayModelsSave: "gateway:models:save",
  /** A key in. **There is no `get`.** */
  gatewaySecretSet: "gateway:secret:set",
  gatewaySecretClear: "gateway:secret:clear",
  /** §7.3 — how this machine will protect a key, said BEFORE one is stored. */
  gatewayStorageHealth: "gateway:storage:health",
  /** §4.6 — this thread's requests and responses, from the gateway's own log. */
  gatewayTraffic: "gateway:traffic",
  /** §8 rule 5 — how much disk the log holds, and a way to clear it. */
  gatewayTrafficSize: "gateway:traffic:size",
  gatewayTrafficClear: "gateway:traffic:clear",
  gatewayTrafficBodies: "gateway:traffic:bodies",
  /**
   * Spec 27 §4.7 — how the reviewer last left the Markdown page.
   *
   * Read once, when the overlay mounts, and written on every switch. It is one
   * object rather than a key-value pair because the two values are one setting:
   * a caller that could write the width without the ground would need to know
   * the ground it was not changing.
   */
  paperView: "paper:view",
  paperViewSet: "paper:view-set",
} as const;

/** Main → renderer, via `webContents.send`. */
export const EVENT = {
  streamStep: "stream:step",
  streamCost: "stream:cost",
  /**
   * Not in §10's table either. §8.7 step 5 requires the user to see a diff
   * before anything is written, and no channel in the contract carries one.
   */
  applyReady: "apply:ready",
  /**
   * Spec 11 §7.4.2 and §7.4.5 — main asks the renderer to make a picture.
   *
   * It cannot make either one itself. Mermaid appends a temporary element to a
   * document and measures text with a real layout; a poster frame means
   * decoding a video and reading a pixel out of it. Both need a live DOM and a
   * canvas, and main has neither — the same reason spec 03 §5.8 gives for the
   * document view's own diagrams. Main holds the deck; the renderer holds the
   * engines; this is the sentence between them.
   */
  renderRequest: "render:request",
} as const;

// ── Request and response payloads ───────────────────────────────

/**
 * Spec 05 §5.3 — every comment in the workspace, not one document's.
 *
 * `root` is the workspace root, or null when a single file was opened by path;
 * main then uses that document's own directory. `documentId` is not a duplicate
 * of it: the open document's own comments must be in the list whatever the root
 * turns out to be, and naming it is what guarantees that.
 */
export interface ThreadListRequest {
  root: string | null;
  documentId: string | null;
}

/** Spec 05 §7 — `targets[0]` decides the thread's own document. Panel order. */
export interface ThreadCreateRequest {
  targets: TargetDraft[];
  note: string;
  /**
   * Spec 30 §2 — the lane it is born in. Absent means `open`, which is the
   * ordinary comment: created and then sent by whichever of `thread:ask` or
   * `thread:apply` the mode picked.
   *
   * `draft` is a comment the reviewer walked away from, `note` one they chose
   * to send to nobody. `resolved` is not offered — nothing is dealt with at the
   * moment it is made.
   */
  status?: Exclude<ThreadStatus, "resolved">;
  /**
   * Spec 30 §3.6 — the name the reviewer typed in the composer, or null.
   *
   * Null and absent both mean **named by the note** (spec 14 §3.1), which is
   * what every comment did before the composer had a name box. It is here
   * rather than a `thread:rename` after the fact so a comment is never written
   * with one name and then corrected to another.
   */
  title?: string | null;
}

/** Spec 30 §3.2 — a draft's places, question and name, replaced wholesale. */
export interface ThreadDraftSaveRequest {
  threadId: string;
  targets: TargetDraft[];
  note: string;
  /** Spec 30 §3.6 — null goes back to being named by the note. */
  title?: string | null;
  /**
   * The lane it lands in. Absent leaves it a draft, which is what back does.
   *
   * It rides along rather than being a second call because sending a draft is
   * ONE act: a draft that saved its places and then failed to change lane would
   * be a comment the reviewer has sent sitting in the unsent list.
   */
  status?: Extract<ThreadStatus, "draft" | "note" | "open">;
}

/**
 * Spec 10 §3.4 — one path, one decision.
 *
 * `exclude: false` is "include in review", which both takes an exclusion back
 * and pulls in a folder REX skips by default. Main decides which of the two it
 * is, because only main knows what rule the path currently carries.
 */
export interface WorkspaceExcludeRequest {
  root: string;
  path: string;
  exclude: boolean;
}

/**
 * Spec 23 §4 — one row, one new name.
 *
 * `name` is a basename and never a path: a rename is not a move (§8), and a
 * box that accepts `../x.md` reads as one and acts as the other.
 */
export interface WorkspaceRenameRequest {
  root: string;
  path: string;
  name: string;
}

/**
 * Spec 40 §2 — one row, into one folder.
 *
 * `parent` is the folder it lands in, never the new path itself, and the name
 * is not carried at all: a move keeps the basename it has. That is the whole
 * difference from a rename, which changes the basename and nothing else — spec
 * 23 §8's line, held from the other side.
 */
export interface WorkspaceMoveRequest {
  root: string;
  path: string;
  parent: string;
}

/** Spec 23 §3 — one file, to the system Bin. Never a folder. */
export interface WorkspaceDeleteRequest {
  root: string;
  path: string;
}

/** Spec 28 §4.2 — the root is the tree being drawn; main scans it again. */
export interface WorkspaceSearchRequest {
  root: string;
  query: string;
}

/**
 * Spec 23 §2.2 — a refusal is an answer, not a fault.
 *
 * "You cannot delete that" is something the reviewer needs to read, so it comes
 * back as a sentence for the notice bar rather than as a thrown error, which
 * the renderer would draw as a failure of REX.
 *
 * `path` on success is where the thing now is — the new path for a rename, and
 * the path that was emptied for a delete.
 */
export type WorkspaceFileResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Spec 39 §4 — one empty path, in a folder the reviewer named.
 *
 * `parent` is the folder it goes in and never the new path itself, so main joins
 * the two after it has checked the name. `name` is a basename for spec 23 §4.2's
 * reason: a box that accepts `docs/api/new.md` reads as a rename and acts as a
 * move (§3.1).
 */
export interface WorkspaceCreateRequest {
  root: string;
  parent: string;
  name: string;
  kind: "file" | "directory";
}

/**
 * Spec 39 §4 — a create has two things to say that a rename and a delete do not.
 *
 * `opens` is main's answer to "is this a document REX can render". The format
 * predicates use `node:path`, which the renderer cannot have, so it is told
 * rather than left to guess — spec 27 §5.2 made the same call for the Markdown
 * list.
 *
 * `note` is §2.2: the new path may be one REX still holds comments for, from a
 * file that went to the Bin. That is not a refusal, and it is not silent either.
 */
export type WorkspaceCreateResult =
  | { ok: true; path: string; opens: boolean; note: string | null }
  | { ok: false; reason: string };

export interface ThreadReplyRequest extends SendChoices {
  threadId: string;
  text: string;
  /**
   * Spec 24 §4 — places to add to the comment with this message, in strip
   * order. Absent and empty both mean a reply about the places it already has.
   *
   * They are written to `thread_target` BEFORE any prompt is built, so the
   * comment has grown by the time the agent reads about it. `thread:note`
   * takes the same shape, so a note can point somewhere too.
   */
  targets?: TargetDraft[];
}

/**
 * Spec 43 §11 — an ASK send, as a request object.
 *
 * `threadAsk(threadId, model, style)` was three positional arguments, and this
 * spec adds two more. A fifth positional argument is the shape that proves the
 * old convenience has run out — and the preload bridge has already been bitten
 * once by exactly that (spec 31 §4: a shorter function is assignable to a
 * longer signature in TypeScript, so a dropped trailing argument was silent).
 */
export interface ThreadAskRequest extends SendChoices {
  threadId: string;
}

/**
 * Spec 12 §4.2 — an ACT send.
 *
 * `note` is what the reviewer typed with the switch on ACT, and it is the
 * instruction. Before this spec the same channel took a bare `threadId` and the
 * agent inferred what to do from the transcript, which is why Apply could not
 * run until something had been said. Empty is not valid: §4.3.
 */
export interface ThreadApplyRequest extends SendChoices {
  threadId: string;
  note: string;
  /**
   * Spec 21 §3 — the open workspace, so a file the agent creates can be scoped
   * to it.
   *
   * Main cannot work it out: `applyThread` groups by **repository** root, and a
   * repository is not a workspace. Null when no workspace is open, and then
   * nothing the agent creates is kept — REX cannot show a file in a tree that
   * is not on screen.
   */
  root: string | null;
  /** Spec 24 §4.2 — as on `ThreadReplyRequest`. */
  targets?: TargetDraft[];
}

// ── Spec 43 §11 — gateways ──────────────────────────────────────

/**
 * One route, as the sheet edits it.
 *
 * `credentialEnv` is the NAME of an environment variable and never a value —
 * §2.6 rule 4, and the reason `gateway:has-env` exists: the renderer may ask
 * whether a named variable is set, and main answers true or false.
 */
export interface GatewayRouteDraft {
  baseUrl: string | null;
  auth: AgentAuth;
  credentialEnv: string | null;
  models: string[];
}

export interface AgentGatewayDraft {
  /** Absent for a new gateway. Present to edit the one it names. */
  id?: string;
  /**
   * Spec 46 §7 — the master key, going ONE way.
   *
   * `undefined` means the sheet did not touch it, so a rename cannot blank a
   * credential. `null` removes it. A string replaces it, and main seals it with
   * the operating system's keystore before anything is written. **There is no
   * field on the way back** — `GatewayView.hasKey` is a boolean.
   */
  key?: string | null;
  name: string;
  kind: GatewayKind;
  routes: Partial<Record<AgentSdk, GatewayRouteDraft>>;
}

/**
 * One gateway as the renderer sees it: the row, plus what each route can do.
 *
 * The capabilities are per SDK because §8 keys the probe that way, and they
 * arrive already resolved so the picker never has to reason about a route that
 * has not been asked yet. An SDK with no entry has no route here (§4.2 greys
 * it, with the reason on hover).
 */
export interface GatewayView {
  gateway: AgentGateway;
  /** §8 rule 4 — `set` or `not set`, and never the value. */
  hasKey: boolean;
  capabilities: Partial<Record<AgentSdk, RouteCapabilities>>;
}

export interface GatewayListResponse {
  gateways: GatewayView[];
  /** §4.0 — what a NEW comment starts on, with a missing gateway resolved. */
  defaults: {
    sdk: AgentSdk;
    gatewayId: string;
    model: string | null;
    /** The stored gateway that is gone, so the picker can say so once. */
    missingGateway: string | null;
  };
}

/** §4.5 — an explicit, read-only one-turn test of one route. */
/**
 * Spec 43 §4.5 — which route to act on, for a gateway that may not exist yet.
 *
 * **Verify and Test are what a reviewer presses BEFORE they trust a row**, so
 * neither may require it to be saved first: a Test you can only run on a
 * gateway you have already committed to is a Test that answers the wrong
 * question.
 *
 * `gatewayId` names a stored row. `kind` and `values` are the sheet's own
 * answers, and main rebuilds the route from them with the same `buildRoutes`
 * the preview used — so the URL is still derived from the catalogue by main and
 * never taken from the wire, which is §11's rule. One or the other, never
 * neither.
 */
export interface GatewayTarget {
  sdk: AgentSdk;
  gatewayId?: string;
  kind?: GatewayKind;
  values?: Record<string, string>;
}

export interface GatewayTestRequest extends GatewayTarget {
  /**
   * The model the test turn asks for.
   *
   * It matters more than it looks: a gateway routes on the model name, so the
   * wrong one is a 404 from a gateway that is working perfectly. Null lets the
   * route's own first configured model stand in.
   */
  model: string | null;
}

export interface GatewayTestResult {
  ok: boolean;
  /** What the agent actually said, or the error. Never a credential. */
  detail: string;
  durationMs: number;
}

export type GatewayVerifyRequest = GatewayTarget;

// ── Spec 46 §12 — the built-in gateway ──────────────────────────
//
// **Nothing below carries a credential in either direction, except one field
// going in.** `GatewaySecret.value` is the only place a key appears in this
// file, and it has no counterpart coming back (§12's warning).

/** §4.1 and §8 — what the Gateways tab draws about REX's own gateway. */
/**
 * Spec 47 §2.1 — what REX found when it looked for `opencode`.
 *
 * `path` and `version` are both nullable and mean different things. No path is
 * "REX could not find the program"; a path with no version is "it is there and
 * would not say what it is", which is a program that is probably not OpenCode.
 * Collapsing the two into `available: boolean` would hide the second, and the
 * second is the one a reviewer can act on.
 */
export interface OpenCodeStatus {
  /** The reviewer's override, exactly as they typed it. Empty means auto-detect. */
  override: string;
  path: string | null;
  /** Which of §2.1's three steps answered. */
  source: "override" | "bundled" | "installed" | "none";
  /** `opencode --version`, or null when it could not be asked. */
  version: string | null;
  /** What to do about it, or null when there is nothing to do. */
  problem: string | null;
}

export interface BuiltinState {
  /** The switch, as stored. True even while the child is still starting. */
  enabled: boolean;
  /** Whether a process is actually listening. `enabled && !running` is a fault. */
  running: boolean;
  /** The port it GOT, which is not always the one it wanted (§4.2). */
  port: number | null;
  startedAt: string | null;
  /** Why it is not running, in a sentence a person can act on. */
  down: string | null;
  /** How many models it currently serves, across every provider. */
  models: number;
  providers: number;
  /**
   * §15 — the gateways the migration removed, named once.
   *
   * Empty on every launch but the first after upgrading. The Settings screen
   * says it and then clears it: a person whose two working gateways vanished is
   * owed a sentence, and one that keeps reappearing is noise.
   */
  retired: string[];
}

/**
 * §5.2 — one provider REX can put behind its own gateway, as data.
 *
 * The shape of `local-gateway/catalogue.json`, which is generated from
 * `providers.py` and checked against it by `local-gateway/tests/test_catalogue.py`.
 * The screen draws controls from this and knows nothing about any provider by
 * name — which is criterion A8: a seventh provider is a row here and at most one
 * probe function, with no `if provider ==` in anything that renders.
 */
export interface ProviderDescriptor {
  id: string;
  label: string;
  /** What `config.yaml` prefixes the model with. `openai/` is a protocol. */
  prefix: string;
  fields: ProviderField[];
  /** §5.4 — free to enumerate, or does every model bill a real account? */
  local: boolean;
  /** One sentence, drawn under the provider's name. */
  note: string;
  /** Set when the provider has a fixed endpoint and asks for no address. */
  defaultUrl: string | null;
  auth: "bearer" | "x-api-key" | "none";
  headers: Record<string, string>;
}

export interface ProviderField {
  key: string;
  label: string;
  /** `password` is never rendered with a reveal — §8 rule 4. */
  kind: "url" | "text" | "password";
  required: boolean;
  placeholder: string | null;
  help: string | null;
  default: string | null;
}

/** One provider, as the Models tab draws it. **Never carries a key.** */
export interface GatewayProviderView {
  id: string;
  /** A descriptor id — `lmstudio`, `openai`, … The catalogue supplies the rest. */
  provider: string;
  label: string;
  baseUrl: string | null;
  /** §8 rule 4 — `set` or `not set`, and never the value. */
  hasKey: boolean;
  listedAt: string | null;
  /** The models ticked under it, as stored. */
  models: GatewayModelView[];
}

export interface GatewayModelView {
  /** The provider's own id, verbatim. */
  model: string;
  /** The alias REX generated. A person never types one. */
  alias: string;
  maxInput: number | null;
  maxOutput: number | null;
  /** **Null is "the provider did not say"**, and must never be drawn as "no". */
  tools: boolean | null;
}

/** §6 — what an external LiteLLM answered, or why it did not. */
export interface GatewayRemoteModels {
  models: Array<{ id: string; maxInput: number | null; maxOutput: number | null }>;
  error: string | null;
  /** True when the refusal was about the key, so the screen names the fix. */
  needsKey: boolean;
}

export interface GatewayProviderDraft {
  /** Absent for a new provider. */
  id?: string;
  provider: string;
  label: string;
  baseUrl: string | null;
}

/** §5.3 — what one provider answered, or why it did not. */
export interface GatewayDiscovery {
  provider: string;
  models: Array<{
    id: string;
    context: number | null;
    kind: "chat" | "embedding" | "unknown";
    tools: boolean | null;
    note: string;
  }>;
  /** Null when it answered. A sentence when it did not — never a stack trace. */
  error: string | null;
}

/** The ticked set for one provider. Replaces whatever was there. */
export interface GatewayModelsRequest {
  providerId: string;
  models: Array<{
    model: string;
    context: number | null;
    tools: boolean | null;
  }>;
}

/**
 * A key, going one way.
 *
 * There is no reply type carrying a value, and no channel that reads one back.
 * That is the whole of §12's rule, expressed as an absence.
 */
export interface GatewaySecret {
  providerId: string;
  value: string;
}

/** §7.3 — what this machine will actually do with a key, said before it stores one. */
export interface GatewayStorageHealth {
  available: boolean;
  warning: string | null;
}

/** §4.6 — one request through the gateway, as the traffic sheet draws it. */
export interface GatewayTrafficRow {
  at: string;
  thread: string | null;
  run: string | null;
  profile: string | null;
  /** The ENGINE's own id, not the alias. */
  model: string | null;
  ms: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cost: number | null;
  /** Null on success. **Failures are recorded too**, unlike in Grafana. */
  error: string | null;
  requestBody?: unknown;
  response?: unknown;
}

/**
 * What the traffic button gets back.
 *
 * `available` is false for a `litellm` gateway, and `reason` says why (§4.6,
 * criterion A16): REX writes the built-in gateway's config so it can install a
 * callback, and an existing LiteLLM belongs to somebody else. The button does
 * not disappear, because a control that vanishes looks like a bug.
 */
export interface GatewayTrafficResult {
  available: boolean;
  reason: string | null;
  rows: GatewayTrafficRow[];
  /** Whether bodies are being captured at all, so an empty one reads correctly. */
  bodies: boolean;
}

export interface GatewayTrafficSize {
  bytes: number;
  days: number;
  bodies: boolean;
}

/**
 * Spec 14 §3.1 — `title: null` is the reset, and so is an empty string.
 *
 * "Delete the name" and "go back to the note" are the same wish, so the panel is
 * not made to tell them apart.
 */
export interface ThreadRenameRequest {
  threadId: string;
  title: string | null;
}

/** Spec 14 §5.3 — groups belong to a workspace root, so every call names one. */
export interface GroupListRequest {
  root: string;
}

export interface GroupCreateRequest {
  root: string;
  /** Null is the top level. */
  parentId: string | null;
  name: string;
}

/**
 * The name, the collapsed flag, or both.
 *
 * Both fields optional and both on one channel, because both are "a property of
 * this group changed" and neither is worth a round trip of its own.
 */
export interface GroupUpdateRequest {
  groupId: string;
  name?: string;
  collapsed?: boolean;
}

export interface GroupDeleteRequest {
  groupId: string;
}

export interface ThreadResolveRequest {
  threadId: string;
  resolved: boolean;
}

export interface ThreadSynthesiseRequest {
  documentId: string;
  refThreadIds: string[];
  note: string;
}

export interface ApplyConfirmRequest {
  applyRunId: string;
  accept: boolean;
}

export interface ApplyConfirmResponse {
  reanchored: AnchorSummary;
}

/** Spec 05 §5.4 — one target, named by its index in `Thread.targets`. */
export interface AnchorRestateRequest {
  threadId: string;
  position: number;
  anchorState: AnchorState;
}

/**
 * Spec 11 §7.7 — one operation, in the words the preview shows.
 *
 * `git diff` on a `.pptx` prints `Binary files differ`, and spec 01 §8.7
 * step 5 — show the change and wait — is REX's entire safety story for Apply.
 * A binary diff turns that step into a rubber stamp, so this replaces it.
 */
export interface DeckOperationLine {
  op: string;
  /** One line naming the slide and the shape by the name a reviewer knows. */
  summary: string;
  /**
   * What the reviewer must be told before accepting: formatting flattened by a
   * run merge, a font the deck does not carry, a colour outside the palette, a
   * shape that may now overflow.
   */
  flags: string[];
}

/** One affected slide, drawn before and after, as two self-contained pages. */
export interface DeckSlidePreview {
  slide: number;
  before: string | null;
  after: string | null;
  /**
   * Spec 19 §7.2 — the speaker notes, when this run changed them.
   *
   * Both null on a slide whose notes the run did not touch. They exist because
   * a notes change **does not appear on the slide**: spec 11 §7.7's preview is
   * two pictures, and two identical pictures are the rubber stamp that whole
   * section exists to prevent.
   */
  notesBefore: string | null;
  notesAfter: string | null;
  /**
   * The slide box in points, so the preview can scale the picture exactly.
   *
   * It has to come from the deck: a 16:9 deck is 720×405pt and a 4:3 one is
   * 720×540, and a preview that assumed either would letterbox or crop the
   * other one — on the pictures that decide whether an edit is accepted.
   */
  widthPt: number;
  heightPt: number;
}

/**
 * Spec 11 §7.7 — the preview that replaces the diff. Both halves are required.
 *
 * The pictures are what catch the failures the words cannot express: text that
 * overflows its shape, a style that is mechanically right and visually wrong, a
 * picture that does not suit the slide. A words-only summary reads as correct
 * in all three cases.
 */
export interface DeckPreview {
  /** Absolute path of the deck. */
  deck: string;
  operations: DeckOperationLine[];
  slides: DeckSlidePreview[];
  /** §7.8 — structural problems the edit introduced. Empty on every accepted run. */
  problems: string[];
}

/**
 * Spec 15 §7.4 — what a finished ACT run has to say for itself.
 *
 * It is a **notice**, not a gate. Before spec 15 this opened a bar with OK and
 * Undo, and nothing was final until one was pressed — that bar was the whole of
 * spec 01 §8.7 step 5. The two panes are step 5 now, so nothing is waiting on
 * this: the reviewer's file already holds what it held before the run, and it
 * keeps holding it until §7.2 runs.
 */
export interface ApplyReadyEvent {
  applyRunId: string;
  threadId: string;
  diff: string;
  /** Absolute paths of every document whose working copy this run changed. */
  files: string[];
  /** Spec 05 §5.6.1 — what to outline, per file. Empty for a file with no
      `data-src-line` stamps, which is the honest answer rather than a guess. */
  regions: ChangedRegion[];
  /** Spec 05 §5.6 — target documents Apply could not edit, and why. */
  skipped: SkippedDocument[];
  /** Spec 15 §3 — the working copy of each document this run changed. */
  working: WorkingCopyView[];
  /**
   * Spec 15 §4.3 — files the agent wrote that were not its to write, put back.
   *
   * Never empty for a well-behaved run, and never silent for any other kind: a
   * file the reviewer did not comment on is not part of this review.
   */
  restored: string[];
  /**
   * Spec 21 §4.3 — the directory holding what a put-back removed.
   *
   * Null when `restored` is empty. It is in the notice because it was not: the
   * bytes have always been kept (`work.ts:427`) and the reviewer has never been
   * told where, so a put-back read as a deletion. That is how spec 21 §1's
   * report started.
   */
  restoredDir: string | null;
  /**
   * Spec 21 §2 — files the agent created, kept where it wrote them.
   *
   * Repository-relative, like `restored`. A creation destroys nothing, so it is
   * kept and shown rather than put back; the tree is refreshed when this is
   * non-empty, because otherwise the file exists and the sidebar disagrees.
   */
  created: string[];
  /**
   * Spec 22 §5.1 — text documents under the workspace root the agent edited,
   * now held as working copies.
   *
   * Repository-relative, like `restored` and `created`. The file on disk is
   * unchanged and the agent's version is in `working` beside the anchored
   * document's; this names them because a run that changed a file the reviewer
   * did not comment on has to say so, or "Applied to 0 file(s)" is what they
   * read.
   */
  changed: string[];
  /**
   * Spec 21 §13 — files the agent wrote into REX's own store.
   *
   * Absolute, unlike `restored` and `created`: the store is not under the
   * repository, and the path is the only way back to the bytes. REX leaves them
   * exactly where they are — `base` lives in that directory and must never be
   * touched — and says so, because the alternative is what §13 reports: a run
   * that wrote 9.5 KB and reported "Applied to 0 file(s)".
   */
  misplaced: string[];
  /**
   * Spec 17 §3.4 — the reviewer stopped this run.
   *
   * It suppresses the notice bar, and nothing else. A run that was stopped has
   * already reported itself in the conversation, in the STOPPED block the
   * reviewer's own press produced; a bar saying *"This document was not
   * changed"* under it is REX answering a question nobody asked.
   *
   * Any working copy the stopped run DID produce is unaffected — it is shown in
   * the two panes exactly as a finished run's is, because a half-written change
   * has to be visible whatever ended the run.
   */
  stopped: boolean;
  /** Spec 11 §7.7 — present when this run edited a deck, and never with a diff. */
  decks?: DeckPreview[];
}

/** Spec 15 §7.2 — approving writes into the reviewer's file, so it can refuse. */
export interface WorkApproveResponse {
  ok: boolean;
  /** §7.3 and spec 34 §5.2 — why not, in the words the reviewer sees. */
  reason: string | null;
  /** The sweep that follows a write (§8.7 step 6). Null when nothing was written. */
  reanchored: AnchorSummary | null;
}

/**
 * Spec 34 §5.2 — discard and undo can refuse too, while a run holds the copy.
 * Both replaced the copy's content under a running agent before this spec.
 */
export interface WorkActResponse {
  ok: boolean;
  reason: string | null;
}

/** What main is asking the renderer to draw. */
export type RenderRequestKind = "diagram" | "poster";

/** Spec 11 §7.4.2 — main asks; `id` is what pairs the answer with the question. */
export interface RenderRequestEvent {
  id: string;
  kind: RenderRequestKind;
  /**
   * Mermaid source for a diagram; a `rex-doc://` URL for a video whose first
   * frame is wanted. A video is never sent as bytes — a 50 MB clip base64'd
   * across IPC is 67 MB of string for one still picture.
   */
  source: string;
}

export interface RenderResultRequest {
  id: string;
  /** A PNG, base64-encoded, or null when it would not draw. */
  pngBase64: string | null;
  error: string | null;
  /** §7.4.5 — a video's length, so the preview can state it. Seconds. */
  durationSeconds?: number;
}

export interface CostEvent {
  documentId: string;
  totalUsd: number;
}

/**
 * The contextBridge surface. `src/preload/index.ts` implements exactly this
 * and nothing more — everything exposed here is reachable by document content.
 */
export interface RexApi {
  docPick(): Promise<DocumentRef | null>;
  docInitial(): Promise<InitialTarget | null>;
  /**
   * Spec 15 §6.1 — `version` picks which of the two the render is.
   *
   * A version and never a path: the renderer displays untrusted document
   * content (invariant I2), so it does not get to name a file for main to read.
   * Omitted, or with no working copy, it is the reviewer's own file exactly as
   * before.
   */
  docOpen(ref: DocumentRef, version?: DocumentVersion): Promise<OpenedDocument>;
  workspacePick(): Promise<WorkspaceRef | null>;
  /** `reveal` lists what the scan prunes, so an exclusion can be taken back. */
  workspaceTree(ref: WorkspaceRef, reveal?: boolean): Promise<WorkspaceTree>;
  workspaceGraph(ref: WorkspaceRef): Promise<ReferenceGraph>;
  workspaceExclude(request: WorkspaceExcludeRequest): Promise<void>;
  /** Spec 23 §4 — the file, and every record REX keys on its path. */
  workspaceRename(request: WorkspaceRenameRequest): Promise<WorkspaceFileResult>;
  /** Spec 23 §3 — to the Bin. The comments on it are kept. */
  workspaceDelete(request: WorkspaceDeleteRequest): Promise<WorkspaceFileResult>;
  /** Spec 39 §4 — an empty file or an empty folder, and nothing written but the path. */
  workspaceCreate(request: WorkspaceCreateRequest): Promise<WorkspaceCreateResult>;
  /** Spec 40 §4 — a row into a folder, with every record keyed on its path. */
  workspaceMove(request: WorkspaceMoveRequest): Promise<WorkspaceFileResult>;
  /** Spec 28 §4.2 — runs on `↵`; the answer is a snapshot. */
  workspaceSearch(request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult>;
  threadList(request: ThreadListRequest): Promise<ThreadWithMessages[]>;
  threadCreate(request: ThreadCreateRequest): Promise<Thread>;
  /**
   * Spec 43 §11 — a request object at last. See `ThreadAskRequest` for why.
   */
  threadAsk(request: ThreadAskRequest): Promise<void>;
  /**
   * Spec 17 §3.1 — stops every run this comment has, and says how many.
   *
   * Zero means the run finished between the paint and the click, which is worth
   * a sentence rather than a button that appears to do nothing.
   */
  threadStop(threadId: string): Promise<number>;
  threadReply(request: ThreadReplyRequest): Promise<void>;
  threadResolve(request: ThreadResolveRequest): Promise<Thread>;
  /** Removes the comment and everything that belonged to it. Irreversible. */
  threadDelete(threadId: string): Promise<void>;
  /**
   * Removes every comment `thread:list` would return for this request, and says
   * how many went. Folders survive. Irreversible.
   */
  threadDeleteAll(request: ThreadListRequest): Promise<number>;
  threadSynthesise(request: ThreadSynthesiseRequest): Promise<Thread>;
  threadApply(request: ThreadApplyRequest): Promise<string>;
  /** NOTE mode — saves the text in the thread. No agent, no session, no cost. */
  threadNote(request: ThreadReplyRequest): Promise<void>;
  /** Spec 30 §3.2 — replaces a draft's places and question. Drafts only. */
  threadDraftSave(request: ThreadDraftSaveRequest): Promise<Thread>;
  /** Spec 30 §3.5 — a note becomes a draft, keeping every place and its words. */
  threadPromote(threadId: string): Promise<Thread>;
  /** Spec 14 §3 — name a comment, or pass null to go back to the note. */
  threadRename(request: ThreadRenameRequest): Promise<void>;
  /** Spec 14 §5 — every group in one workspace, at every depth, in walk order. */
  groupList(request: GroupListRequest): Promise<CommentGroup[]>;
  groupCreate(request: GroupCreateRequest): Promise<CommentGroup>;
  groupUpdate(request: GroupUpdateRequest): Promise<void>;
  /** Promotes everything inside to the group's own parent, then removes it. */
  groupDelete(request: GroupDeleteRequest): Promise<void>;
  /** Spec 14 §4.2 — one drop: this row, into that parent, after that sibling. */
  commentsMove(request: CommentMove): Promise<void>;
  applyConfirm(request: ApplyConfirmRequest): Promise<ApplyConfirmResponse>;
  /** Spec 15 §7 — every document with a change waiting, newest fork first. */
  workList(): Promise<WorkingCopyView[]>;
  /** Writes the new version over the reviewer's file, or says why it will not. */
  workApprove(documentId: string): Promise<WorkApproveResponse>;
  /**
   * Throws the change away: the copy takes the file's bytes (spec 34 §3.2).
   * The file was never touched. Refused while a run holds the copy (§5.2).
   */
  workDiscard(documentId: string): Promise<WorkActResponse>;
  /**
   * One ACT run back. The revision is kept, so this is a step, not a loss.
   * Refused while a run holds the copy (spec 34 §5.2).
   */
  workUndo(documentId: string): Promise<WorkActResponse>;
  anchorRestate(request: AnchorRestateRequest): Promise<void>;
  /** Puts this thread's debug report on the clipboard and returns it. */
  debugCopy(threadId: string): Promise<string>;
  /** Spec 13 §4 — the same, for the app rather than for one comment. */
  debugSnapshot(view: ViewState): Promise<string>;
  /**
   * Spec 25 §3 and spec 43 §4.3 — what one route offers, and the default model.
   *
   * Both halves of the route are arguments, because the model list follows both
   * (spec 43 §4.1's cascade, and spec 44 §3's row above it). Omitted means
   * `Original` and the Claude Agent SDK, which is what every caller meant
   * before spec 43.
   */
  modelList(gatewayId?: string, sdk?: AgentSdk): Promise<AgentChoices>;

  /** Spec 43 §4.5 — the kinds and the fields, so the sheet can draw itself. */
  gatewayDescribe(): Promise<DescribeResult>;
  /** Every gateway, its routes, its capabilities, and what a new comment starts on. */
  gatewayList(): Promise<GatewayListResponse>;
  /** Validates and writes one gateway and its routes. Refuses `Original`. */
  gatewaySave(draft: AgentGatewayDraft): Promise<GatewayListResponse>;
  /** Removes it. **History is unaffected** (§5.3). Refuses `Original`. */
  gatewayDelete(gatewayId: string): Promise<GatewayListResponse>;
  /** §2.4 — what the server publishes, checked against the route. Writes nothing. */
  gatewayVerify(request: GatewayVerifyRequest): Promise<VerifyResult>;
  /** §4.5 — one read-only turn through the real adapter. A remote model may charge. */
  gatewayTest(request: GatewayTestRequest): Promise<GatewayTestResult>;
  /** §4.0 — sets what a NEW comment starts on. Changing a control does not. */
  gatewayDefault(choice: { sdk: AgentSdk; gatewayId: string; model: string | null }): Promise<void>;
  /** Whether a named variable is set. **True or false, never the value.** */
  gatewayHasEnv(name: string): Promise<boolean>;
  /** Spec 47 §2.1 — the resolved `opencode`, its version, and the override. */
  openCodeStatus(): Promise<OpenCodeStatus>;
  /** Sets the override. Empty restores auto-detect. Answers the new status. */
  openCodeExecutable(override: string): Promise<OpenCodeStatus>;
  // ── Spec 46 §12 — the built-in gateway ────────────────────────

  /** On or off, the port it got, whether it is running, and why not. */
  gatewayBuiltinState(): Promise<BuiltinState>;
  /** §15 — the note is shown once. This is what makes it once. */
  gatewayRetiredSeen(): Promise<BuiltinState>;
  /** Flips the switch and starts or stops the child. **Deletes nothing.** */
  gatewayBuiltinEnable(enabled: boolean): Promise<BuiltinState>;
  /** §5.2 — the six descriptors, as data. The screen names no provider itself. */
  gatewayProviderCatalogue(): Promise<ProviderDescriptor[]>;
  /** §6 — an external gateway's own model list. Says "add the key", never "no models". */
  gatewayRemoteModels(gatewayId: string): Promise<GatewayRemoteModels>;
  gatewayProviderList(): Promise<GatewayProviderView[]>;
  gatewayProviderSave(draft: GatewayProviderDraft): Promise<GatewayProviderView[]>;
  gatewayProviderRemove(providerId: string): Promise<GatewayProviderView[]>;
  /** §5.3 — asks one provider what it serves, now. */
  gatewayProviderDiscover(providerId: string): Promise<GatewayDiscovery>;
  /** The ticked models. Rewrites the config and restarts the child. */
  gatewayModelsSave(request: GatewayModelsRequest): Promise<GatewayProviderView[]>;
  /** A key in, and `true` back. **There is no way to read one out.** */
  gatewaySecretSet(secret: GatewaySecret): Promise<boolean>;
  gatewaySecretClear(providerId: string): Promise<boolean>;
  /** §7.3 — asked BEFORE a key is entered, so the warning arrives in time. */
  gatewayStorageHealth(): Promise<GatewayStorageHealth>;
  /** §4.6 — this comment's requests and responses. */
  gatewayTraffic(threadId: string): Promise<GatewayTrafficResult>;
  gatewayTrafficSize(): Promise<GatewayTrafficSize>;
  gatewayTrafficClear(): Promise<GatewayTrafficSize>;
  /** §8 rule 5 — capture request and response bodies, on or off. */
  gatewayTrafficBodies(capture: boolean): Promise<GatewayTrafficSize>;

  /** Spec 27 §4.7 — the paper the reviewer last read on. */
  paperView(): Promise<PaperView>;
  paperViewSet(view: PaperView): Promise<void>;

  onStreamStep(listener: (message: Message) => void): () => void;
  onStreamCost(listener: (event: CostEvent) => void): () => void;
  onApplyReady(listener: (event: ApplyReadyEvent) => void): () => void;
  /** Spec 11 §7.4.2 — main asks for a picture; the renderer answers. */
  onRenderRequest(listener: (event: RenderRequestEvent) => void): () => void;
  renderResult(request: RenderResultRequest): Promise<void>;
}
