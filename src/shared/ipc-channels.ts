import type { BrowserHistoryMatch } from './browser-history.js'
import type { BrowserBounds, BrowserDownload, BrowserShot, BrowserState, BrowserTabInfo } from './types.js'
import type { ChatAttachment, ChatHistoryPage } from './chat.js'
import type { ChatContinuationSource, ChatPaneId, ChatRowSummary, ChatWorkspaceEvent, ChatWorkspaceSnapshot } from './chat-peers.js'
import type { CredentialDraft, CredentialSummary, CredentialVaultStatus } from './credentials.js'
import type { ModelManifest, ModelSwitch, ModelsEvent } from './model-settings.js'
import type { ToolManifest, ToolSwitch, ToolTelemetrySnapshot, ToolsEvent } from './tools.js'
import type { TraceEvent, TraceSnapshot } from './trace.js'
import type { LibrarySettings, LibrarySnapshot } from './research-library.js'
import type { ProviderAvailability } from './provider-availability.js'
import type {
  BrowserCookieImportResult, CredentialApprovalRequest, SecurityDecision, SecuritySettings, WebPermissionRequest
} from './security.js'

/** Invoke channels the preload bridge exposes on `window.closedai`. */
export type IpcInvokeChannels = {
  'researchLibrary:snapshot': { args: []; result: LibrarySnapshot }
  'researchLibrary:progress': { args: []; result: Pick<LibrarySnapshot, 'refreshing' | 'lastRefresh'> }
  'researchLibrary:configure': { args: [LibrarySettings]; result: LibrarySnapshot }
  'researchLibrary:refresh': { args: []; result: LibrarySnapshot }
  'researchLibrary:cancel': { args: []; result: void }
  'researchLibrary:dismiss': { args: [string]; result: LibrarySnapshot }
  'researchLibrary:restore': { args: []; result: LibrarySnapshot }
  'localFiles:open': { args: [string]; result: import('./local-files.js').LocalFileResult }
  'localFiles:openImage': { args: [{ name: string; src: string }]; result: string }
  'localFiles:image': { args: [string]; result: import('./local-files.js').ImageTabContent }
  'localFiles:revealImage': { args: [string]; result: void }
  'localFiles:file': { args: [string]; result: import('./local-files.js').FileTabContent }
  'localFiles:revealFile': { args: [string]; result: void }
  'window:minimize': { args: []; result: void }
  'window:maximize': { args: []; result: void }
  'window:toggleFullscreen': { args: []; result: void }
  'window:close': { args: []; result: void }
  'window:toggleDevTools': { args: []; result: void }
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
  'chat:snapshot': { args: []; result: ChatWorkspaceSnapshot }
  'chat:historyPage': { args: [ChatPaneId, string | null, string]; result: ChatHistoryPage }
  'chat:send': { args: [ChatPaneId, string, ChatAttachment[]]; result: void }
  'chat:interrupt': { args: [ChatPaneId]; result: void }
  'chat:selectPane': { args: [ChatPaneId]; result: void }
  'chat:setVisiblePanes': { args: [string, ChatPaneId[], ChatPaneId[]?]; result: void }
  'chat:selectModel': { args: [ChatPaneId, string]; result: void }
  'chat:selectReasoningEffort': { args: [ChatPaneId, string]; result: void }
  'chat:refreshPlanUsage': { args: [ChatPaneId]; result: void }
  'chat:login': { args: []; result: void }
  'chat:listChats': { args: []; result: ChatRowSummary[] }
  'chat:newPeer': { args: []; result: ChatPaneId }
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
  'chat:providerAvailability': { args: []; result: ProviderAvailability[] }
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
  'models:manifest': { args: []; result: ModelManifest }
  'models:setEnabled': { args: [string, boolean]; result: void }
  'models:setEnabledMany': { args: [ModelSwitch[]]; result: void }
  'trace:setActive': { args: [boolean]; result: void }
  'trace:snapshot': { args: []; result: TraceSnapshot }
  'trace:clear': { args: []; result: void }
}

export type IpcInvokeChannel = keyof IpcInvokeChannels

/** Main-process push channels the preload subscribes to. */
export type IpcEventChannels = {
  'browser:state': BrowserState
  'browser:tabs': BrowserTabInfo[]
  'browser:permissionRequests': WebPermissionRequest[]
  'browserDownloads:changed': BrowserDownload[]
  'chat:event': ChatWorkspaceEvent
  'security:credentialApprovals': CredentialApprovalRequest[]
  'tools:event': ToolsEvent
  'models:event': ModelsEvent
  'trace:event': TraceEvent
}

export type IpcEventChannel = keyof IpcEventChannels

/** Canonical channel names grouped like the preload surface. */
export const IPC = {
  invoke: {
    researchLibrary: {
      snapshot: 'researchLibrary:snapshot', configure: 'researchLibrary:configure',
      progress: 'researchLibrary:progress',
      refresh: 'researchLibrary:refresh', cancel: 'researchLibrary:cancel',
      dismiss: 'researchLibrary:dismiss', restore: 'researchLibrary:restore'
    },
    localFiles: {
      open: 'localFiles:open', openImage: 'localFiles:openImage',
      image: 'localFiles:image', revealImage: 'localFiles:revealImage',
      file: 'localFiles:file', revealFile: 'localFiles:revealFile'
    },
    window: {
      minimize: 'window:minimize',
      maximize: 'window:maximize',
      toggleFullscreen: 'window:toggleFullscreen',
      close: 'window:close',
      toggleDevTools: 'window:toggleDevTools'
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
    chat: {
      snapshot: 'chat:snapshot',
      historyPage: 'chat:historyPage',
      send: 'chat:send',
      interrupt: 'chat:interrupt',
      selectPane: 'chat:selectPane',
      setVisiblePanes: 'chat:setVisiblePanes',
      selectModel: 'chat:selectModel',
      selectReasoningEffort: 'chat:selectReasoningEffort',
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
      providerAvailability: 'chat:providerAvailability'
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
      setEnabledMany: 'tools:setEnabledMany'
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
  event: {
    browserState: 'browser:state',
    browserTabs: 'browser:tabs',
    browserPermissionRequests: 'browser:permissionRequests',
    browserDownloadsChanged: 'browserDownloads:changed',
    chatEvent: 'chat:event',
    securityCredentialApprovals: 'security:credentialApprovals',
    toolsEvent: 'tools:event',
    modelsEvent: 'models:event',
    traceEvent: 'trace:event'
  }
} as const satisfies {
  invoke: Record<string, Record<string, IpcInvokeChannel>>
  event: Record<string, IpcEventChannel>
}
