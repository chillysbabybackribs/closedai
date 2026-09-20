import type { BrowserHistoryMatch } from './browser-history.js'
import type { BrowserBounds, BrowserDownload, BrowserShot, BrowserState, BrowserTabInfo } from './types.js'
import type { ChatAttachment, ChatHistoryPage } from './chat.js'
import type { ChatContinuationSource, ChatPaneId, ChatRowSummary, ChatWorkspaceEvent, ChatWorkspaceSnapshot } from './chat-peers.js'
import type { CredentialDraft, CredentialSummary, CredentialVaultStatus } from './credentials.js'
import type { ToolManifest, ToolTelemetrySnapshot, ToolsEvent } from './tools.js'
import type { TraceEvent, TraceSnapshot } from './trace.js'

/** Invoke channels the preload bridge exposes on `window.closedai`. */
export type IpcInvokeChannels = {
  'localFiles:open': { args: [string]; result: import('./local-files.js').LocalFileResult }
  'window:minimize': { args: []; result: void }
  'window:maximize': { args: []; result: void }
  'window:toggleFullscreen': { args: []; result: void }
  'window:close': { args: []; result: void }
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
  'chat:setChatPinned': { args: [string, boolean]; result: void }
  'chat:compactConversation': { args: [ChatPaneId]; result: void }
  'chat:chooseProject': { args: []; result: void }
  'chat:selectProject': { args: [string]; result: void }
  'chat:clearProject': { args: []; result: void }
  'credentials:status': { args: []; result: CredentialVaultStatus }
  'credentials:list': { args: []; result: CredentialSummary[] }
  'credentials:save': { args: [CredentialDraft]; result: CredentialSummary }
  'credentials:reveal': { args: [string, string]; result: string }
  'credentials:remove': { args: [string]; result: void }
  'credentials:rename': { args: [string, string]; result: CredentialSummary }
  'tools:manifest': { args: []; result: ToolManifest }
  'tools:telemetry': { args: []; result: ToolTelemetrySnapshot }
  'tools:clearTelemetry': { args: []; result: void }
  'tools:setEnabled': { args: [string, boolean]; result: void }
  'trace:setActive': { args: [boolean]; result: void }
  'trace:snapshot': { args: []; result: TraceSnapshot }
  'trace:clear': { args: []; result: void }
}

export type IpcInvokeChannel = keyof IpcInvokeChannels

/** Main-process push channels the preload subscribes to. */
export type IpcEventChannels = {
  'browser:state': BrowserState
  'browser:tabs': BrowserTabInfo[]
  'browserDownloads:changed': BrowserDownload[]
  'chat:event': ChatWorkspaceEvent
  'tools:event': ToolsEvent
  'trace:event': TraceEvent
}

export type IpcEventChannel = keyof IpcEventChannels

/** Canonical channel names grouped like the preload surface. */
export const IPC = {
  invoke: {
    localFiles: { open: 'localFiles:open' },
    window: {
      minimize: 'window:minimize',
      maximize: 'window:maximize',
      toggleFullscreen: 'window:toggleFullscreen',
      close: 'window:close'
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
      capture: 'browser:capture'
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
      setChatPinned: 'chat:setChatPinned',
      compactConversation: 'chat:compactConversation',
      chooseProject: 'chat:chooseProject',
      selectProject: 'chat:selectProject',
      clearProject: 'chat:clearProject'
    },
    credentials: {
      status: 'credentials:status',
      list: 'credentials:list',
      save: 'credentials:save',
      reveal: 'credentials:reveal',
      remove: 'credentials:remove',
      rename: 'credentials:rename'
    },
    tools: {
      manifest: 'tools:manifest',
      telemetry: 'tools:telemetry',
      clearTelemetry: 'tools:clearTelemetry',
      setEnabled: 'tools:setEnabled'
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
    browserDownloadsChanged: 'browserDownloads:changed',
    chatEvent: 'chat:event',
    toolsEvent: 'tools:event',
    traceEvent: 'trace:event'
  }
} as const satisfies {
  invoke: Record<string, Record<string, IpcInvokeChannel>>
  event: Record<string, IpcEventChannel>
}
