import type { AgentRun, AgentRunStartOptions, AgentRunsEvent } from './agent-runs.js'
import type { SavedAgent, SavedAgentDraft, SavedAgentPatch } from './agent-library.js'
import type { BrowserHistoryMatch } from './browser-history.js'
import type { BrowserBounds, BrowserDownload, BrowserShot, BrowserState, BrowserTabInfo } from './types.js'
import type { SavedSite, SavedSiteDraft, SavedSitePatch } from './saved-sites.js'
import type { NoteChange, NoteDoc, NoteMeta, NoteSaveResult, NotepadBinding } from './notes.js'
import type { ChatAttachment, ChatHistoryPage, ChatProvider } from './chat.js'
import type { ProviderOnboardingStatus } from './provider-onboarding.js'
import type {
  ChatContinuationSource, ChatNewPeerOptions, ChatPaneId, ChatRowSummary, ChatWorkspaceEvent, ChatWorkspaceSnapshot
} from './chat-peers.js'
import type { CredentialDraft, CredentialSummary, CredentialVaultStatus } from './credentials.js'
import type { ModelManifest, ModelSwitch, ModelsEvent } from './model-settings.js'
import type { ToolManifest, ToolSwitch, ToolTelemetrySnapshot, ToolsEvent } from './tools.js'
import type { TraceEvent, TraceSnapshot, TraceSnapshotOptions } from './trace.js'
import type { ProviderAvailability } from './provider-availability.js'
import type { AppWindowContext, AppWindowId, AppWindowInfo, AppWindowRegion, AppWindowsEvent } from './app-windows.js'
import type { QuickChatOverlayRequest, QuickChatOverlaySize, QuickChatOverlayState, QuickChatOverlayView } from './quick-chat-overlay.js'
import type {
  BrowserCookieImportResult, CredentialApprovalRequest, SecurityDecision, SecuritySettings, WebPermissionRequest
} from './security.js'

/** Invoke channels the preload bridge exposes on `window.closedai`. */
export type IpcInvokeChannels = {
  'localFiles:open': { args: [string, import('./local-files.js').LocalFileOpenOptions?]; result: import('./local-files.js').LocalFileResult }
  'localFiles:openImage': { args: [{ name: string; src: string }]; result: string }
  'localFiles:image': { args: [string]; result: import('./local-files.js').ImageTabContent }
  'localFiles:revealImage': { args: [string]; result: void }
  'localFiles:file': { args: [string]; result: import('./local-files.js').FileTabContent }
  'localFiles:revealFile': { args: [string]; result: void }
  'localFiles:setView': { args: [string, import('./local-files.js').FileView]; result: void }
  'window:minimize': { args: []; result: void }
  'window:maximize': { args: []; result: void }
  'window:toggleFullscreen': { args: []; result: void }
  'window:close': { args: []; result: void }
  'window:toggleDevTools': { args: []; result: void }
  'window:desktopWallpaper': { args: []; result: import('./desktop-wallpaper.js').DesktopWallpaper | null }
  'wallpapers:list': { args: []; result: import('./wallpaper-uploads.js').WallpaperUpload[] }
  'wallpapers:add': { args: [import('./wallpaper-uploads.js').WallpaperUploadDraft]; result: import('./wallpaper-uploads.js').WallpaperUpload }
  'wallpapers:read': { args: [string]; result: import('./desktop-wallpaper.js').DesktopWallpaper | null }
  'wallpapers:remove': { args: [string]; result: void }
  'profiles:switchTo': { args: [string]; result: boolean }
  'profiles:remove': { args: [string]; result: import('./local-profiles.js').ProfileRemoveResult }
  'windows:context': { args: []; result: AppWindowContext }
  'windows:list': { args: []; result: AppWindowInfo[] }
  'windows:detachTabs': { args: [string, string[]]; result: AppWindowId }
  'windows:returnTabs': { args: [string[]]; result: void }
  'windows:revealTab': { args: [string]; result: boolean }
  'windows:showBrowser': { args: []; result: void }
  'windows:capture': { args: [AppWindowRegion]; result: string | null }
  'windows:reportDockSurface': { args: [AppWindowRegion | null]; result: void }
  'windows:routeCrossDock': { args: [import('./cross-window-dock.js').CrossWindowDockRouteRequest]; result: import('./cross-window-dock.js').CrossWindowDockRouteResult }
  'windows:completeCrossDock': { args: [import('./cross-window-dock.js').CrossWindowDockComplete]; result: void }
  'quickChat:setState': { args: [QuickChatOverlayState]; result: void }
  'quickChat:view': { args: []; result: QuickChatOverlayView | null }
  'quickChat:setSize': { args: [QuickChatOverlaySize]; result: void }
  'quickChat:request': { args: [QuickChatOverlayRequest]; result: void }
  'browser:setBounds': { args: [BrowserBounds]; result: void }
  'browser:navigate': { args: [string]; result: void }
  'browser:back': { args: []; result: void }
  'browser:forward': { args: []; result: void }
  'browser:reload': { args: []; result: void }
  'browser:searchHistory': { args: [string]; result: BrowserHistoryMatch[] }
  'browser:removeHistory': { args: [string]; result: void }
  'browser:suggest': { args: [string]; result: { completion: string; url: string } | null }
  'browser:snapshot': { args: []; result: { state: BrowserState; tabs: BrowserTabInfo[] } | null }
  'browser:newTab': { args: []; result: void }
  'browser:newTabToRight': { args: [string]; result: void }
  'browser:openTab': { args: [string]; result: void }
  'browser:closeTab': { args: [string]; result: void }
  'browser:closeOtherTabs': { args: [string]; result: void }
  'browser:closeTabsToRight': { args: [string]; result: void }
  'browser:duplicateTab': { args: [string]; result: void }
  'browser:reloadTab': { args: [string]; result: void }
  'browser:renameTab': { args: [string, string | null]; result: void }
  'browser:selectTab': { args: [string]; result: void }
  'browser:capture': { args: []; result: BrowserShot | null }
  'browser:resolvePermission': { args: [string, SecurityDecision]; result: void }
  'browserDownloads:list': { args: []; result: BrowserDownload[] }
  'browserDownloads:pause': { args: [string]; result: void }
  'browserDownloads:resume': { args: [string]; result: void }
  'browserDownloads:cancel': { args: [string]; result: void }
  'browserDownloads:reveal': { args: [string]; result: void }
  'browserDownloads:clear': { args: []; result: void }
  'savedSites:list': { args: []; result: SavedSite[] }
  'savedSites:save': { args: [SavedSiteDraft]; result: SavedSite }
  'savedSites:update': { args: [string, SavedSitePatch]; result: SavedSite | null }
  'savedSites:remove': { args: [string]; result: void }
  'notes:list': { args: []; result: NoteMeta[] }
  'notes:read': { args: [string]; result: NoteDoc | null }
  'notes:create': { args: [string]; result: NoteDoc }
  'notes:save': { args: [string, string, number]; result: NoteSaveResult }
  'notes:rename': { args: [string, string | null]; result: NoteMeta }
  'notes:remove': { args: [string]; result: void }
  'notes:bind': { args: [NotepadBinding]; result: void }
  'notes:unbind': { args: [string]; result: void }
  'chat:snapshot': { args: []; result: ChatWorkspaceSnapshot }
  'chat:historyPage': { args: [ChatPaneId, string | null, string]; result: ChatHistoryPage }
  'chat:send': { args: [ChatPaneId, string, ChatAttachment[]]; result: void }
  'chat:interrupt': { args: [ChatPaneId]; result: void }
  'chat:selectPane': { args: [ChatPaneId]; result: void }
  'chat:setVisiblePanes': { args: [string, ChatPaneId[], ChatPaneId[]?]; result: void }
  'chat:selectModel': { args: [ChatPaneId, string]; result: void }
  'chat:selectReasoningEffort': { args: [ChatPaneId, string]; result: void }
  'chat:readProviderUsage': { args: [ChatProvider]; result: import('./chat.js').ProviderUsageSnapshot }
  'chat:refreshPlanUsage': { args: [ChatPaneId, boolean?]; result: void }
  'chat:login': { args: []; result: void }
  'chat:listChats': { args: []; result: ChatRowSummary[] }
  'chat:newPeer': { args: [ChatPaneId?, ChatNewPeerOptions?]; result: ChatPaneId }
  'chat:closePeer': { args: [ChatPaneId]; result: void }
  'chat:continueInNewPeer': { args: [ChatContinuationSource, string | null]; result: ChatPaneId }
  'chat:openChat': { args: [string]; result: ChatPaneId }
  'chat:archiveChat': { args: [string]; result: void }
  'chat:unarchiveChat': { args: [string]; result: void }
  'chat:setChatPinned': { args: [string, boolean]; result: void }
  'chat:renameChat': { args: [string, string | null]; result: void }
  'chat:retryChatTitle': { args: [string]; result: void }
  'chat:compactConversation': { args: [ChatPaneId]; result: void }
  'chat:chooseProject': { args: [ChatPaneId]; result: void }
  'chat:selectProject': { args: [ChatPaneId, string]; result: void }
  'chat:clearProject': { args: [ChatPaneId]; result: void }
  'chat:selectSpace': { args: [string | null]; result: void }
  'chat:providerAvailability': { args: []; result: ProviderAvailability[] }
  'chat:providerOnboarding': { args: []; result: ProviderOnboardingStatus[] }
  'chat:providerSignIn': { args: [ChatProvider]; result: void }
  'agentRuns:list': { args: []; result: AgentRun[] }
  'agentRuns:start': { args: [string, AgentRunStartOptions]; result: AgentRun }
  'agentRuns:pause': { args: [string]; result: AgentRun | null }
  'agentRuns:resume': { args: [string]; result: AgentRun | null }
  'agentRuns:stop': { args: [string]; result: void }
  'agentLibrary:list': { args: []; result: SavedAgent[] }
  'agentLibrary:save': { args: [SavedAgentDraft]; result: SavedAgent }
  'agentLibrary:update': { args: [string, SavedAgentPatch]; result: SavedAgent | null }
  'agentLibrary:remove': { args: [string]; result: void }
  'credentials:status': { args: []; result: CredentialVaultStatus }
  'credentials:list': { args: []; result: CredentialSummary[] }
  'credentials:save': { args: [CredentialDraft]; result: CredentialSummary }
  'credentials:reveal': { args: [string, string]; result: string }
  'credentials:remove': { args: [string]; result: void }
  'credentials:rename': { args: [string, string]; result: CredentialSummary }
  'credentials:setAgentAccess': { args: [string, boolean]; result: CredentialSummary }
  'security:get': { args: []; result: SecuritySettings }
  'security:set': { args: [Partial<SecuritySettings>]; result: SecuritySettings }
  'security:importCookies': { args: []; result: BrowserCookieImportResult }
  'security:resolveCredentialApproval': { args: [string, SecurityDecision]; result: void }
  'tools:manifest': { args: []; result: ToolManifest }
  'tools:telemetry': { args: []; result: ToolTelemetrySnapshot }
  'tools:clearTelemetry': { args: []; result: void }
  'tools:setEnabled': { args: [string, boolean]; result: void }
  'tools:setEnabledMany': { args: [ToolSwitch[]]; result: void }
  'tools:setChatToolSliceEnabled': { args: [boolean]; result: void }
  'tools:setChatWorkspaceLedgerEnabled': { args: [boolean]; result: void }
  'models:manifest': { args: []; result: ModelManifest }
  'models:setEnabled': { args: [string, boolean]; result: void }
  'models:setEnabledMany': { args: [ModelSwitch[]]; result: void }
  'trace:setActive': { args: [boolean]; result: void }
  'trace:snapshot': { args: [TraceSnapshotOptions?]; result: TraceSnapshot }
  'trace:clear': { args: []; result: void }
}

export type IpcInvokeChannel = keyof IpcInvokeChannels

/** Channels answered synchronously, for state a renderer needs before its first paint. */
export type IpcSyncChannels = {
  'profiles:bootstrap': { args: []; result: import('./local-profiles.js').ProfileBootstrap }
  'profiles:write': { args: [string]; result: import('./local-profiles.js').ProfileWriteResult }
}

export type IpcSyncChannel = keyof IpcSyncChannels

/** Main-process push channels the preload subscribes to. */
export type IpcEventChannels = {
  'browser:state': BrowserState
  'browser:tabs': BrowserTabInfo[]
  'browser:permissionRequests': WebPermissionRequest[]
  'browserDownloads:changed': BrowserDownload[]
  'savedSites:changed': SavedSite[]
  'notes:changed': NoteChange
  'chat:event': ChatWorkspaceEvent
  'agentRuns:event': AgentRunsEvent
  'agentLibrary:changed': SavedAgent[]
  'security:credentialApprovals': CredentialApprovalRequest[]
  'tools:event': ToolsEvent
  'models:event': ModelsEvent
  'trace:event': TraceEvent
  'windows:event': AppWindowsEvent
  'quickChat:view': QuickChatOverlayView
}

export type IpcEventChannel = keyof IpcEventChannels

/** Canonical channel names grouped like the preload surface. */
export const IPC = {
  invoke: {
    localFiles: {
      open: 'localFiles:open', openImage: 'localFiles:openImage',
      image: 'localFiles:image', revealImage: 'localFiles:revealImage',
      file: 'localFiles:file', revealFile: 'localFiles:revealFile',
      setView: 'localFiles:setView'
    },
    window: {
      minimize: 'window:minimize',
      maximize: 'window:maximize',
      toggleFullscreen: 'window:toggleFullscreen',
      close: 'window:close',
      toggleDevTools: 'window:toggleDevTools',
      desktopWallpaper: 'window:desktopWallpaper'
    },
    wallpapers: {
      list: 'wallpapers:list',
      add: 'wallpapers:add',
      read: 'wallpapers:read',
      remove: 'wallpapers:remove'
    },
    profiles: {
      switchTo: 'profiles:switchTo',
      remove: 'profiles:remove'
    },
    windows: {
      context: 'windows:context',
      list: 'windows:list',
      detachTabs: 'windows:detachTabs',
      returnTabs: 'windows:returnTabs',
      revealTab: 'windows:revealTab',
      showBrowser: 'windows:showBrowser',
      capture: 'windows:capture',
      reportDockSurface: 'windows:reportDockSurface',
      routeCrossDock: 'windows:routeCrossDock',
      completeCrossDock: 'windows:completeCrossDock'
    },
    quickChat: {
      setState: 'quickChat:setState',
      view: 'quickChat:view',
      setSize: 'quickChat:setSize',
      request: 'quickChat:request'
    },
    browser: {
      setBounds: 'browser:setBounds',
      navigate: 'browser:navigate',
      back: 'browser:back',
      forward: 'browser:forward',
      reload: 'browser:reload',
      searchHistory: 'browser:searchHistory',
      removeHistory: 'browser:removeHistory',
      suggest: 'browser:suggest',
      snapshot: 'browser:snapshot',
      newTab: 'browser:newTab',
      newTabToRight: 'browser:newTabToRight',
      openTab: 'browser:openTab',
      closeTab: 'browser:closeTab',
      closeOtherTabs: 'browser:closeOtherTabs',
      closeTabsToRight: 'browser:closeTabsToRight',
      duplicateTab: 'browser:duplicateTab',
      reloadTab: 'browser:reloadTab',
      renameTab: 'browser:renameTab',
      selectTab: 'browser:selectTab',
      capture: 'browser:capture',
      resolvePermission: 'browser:resolvePermission'
    },
    browserDownloads: {
      list: 'browserDownloads:list',
      pause: 'browserDownloads:pause',
      resume: 'browserDownloads:resume',
      cancel: 'browserDownloads:cancel',
      reveal: 'browserDownloads:reveal',
      clear: 'browserDownloads:clear'
    },
    savedSites: {
      list: 'savedSites:list',
      save: 'savedSites:save',
      update: 'savedSites:update',
      remove: 'savedSites:remove'
    },
    notes: {
      list: 'notes:list',
      read: 'notes:read',
      create: 'notes:create',
      save: 'notes:save',
      rename: 'notes:rename',
      remove: 'notes:remove',
      bind: 'notes:bind',
      unbind: 'notes:unbind'
    },
    chat: {
      snapshot: 'chat:snapshot',
      historyPage: 'chat:historyPage',
      send: 'chat:send',
      interrupt: 'chat:interrupt',
      selectPane: 'chat:selectPane',
      setVisiblePanes: 'chat:setVisiblePanes',
      selectModel: 'chat:selectModel',
      selectReasoningEffort: 'chat:selectReasoningEffort',
      readProviderUsage: 'chat:readProviderUsage',
      refreshPlanUsage: 'chat:refreshPlanUsage',
      login: 'chat:login',
      listChats: 'chat:listChats',
      newPeer: 'chat:newPeer',
      closePeer: 'chat:closePeer',
      continueInNewPeer: 'chat:continueInNewPeer',
      openChat: 'chat:openChat',
      archiveChat: 'chat:archiveChat',
      unarchiveChat: 'chat:unarchiveChat',
      setChatPinned: 'chat:setChatPinned',
      renameChat: 'chat:renameChat',
      retryChatTitle: 'chat:retryChatTitle',
      compactConversation: 'chat:compactConversation',
      chooseProject: 'chat:chooseProject',
      selectProject: 'chat:selectProject',
      clearProject: 'chat:clearProject',
      selectSpace: 'chat:selectSpace',
      providerAvailability: 'chat:providerAvailability',
      providerOnboarding: 'chat:providerOnboarding',
      providerSignIn: 'chat:providerSignIn'
    },
    agentRuns: {
      list: 'agentRuns:list',
      start: 'agentRuns:start',
      pause: 'agentRuns:pause',
      resume: 'agentRuns:resume',
      stop: 'agentRuns:stop'
    },
    agentLibrary: {
      list: 'agentLibrary:list',
      save: 'agentLibrary:save',
      update: 'agentLibrary:update',
      remove: 'agentLibrary:remove'
    },
    credentials: {
      status: 'credentials:status',
      list: 'credentials:list',
      save: 'credentials:save',
      reveal: 'credentials:reveal',
      remove: 'credentials:remove',
      rename: 'credentials:rename',
      setAgentAccess: 'credentials:setAgentAccess'
    },
    security: {
      get: 'security:get',
      set: 'security:set',
      importCookies: 'security:importCookies',
      resolveCredentialApproval: 'security:resolveCredentialApproval'
    },
    tools: {
      manifest: 'tools:manifest',
      telemetry: 'tools:telemetry',
      clearTelemetry: 'tools:clearTelemetry',
      setEnabled: 'tools:setEnabled',
      setEnabledMany: 'tools:setEnabledMany',
      setChatToolSliceEnabled: 'tools:setChatToolSliceEnabled',
      setChatWorkspaceLedgerEnabled: 'tools:setChatWorkspaceLedgerEnabled'
    },
    models: {
      manifest: 'models:manifest',
      setEnabled: 'models:setEnabled',
      setEnabledMany: 'models:setEnabledMany'
    },
    trace: {
      setActive: 'trace:setActive',
      snapshot: 'trace:snapshot',
      clear: 'trace:clear'
    }
  },
  sync: {
    profiles: {
      bootstrap: 'profiles:bootstrap',
      write: 'profiles:write'
    }
  },
  event: {
    browserState: 'browser:state',
    browserTabs: 'browser:tabs',
    browserPermissionRequests: 'browser:permissionRequests',
    browserDownloadsChanged: 'browserDownloads:changed',
    savedSitesChanged: 'savedSites:changed',
    notesChanged: 'notes:changed',
    chatEvent: 'chat:event',
    agentRunsEvent: 'agentRuns:event',
    agentLibraryChanged: 'agentLibrary:changed',
    securityCredentialApprovals: 'security:credentialApprovals',
    toolsEvent: 'tools:event',
    modelsEvent: 'models:event',
    traceEvent: 'trace:event',
    windowsEvent: 'windows:event',
    quickChatView: 'quickChat:view'
  }
} as const satisfies {
  invoke: Record<string, Record<string, IpcInvokeChannel>>
  sync: Record<string, Record<string, IpcSyncChannel>>
  event: Record<string, IpcEventChannel>
}
