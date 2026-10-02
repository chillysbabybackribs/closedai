import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ClosedaiApi } from '../shared/api.js'
import { IPC, type IpcEventChannel, type IpcEventChannels, type IpcInvokeChannel, type IpcInvokeChannels } from '../shared/ipc-channels.js'
import type { ProfileBootstrap, ProfileWriteResult } from '../shared/local-profiles.js'
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
  localFiles: {
    listDirectory: (root, directory) => invoke(IPC.invoke.localFiles.listDirectory, root, directory),
    open: (href, options) => invoke(IPC.invoke.localFiles.open, href, options),
    preview: (href, options) => invoke(IPC.invoke.localFiles.preview, href, options),
    readPreview: (path) => invoke(IPC.invoke.localFiles.readPreview, path),
    revealPath: (path) => invoke(IPC.invoke.localFiles.revealPath, path),
    openImage: (image) => invoke(IPC.invoke.localFiles.openImage, image),
    image: (id) => invoke(IPC.invoke.localFiles.image, id),
    revealImage: (id) => invoke(IPC.invoke.localFiles.revealImage, id),
    video: (id) => invoke(IPC.invoke.localFiles.video, id),
    revealVideo: (id) => invoke(IPC.invoke.localFiles.revealVideo, id),
    file: (id) => invoke(IPC.invoke.localFiles.file, id),
    revealFile: (id) => invoke(IPC.invoke.localFiles.revealFile, id),
    setView: (id, view) => invoke(IPC.invoke.localFiles.setView, id, view),
    searchVideos: (query) => invoke(IPC.invoke.localFiles.searchVideos, query),
    videoRecents: () => invoke(IPC.invoke.localFiles.videoRecents),
    pickVideo: () => invoke(IPC.invoke.localFiles.pickVideo)
  },
  window: {
    minimize: () => invoke(IPC.invoke.window.minimize),
    maximize: () => invoke(IPC.invoke.window.maximize),
    toggleFullscreen: () => invoke(IPC.invoke.window.toggleFullscreen),
    close: () => invoke(IPC.invoke.window.close),
    toggleDevTools: () => invoke(IPC.invoke.window.toggleDevTools),
    desktopWallpaper: () => invoke(IPC.invoke.window.desktopWallpaper)
  },
  wallpapers: {
    list: () => invoke(IPC.invoke.wallpapers.list),
    add: (draft) => invoke(IPC.invoke.wallpapers.add, draft),
    read: (id) => invoke(IPC.invoke.wallpapers.read, id),
    remove: (id) => invoke(IPC.invoke.wallpapers.remove, id)
  },
  profiles: {
    bootstrap: () => ipcRenderer.sendSync(IPC.sync.profiles.bootstrap) as ProfileBootstrap,
    write: (onboarding) => ipcRenderer.sendSync(IPC.sync.profiles.write, onboarding) as ProfileWriteResult,
    switchTo: (userId) => invoke(IPC.invoke.profiles.switchTo, userId),
    remove: (userId) => invoke(IPC.invoke.profiles.remove, userId)
  },
  windows: {
    context: () => invoke(IPC.invoke.windows.context),
    list: () => invoke(IPC.invoke.windows.list),
    detachTabs: (cwd, tabIds) => invoke(IPC.invoke.windows.detachTabs, cwd, tabIds),
    returnTabs: (tabIds) => invoke(IPC.invoke.windows.returnTabs, tabIds),
    revealTab: (tabId) => invoke(IPC.invoke.windows.revealTab, tabId),
    showBrowser: () => invoke(IPC.invoke.windows.showBrowser),
    capture: (region) => invoke(IPC.invoke.windows.capture, region),
    reportDockSurface: (region) => invoke(IPC.invoke.windows.reportDockSurface, region),
    routeCrossDock: (request) => invoke(IPC.invoke.windows.routeCrossDock, request),
    completeCrossDock: (payload) => invoke(IPC.invoke.windows.completeCrossDock, payload),
    onEvent: (listener) => subscribe(IPC.event.windowsEvent, listener)
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
    openVideoHub: () => invoke(IPC.invoke.browser.openVideoHub),
    videoCompare: (command) => invoke(IPC.invoke.browser.videoCompare, command),
    resolvePermission: (id, decision) => invoke(IPC.invoke.browser.resolvePermission, id, decision),
    onState: (listener) => subscribe(IPC.event.browserState, listener),
    onTabs: (listener) => subscribe(IPC.event.browserTabs, listener),
    onPermissionRequests: (listener) => subscribe(IPC.event.browserPermissionRequests, listener)
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
  savedSites: {
    list: () => invoke(IPC.invoke.savedSites.list),
    save: (draft) => invoke(IPC.invoke.savedSites.save, draft),
    update: (id, patch) => invoke(IPC.invoke.savedSites.update, id, patch),
    remove: (id) => invoke(IPC.invoke.savedSites.remove, id),
    onChanged: (listener) => subscribe(IPC.event.savedSitesChanged, listener)
  },
  notes: {
    list: () => invoke(IPC.invoke.notes.list),
    read: (id) => invoke(IPC.invoke.notes.read, id),
    create: (text) => invoke(IPC.invoke.notes.create, text),
    save: (id, text, baseRevision) => invoke(IPC.invoke.notes.save, id, text, baseRevision),
    rename: (id, title) => invoke(IPC.invoke.notes.rename, id, title),
    remove: (id) => invoke(IPC.invoke.notes.remove, id),
    bind: (binding) => invoke(IPC.invoke.notes.bind, binding),
    unbind: (chatPaneId) => invoke(IPC.invoke.notes.unbind, chatPaneId),
    onChanged: (listener) => subscribe(IPC.event.notesChanged, listener)
  },
  chat: {
    snapshot: () => invoke(IPC.invoke.chat.snapshot),
    historyPage: (paneId, threadId, beforeItemId) => invoke(IPC.invoke.chat.historyPage, paneId, threadId, beforeItemId),
    send: (paneId, text, attachments) => invoke(IPC.invoke.chat.send, paneId, text, attachments),
    attachmentPath: (file) => webUtils.getPathForFile(file),
    interrupt: (paneId) => invoke(IPC.invoke.chat.interrupt, paneId),
    selectPane: (paneId) => invoke(IPC.invoke.chat.selectPane, paneId),
    setVisiblePanes: (cwd, paneIds, retainedTabIds) => invoke(IPC.invoke.chat.setVisiblePanes, cwd, paneIds, retainedTabIds),
    selectModel: (paneId, modelId) => invoke(IPC.invoke.chat.selectModel, paneId, modelId),
    selectReasoningEffort: (paneId, effort) => invoke(IPC.invoke.chat.selectReasoningEffort, paneId, effort),
    readProviderUsage: (provider) => invoke(IPC.invoke.chat.readProviderUsage, provider),
    refreshPlanUsage: (paneId, onlyIfAwake) => invoke(IPC.invoke.chat.refreshPlanUsage, paneId, onlyIfAwake),
    loginWithChatGPT: () => invoke(IPC.invoke.chat.login),
    listChats: () => invoke(IPC.invoke.chat.listChats),
    newPeer: (anchorPaneId, options) => invoke(IPC.invoke.chat.newPeer, anchorPaneId, options),
    closePeer: (paneId) => invoke(IPC.invoke.chat.closePeer, paneId),
    continueInNewPeer: (source, modelId) => invoke(IPC.invoke.chat.continueInNewPeer, source, modelId),
    openChat: (chatId) => invoke(IPC.invoke.chat.openChat, chatId),
    archiveChat: (chatId) => invoke(IPC.invoke.chat.archiveChat, chatId),
    unarchiveChat: (chatId) => invoke(IPC.invoke.chat.unarchiveChat, chatId),
    setChatPinned: (chatId, pinned) => invoke(IPC.invoke.chat.setChatPinned, chatId, pinned),
    renameChat: (chatId, title) => invoke(IPC.invoke.chat.renameChat, chatId, title),
    retryChatTitle: (chatId) => invoke(IPC.invoke.chat.retryChatTitle, chatId),
    compactConversation: (paneId) => invoke(IPC.invoke.chat.compactConversation, paneId),
    chooseProject: (paneId) => invoke(IPC.invoke.chat.chooseProject, paneId),
    selectProject: (paneId, projectPath) => invoke(IPC.invoke.chat.selectProject, paneId, projectPath),
    clearProject: (paneId) => invoke(IPC.invoke.chat.clearProject, paneId),
    selectSpace: (projectPath) => invoke(IPC.invoke.chat.selectSpace, projectPath),
    providerAvailability: () => invoke(IPC.invoke.chat.providerAvailability),
    providerOnboarding: () => invoke(IPC.invoke.chat.providerOnboarding),
    providerSignIn: (provider) => invoke(IPC.invoke.chat.providerSignIn, provider),
    onEvent: (listener) => subscribe(IPC.event.chatEvent, listener)
  },
  agentRuns: {
    list: () => invoke(IPC.invoke.agentRuns.list),
    start: (chatId, options) => invoke(IPC.invoke.agentRuns.start, chatId, options),
    pause: (chatId) => invoke(IPC.invoke.agentRuns.pause, chatId),
    resume: (chatId) => invoke(IPC.invoke.agentRuns.resume, chatId),
    stop: (chatId) => invoke(IPC.invoke.agentRuns.stop, chatId),
    onEvent: (listener) => subscribe(IPC.event.agentRunsEvent, listener)
  },
  agentLibrary: {
    list: () => invoke(IPC.invoke.agentLibrary.list),
    save: (draft) => invoke(IPC.invoke.agentLibrary.save, draft),
    update: (id, patch) => invoke(IPC.invoke.agentLibrary.update, id, patch),
    remove: (id) => invoke(IPC.invoke.agentLibrary.remove, id),
    onChanged: (listener) => subscribe(IPC.event.agentLibraryChanged, listener)
  },
  credentials: {
    status: () => invoke(IPC.invoke.credentials.status),
    list: () => invoke(IPC.invoke.credentials.list),
    save: (draft) => invoke(IPC.invoke.credentials.save, draft),
    reveal: (id: string, fieldId: string) => invoke(IPC.invoke.credentials.reveal, id, fieldId),
    remove: (id: string) => invoke(IPC.invoke.credentials.remove, id),
    rename: (id: string, label: string) => invoke(IPC.invoke.credentials.rename, id, label),
    setAgentAccess: (id, allowed) => invoke(IPC.invoke.credentials.setAgentAccess, id, allowed)
  },
  security: {
    get: () => invoke(IPC.invoke.security.get),
    set: (patch) => invoke(IPC.invoke.security.set, patch),
    importCookies: () => invoke(IPC.invoke.security.importCookies),
    resolveCredentialApproval: (id, decision) => invoke(IPC.invoke.security.resolveCredentialApproval, id, decision),
    onCredentialApprovals: (listener) => subscribe(IPC.event.securityCredentialApprovals, listener)
  },
  tools: {
    manifest: () => invoke(IPC.invoke.tools.manifest),
    telemetry: () => invoke(IPC.invoke.tools.telemetry),
    clearTelemetry: () => invoke(IPC.invoke.tools.clearTelemetry),
    setEnabled: (toolId: string, enabled: boolean) => invoke(IPC.invoke.tools.setEnabled, toolId, enabled),
    setEnabledMany: (switches) => invoke(IPC.invoke.tools.setEnabledMany, switches),
    setChatToolSliceEnabled: (enabled: boolean) => invoke(IPC.invoke.tools.setChatToolSliceEnabled, enabled),
    setChatWorkspaceLedgerEnabled: (enabled: boolean) => invoke(IPC.invoke.tools.setChatWorkspaceLedgerEnabled, enabled),
    onEvent: (listener) => subscribe(IPC.event.toolsEvent, listener)
  },
  models: {
    manifest: () => invoke(IPC.invoke.models.manifest),
    setEnabled: (modelId: string, enabled: boolean) => invoke(IPC.invoke.models.setEnabled, modelId, enabled),
    setEnabledMany: (switches) => invoke(IPC.invoke.models.setEnabledMany, switches),
    onEvent: (listener) => subscribe(IPC.event.modelsEvent, listener)
  },
  trace: {
    setActive: (active: boolean) => invoke(IPC.invoke.trace.setActive, active),
    snapshot: (options) => invoke(IPC.invoke.trace.snapshot, options),
    clear: () => invoke(IPC.invoke.trace.clear),
    onEvent: (listener) => subscribe(IPC.event.traceEvent, listener)
  }
}

contextBridge.exposeInMainWorld('closedai', api)
