// The contextBridge surface, and nothing else (SPEC.md §3.1).
//
// Everything exposed here is reachable by document content, so it is exactly
// the §10 command list — no `ipcRenderer` handle, no filesystem, no database.

import { contextBridge, ipcRenderer } from "electron";
import { COMMAND, EVENT, type RexApi } from "../shared/channels.ts";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: RexApi = {
  docPick: () => ipcRenderer.invoke(COMMAND.docPick),
  docInitial: () => ipcRenderer.invoke(COMMAND.docInitial),
  docOpen: (ref, version) => ipcRenderer.invoke(COMMAND.docOpen, ref, version),
  workspacePick: () => ipcRenderer.invoke(COMMAND.workspacePick),
  workspaceTree: (ref, reveal) => ipcRenderer.invoke(COMMAND.workspaceTree, ref, reveal === true),
  workspaceGraph: (ref) => ipcRenderer.invoke(COMMAND.workspaceGraph, ref),
  workspaceExclude: (request) => ipcRenderer.invoke(COMMAND.workspaceExclude, request),
  workspaceRename: (request) => ipcRenderer.invoke(COMMAND.workspaceRename, request),
  workspaceDelete: (request) => ipcRenderer.invoke(COMMAND.workspaceDelete, request),
  workspaceCreate: (request) => ipcRenderer.invoke(COMMAND.workspaceCreate, request),
  workspaceMove: (request) => ipcRenderer.invoke(COMMAND.workspaceMove, request),
  workspaceSearch: (request) => ipcRenderer.invoke(COMMAND.workspaceSearch, request),
  threadList: (request) => ipcRenderer.invoke(COMMAND.threadList, request),
  threadCreate: (request) => ipcRenderer.invoke(COMMAND.threadCreate, request),
  // Spec 43 §11 — one request object, which is the shape that ends the class of
  // bug this line was fixed for on 2026-09-02: a bridge that forwards fewer
  // arguments than the interface declares still type-checks, because a shorter
  // function is assignable to a longer signature in TypeScript. A dropped field
  // of an object is a type error; a dropped trailing argument was silent.
  threadAsk: (request) => ipcRenderer.invoke(COMMAND.threadAsk, request),
  threadStop: (threadId) => ipcRenderer.invoke(COMMAND.threadStop, threadId),
  threadReply: (request) => ipcRenderer.invoke(COMMAND.threadReply, request),
  threadResolve: (request) => ipcRenderer.invoke(COMMAND.threadResolve, request),
  threadDelete: (threadId) => ipcRenderer.invoke(COMMAND.threadDelete, threadId),
  threadDeleteAll: (request) => ipcRenderer.invoke(COMMAND.threadDeleteAll, request),
  threadSynthesise: (request) => ipcRenderer.invoke(COMMAND.threadSynthesise, request),
  threadApply: (request) => ipcRenderer.invoke(COMMAND.threadApply, request),
  threadNote: (request) => ipcRenderer.invoke(COMMAND.threadNote, request),
  threadDraftSave: (request) => ipcRenderer.invoke(COMMAND.threadDraftSave, request),
  threadPromote: (threadId) => ipcRenderer.invoke(COMMAND.threadPromote, threadId),
  threadRename: (request) => ipcRenderer.invoke(COMMAND.threadRename, request),
  groupList: (request) => ipcRenderer.invoke(COMMAND.groupList, request),
  groupCreate: (request) => ipcRenderer.invoke(COMMAND.groupCreate, request),
  groupUpdate: (request) => ipcRenderer.invoke(COMMAND.groupUpdate, request),
  groupDelete: (request) => ipcRenderer.invoke(COMMAND.groupDelete, request),
  commentsMove: (request) => ipcRenderer.invoke(COMMAND.commentsMove, request),
  applyConfirm: (request) => ipcRenderer.invoke(COMMAND.applyConfirm, request),
  workList: () => ipcRenderer.invoke(COMMAND.workList),
  workApprove: (documentId) => ipcRenderer.invoke(COMMAND.workApprove, documentId),
  workDiscard: (documentId) => ipcRenderer.invoke(COMMAND.workDiscard, documentId),
  workUndo: (documentId) => ipcRenderer.invoke(COMMAND.workUndo, documentId),
  anchorRestate: (request) => ipcRenderer.invoke(COMMAND.anchorRestate, request),
  debugCopy: (threadId) => ipcRenderer.invoke(COMMAND.debugCopy, threadId),
  debugSnapshot: (view) => ipcRenderer.invoke(COMMAND.debugSnapshot, view),
  modelList: (gatewayId, sdk) =>
    ipcRenderer.invoke(COMMAND.modelList, gatewayId ?? null, sdk ?? null),
  gatewayDescribe: () => ipcRenderer.invoke(COMMAND.gatewayDescribe),
  gatewayList: () => ipcRenderer.invoke(COMMAND.gatewayList),
  gatewaySave: (draft) => ipcRenderer.invoke(COMMAND.gatewaySave, draft),
  gatewayDelete: (gatewayId) => ipcRenderer.invoke(COMMAND.gatewayDelete, gatewayId),
  gatewayVerify: (request) => ipcRenderer.invoke(COMMAND.gatewayVerify, request),
  gatewayTest: (request) => ipcRenderer.invoke(COMMAND.gatewayTest, request),
  gatewayDefault: (choice) => ipcRenderer.invoke(COMMAND.gatewayDefault, choice),
  gatewayHasEnv: (name) => ipcRenderer.invoke(COMMAND.gatewayHasEnv, name),
  // Spec 46 §12. **There is no `gatewaySecretGet`, and there never will be**:
  // a key goes in and a boolean comes back, so the renderer cannot ask for one
  // even by mistake. Everything exposed here is reachable by document content.
  gatewayBuiltinState: () => ipcRenderer.invoke(COMMAND.gatewayBuiltinState),
  gatewayRetiredSeen: () => ipcRenderer.invoke(COMMAND.gatewayRetiredSeen),
  gatewayBuiltinEnable: (enabled) => ipcRenderer.invoke(COMMAND.gatewayBuiltinEnable, enabled),
  gatewayProviderCatalogue: () => ipcRenderer.invoke(COMMAND.gatewayProviderCatalogue),
  gatewayRemoteModels: (id) => ipcRenderer.invoke(COMMAND.gatewayRemoteModels, id),
  gatewayProviderList: () => ipcRenderer.invoke(COMMAND.gatewayProviderList),
  gatewayProviderSave: (draft) => ipcRenderer.invoke(COMMAND.gatewayProviderSave, draft),
  gatewayProviderRemove: (id) => ipcRenderer.invoke(COMMAND.gatewayProviderRemove, id),
  gatewayProviderDiscover: (id) => ipcRenderer.invoke(COMMAND.gatewayProviderDiscover, id),
  gatewayModelsSave: (request) => ipcRenderer.invoke(COMMAND.gatewayModelsSave, request),
  gatewaySecretSet: (secret) => ipcRenderer.invoke(COMMAND.gatewaySecretSet, secret),
  gatewaySecretClear: (id) => ipcRenderer.invoke(COMMAND.gatewaySecretClear, id),
  gatewayStorageHealth: () => ipcRenderer.invoke(COMMAND.gatewayStorageHealth),
  gatewayTraffic: (threadId) => ipcRenderer.invoke(COMMAND.gatewayTraffic, threadId),
  gatewayTrafficSize: () => ipcRenderer.invoke(COMMAND.gatewayTrafficSize),
  gatewayTrafficClear: () => ipcRenderer.invoke(COMMAND.gatewayTrafficClear),
  gatewayTrafficBodies: (capture) => ipcRenderer.invoke(COMMAND.gatewayTrafficBodies, capture),
  paperView: () => ipcRenderer.invoke(COMMAND.paperView),
  paperViewSet: (view) => ipcRenderer.invoke(COMMAND.paperViewSet, view),
  renderResult: (request) => ipcRenderer.invoke(COMMAND.renderResult, request),

  onStreamStep: (listener) => subscribe(EVENT.streamStep, listener),
  onStreamCost: (listener) => subscribe(EVENT.streamCost, listener),
  onApplyReady: (listener) => subscribe(EVENT.applyReady, listener),
  onRenderRequest: (listener) => subscribe(EVENT.renderRequest, listener),
};

contextBridge.exposeInMainWorld("rex", api);
