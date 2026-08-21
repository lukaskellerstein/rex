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
  docOpen: (ref) => ipcRenderer.invoke(COMMAND.docOpen, ref),
  workspacePick: () => ipcRenderer.invoke(COMMAND.workspacePick),
  workspaceTree: (ref) => ipcRenderer.invoke(COMMAND.workspaceTree, ref),
  workspaceGraph: (ref) => ipcRenderer.invoke(COMMAND.workspaceGraph, ref),
  threadList: (request) => ipcRenderer.invoke(COMMAND.threadList, request),
  threadCreate: (request) => ipcRenderer.invoke(COMMAND.threadCreate, request),
  threadAsk: (threadId) => ipcRenderer.invoke(COMMAND.threadAsk, threadId),
  threadReply: (request) => ipcRenderer.invoke(COMMAND.threadReply, request),
  threadResolve: (request) => ipcRenderer.invoke(COMMAND.threadResolve, request),
  threadSynthesise: (request) => ipcRenderer.invoke(COMMAND.threadSynthesise, request),
  threadApply: (threadId) => ipcRenderer.invoke(COMMAND.threadApply, threadId),
  applyConfirm: (request) => ipcRenderer.invoke(COMMAND.applyConfirm, request),
  anchorRestate: (request) => ipcRenderer.invoke(COMMAND.anchorRestate, request),

  factsStatus: (request) => ipcRenderer.invoke(COMMAND.factsStatus, request),
  factsBuild: (request) => ipcRenderer.invoke(COMMAND.factsBuild, request),
  factsCancel: (runId) => ipcRenderer.invoke(COMMAND.factsCancel, runId),
  factsFindings: (request) => ipcRenderer.invoke(COMMAND.factsFindings, request),
  factsGraph: (request) => ipcRenderer.invoke(COMMAND.factsGraph, request),
  factsVerdict: (request) => ipcRenderer.invoke(COMMAND.factsVerdict, request),
  factsComment: (request) => ipcRenderer.invoke(COMMAND.factsComment, request),
  factsEvidence: (request) => ipcRenderer.invoke(COMMAND.factsEvidence, request),

  onStreamStep: (listener) => subscribe(EVENT.streamStep, listener),
  onStreamCost: (listener) => subscribe(EVENT.streamCost, listener),
  onApplyReady: (listener) => subscribe(EVENT.applyReady, listener),
  onFactsProgress: (listener) => subscribe(EVENT.factsProgress, listener),
};

contextBridge.exposeInMainWorld("rex", api);
