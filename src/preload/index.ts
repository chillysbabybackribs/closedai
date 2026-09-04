import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ClosedaiApi } from '../shared/api.js'
import { IPC, type IpcEventChannel, type IpcEventChannels, type IpcInvokeChannel, type IpcInvokeChannels } from '../shared/ipc-channels.js'
import type { BrowserBounds } from '../shared/types.js'

function invoke<C extends IpcInvokeChannel>(
  channel: C,
  ...args: IpcInvokeChannels[C]['args']
): Promise<IpcInvokeChannels[C]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}

function subscribe<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventChannels[C]) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: IpcEventChannels[C]): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: ClosedaiApi = {
  window: {
    minimize: () => invoke(IPC.invoke.window.minimize),
    maximize: () => invoke(IPC.invoke.window.maximize),
    close: () => invoke(IPC.invoke.window.close)
  },
  browser: {
    setBounds: (bounds: BrowserBounds) => invoke(IPC.invoke.browser.setBounds, bounds),
    navigate: (input: string) => invoke(IPC.invoke.browser.navigate, input),
    back: () => invoke(IPC.invoke.browser.back),
    forward: () => invoke(IPC.invoke.browser.forward),
    reload: () => invoke(IPC.invoke.browser.reload),
    searchHistory: (input: string) => invoke(IPC.invoke.browser.searchHistory, input),
    removeHistory: (url: string) => invoke(IPC.invoke.browser.removeHistory, url),
    suggest: (input: string) => invoke(IPC.invoke.browser.suggest, input),
    snapshot: () => invoke(IPC.invoke.browser.snapshot),
    newTab: () => invoke(IPC.invoke.browser.newTab),
    newTabToRight: (id: string) => invoke(IPC.invoke.browser.newTabToRight, id),
    openTab: (input: string) => invoke(IPC.invoke.browser.openTab, input),
    closeTab: (id: string) => invoke(IPC.invoke.browser.closeTab, id),
    closeOtherTabs: (id: string) => invoke(IPC.invoke.browser.closeOtherTabs, id),
    closeTabsToRight: (id: string) => invoke(IPC.invoke.browser.closeTabsToRight, id),
    duplicateTab: (id: string) => invoke(IPC.invoke.browser.duplicateTab, id),
    reloadTab: (id: string) => invoke(IPC.invoke.browser.reloadTab, id),
    renameTab: (id: string, title: string | null) => invoke(IPC.invoke.browser.renameTab, id, title),
    selectTab: (id: string) => invoke(IPC.invoke.browser.selectTab, id),
    capture: () => invoke(IPC.invoke.browser.capture),
    onState: (listener) => subscribe(IPC.event.browserState, listener),
    onTabs: (listener) => subscribe(IPC.event.browserTabs, listener)
  },
  browserDownloads: {
    list: () => invoke(IPC.invoke.browserDownloads.list),
    pause: (id: string) => invoke(IPC.invoke.browserDownloads.pause, id),
    resume: (id: string) => invoke(IPC.invoke.browserDownloads.resume, id),
    cancel: (id: string) => invoke(IPC.invoke.browserDownloads.cancel, id),
    reveal: (id: string) => invoke(IPC.invoke.browserDownloads.reveal, id),
    clear: () => invoke(IPC.invoke.browserDownloads.clear),
    onChanged: (listener) => subscribe(IPC.event.browserDownloadsChanged, listener)
  },
  chat: {
    snapshot: () => invoke(IPC.invoke.chat.snapshot),
    historyPage: (paneId, threadId, beforeItemId) => invoke(IPC.invoke.chat.historyPage, paneId, threadId, beforeItemId),
    send: (paneId, text, attachments) => invoke(IPC.invoke.chat.send, paneId, text, attachments),
    attachmentPath: (file) => webUtils.getPathForFile(file),
    interrupt: (paneId) => invoke(IPC.invoke.chat.interrupt, paneId),
    selectPane: (paneId) => invoke(IPC.invoke.chat.selectPane, paneId),
    setVisiblePanes: (cwd, paneIds) => invoke(IPC.invoke.chat.setVisiblePanes, cwd, paneIds),
    selectModel: (paneId, modelId) => invoke(IPC.invoke.chat.selectModel, paneId, modelId),
    selectReasoningEffort: (paneId, effort) => invoke(IPC.invoke.chat.selectReasoningEffort, paneId, effort),
    refreshPlanUsage: (paneId) => invoke(IPC.invoke.chat.refreshPlanUsage, paneId),
    loginWithChatGPT: () => invoke(IPC.invoke.chat.login),
    listChats: () => invoke(IPC.invoke.chat.listChats),
    newPeer: () => invoke(IPC.invoke.chat.newPeer),
    closePeer: (paneId) => invoke(IPC.invoke.chat.closePeer, paneId),
    continueInNewPeer: (source, modelId) => invoke(IPC.invoke.chat.continueInNewPeer, source, modelId),
    openChat: (chatId) => invoke(IPC.invoke.chat.openChat, chatId),
    archiveChat: (chatId) => invoke(IPC.invoke.chat.archiveChat, chatId),
    setChatPinned: (chatId, pinned) => invoke(IPC.invoke.chat.setChatPinned, chatId, pinned),
    compactConversation: (paneId) => invoke(IPC.invoke.chat.compactConversation, paneId),
    chooseProject: () => invoke(IPC.invoke.chat.chooseProject),
    selectProject: (projectPath) => invoke(IPC.invoke.chat.selectProject, projectPath),
    clearProject: () => invoke(IPC.invoke.chat.clearProject),
    onEvent: (listener) => subscribe(IPC.event.chatEvent, listener)
  },
  tools: {
    manifest: () => invoke(IPC.invoke.tools.manifest),
    telemetry: () => invoke(IPC.invoke.tools.telemetry),
    clearTelemetry: () => invoke(IPC.invoke.tools.clearTelemetry),
    setEnabled: (toolId: string, enabled: boolean) => invoke(IPC.invoke.tools.setEnabled, toolId, enabled),
    onEvent: (listener) => subscribe(IPC.event.toolsEvent, listener)
  },
  trace: {
    setActive: (active: boolean) => invoke(IPC.invoke.trace.setActive, active),
    snapshot: () => invoke(IPC.invoke.trace.snapshot),
    clear: () => invoke(IPC.invoke.trace.clear),
    onEvent: (listener) => subscribe(IPC.event.traceEvent, listener)
  }
}

contextBridge.exposeInMainWorld('closedai', api)
