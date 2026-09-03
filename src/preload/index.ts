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
  workspaceSearch: (request) => ipcRenderer.invoke(COMMAND.workspaceSearch, request),
  threadList: (request) => ipcRenderer.invoke(COMMAND.threadList, request),
  threadCreate: (request) => ipcRenderer.invoke(COMMAND.threadCreate, request),
  // Spec 31 §4 — every argument, spelled out. A bridge that forwards fewer
  // than the interface declares still type-checks: a shorter function is
  // assignable to a longer signature in TypeScript, so a dropped trailing
  // argument is silent here and arrives as `undefined` in main. Measured
  // 2026-09-02, when the style reached this line and went no further.
  threadAsk: (threadId, model, style) =>
    ipcRenderer.invoke(COMMAND.threadAsk, threadId, model, style),
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
  modelList: () => ipcRenderer.invoke(COMMAND.modelList),
  modelDefault: (value) => ipcRenderer.invoke(COMMAND.modelDefault, value),
  paperView: () => ipcRenderer.invoke(COMMAND.paperView),
  paperViewSet: (view) => ipcRenderer.invoke(COMMAND.paperViewSet, view),
  renderResult: (request) => ipcRenderer.invoke(COMMAND.renderResult, request),

  onStreamStep: (listener) => subscribe(EVENT.streamStep, listener),
  onStreamCost: (listener) => subscribe(EVENT.streamCost, listener),
  onApplyReady: (listener) => subscribe(EVENT.applyReady, listener),
  onRenderRequest: (listener) => subscribe(EVENT.renderRequest, listener),
};

contextBridge.exposeInMainWorld("rex", api);
