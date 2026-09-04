import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ClosedaiApi } from '../shared/api.js'
import type { ChatWorkspaceEvent } from '../shared/chat-peers.js'
import type { ToolsEvent } from '../shared/tools.js'
import type { TraceEvent } from '../shared/trace.js'
import type { BrowserBounds, BrowserDownload, BrowserState, BrowserTabInfo } from '../shared/types.js'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: ClosedaiApi = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  browser: {
    setBounds: (bounds: BrowserBounds) => ipcRenderer.invoke('browser:setBounds', bounds),
    navigate: (input: string) => ipcRenderer.invoke('browser:navigate', input),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    searchHistory: (input: string) => ipcRenderer.invoke('browser:searchHistory', input),
    removeHistory: (url: string) => ipcRenderer.invoke('browser:removeHistory', url),
    suggest: (input: string) => ipcRenderer.invoke('browser:suggest', input),
    snapshot: () => ipcRenderer.invoke('browser:snapshot'),
    newTab: () => ipcRenderer.invoke('browser:newTab'),
    openTab: (input: string) => ipcRenderer.invoke('browser:openTab', input),
    closeTab: (id: string) => ipcRenderer.invoke('browser:closeTab', id),
    selectTab: (id: string) => ipcRenderer.invoke('browser:selectTab', id),
    capture: () => ipcRenderer.invoke('browser:capture'),
    onState: (listener) => subscribe<BrowserState>('browser:state', listener),
    onTabs: (listener) => subscribe<BrowserTabInfo[]>('browser:tabs', listener)
  },
  browserDownloads: {
    list: () => ipcRenderer.invoke('browserDownloads:list'),
    pause: (id: string) => ipcRenderer.invoke('browserDownloads:pause', id),
    resume: (id: string) => ipcRenderer.invoke('browserDownloads:resume', id),
    cancel: (id: string) => ipcRenderer.invoke('browserDownloads:cancel', id),
    reveal: (id: string) => ipcRenderer.invoke('browserDownloads:reveal', id),
    clear: () => ipcRenderer.invoke('browserDownloads:clear'),
    onChanged: (listener) => subscribe<BrowserDownload[]>('browserDownloads:changed', listener)
  },
  chat: {
    snapshot: () => ipcRenderer.invoke('chat:snapshot'),
    historyPage: (paneId, threadId, beforeItemId) => ipcRenderer.invoke('chat:historyPage', paneId, threadId, beforeItemId),
    send: (paneId, text, attachments) => ipcRenderer.invoke('chat:send', paneId, text, attachments),
    attachmentPath: (file) => webUtils.getPathForFile(file),
    interrupt: (paneId) => ipcRenderer.invoke('chat:interrupt', paneId),
    selectPane: (paneId) => ipcRenderer.invoke('chat:selectPane', paneId),
    selectModel: (paneId, modelId) => ipcRenderer.invoke('chat:selectModel', paneId, modelId),
    selectReasoningEffort: (paneId, effort) => ipcRenderer.invoke('chat:selectReasoningEffort', paneId, effort),
    refreshPlanUsage: (paneId) => ipcRenderer.invoke('chat:refreshPlanUsage', paneId),
    loginWithChatGPT: () => ipcRenderer.invoke('chat:login'),
    listThreads: () => ipcRenderer.invoke('chat:listThreads'),
    newPeer: () => ipcRenderer.invoke('chat:newPeer'),
    closePeer: (paneId) => ipcRenderer.invoke('chat:closePeer', paneId),
    continueInNewPeer: (source, modelId) => ipcRenderer.invoke('chat:continueInNewPeer', source, modelId),
    openThread: (paneId, threadId) => ipcRenderer.invoke('chat:openThread', paneId, threadId),
    archiveThread: (threadId: string) => ipcRenderer.invoke('chat:archiveThread', threadId),
    chooseProject: () => ipcRenderer.invoke('chat:chooseProject'),
    selectProject: (projectPath) => ipcRenderer.invoke('chat:selectProject', projectPath),
    clearProject: () => ipcRenderer.invoke('chat:clearProject'),
    onEvent: (listener) => subscribe<ChatWorkspaceEvent>('chat:event', listener)
  },
  tools: {
    manifest: () => ipcRenderer.invoke('tools:manifest'),
    telemetry: () => ipcRenderer.invoke('tools:telemetry'),
    clearTelemetry: () => ipcRenderer.invoke('tools:clearTelemetry'),
    setEnabled: (toolId: string, enabled: boolean) => ipcRenderer.invoke('tools:setEnabled', toolId, enabled),
    onEvent: (listener) => subscribe<ToolsEvent>('tools:event', listener)
  },
  trace: {
    setActive: (active: boolean) => ipcRenderer.invoke('trace:setActive', active),
    snapshot: () => ipcRenderer.invoke('trace:snapshot'),
    clear: () => ipcRenderer.invoke('trace:clear'),
    onEvent: (listener) => subscribe<TraceEvent>('trace:event', listener)
  }
}

contextBridge.exposeInMainWorld('closedai', api)
