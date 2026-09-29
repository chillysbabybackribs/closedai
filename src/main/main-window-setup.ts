import type { BrowserWindow } from 'electron'
import { session } from 'electron'
import { IPC, type IpcEventChannel, type IpcEventChannels } from '../shared/ipc-channels.js'
import type { BrowserBounds, BrowserDownload, BrowserState, BrowserTabInfo } from '../shared/types.js'
import type { TraceEvent } from '../shared/trace.js'
import type { ToolsEvent } from '../shared/tools.js'
import type { ChatWorkspaceEvent } from '../shared/chat-peers.js'
import { createMainWindow, loadAppRenderer } from './main-window.js'
import { BrowserService } from './browser-service.js'
import { BrowserDownloadService } from './browser-download-service.js'
import { BrowserHistoryStore } from './browser-history-store.js'
import { BrowserTabSessionStore } from './browser-tab-session-store.js'
import { PARTITION } from './browser-url.js'
import { rendererChatBatcher, rendererChatForwarder } from './chat-peers/peer-events.js'
import { traceChatEvent, traceChatIpcMetrics } from './trace/taps.js'
import { traceLog } from './trace/trace-log.js'
import type { ChatPeerManager } from './chat-peers/peer-manager.js'
import type { SecuritySettingsStore } from './security-settings-store.js'
import type { BrowserPermissionBroker } from './browser-permission-broker.js'
import type { ToolRegistry } from './tools/registry.js'
import type { ToolTelemetry } from './tools/telemetry.js'
import type { BrowserCdpAccess } from './cdp/browser-cdp-access.js'
import type { AppAutomationAccess } from './app-automation-access.js'
import type { NativeInstrumentService } from './native-instrument/service.js'
import { QuickChatOverlay } from './quick-chat-overlay/quick-chat-overlay.js'
import type { AppSurfaceHandle, SurfaceContents } from './windows/app-window-registry.js'
import type { QuickChatOverlayRequest } from '../shared/quick-chat-overlay.js'
export type MainWindowHost = {
  downloadsRoot: () => string
  /** Every window, except browser channels, which only the main window renders. */
  sendToWindows: <C extends IpcEventChannel>(channel: C, payload: IpcEventChannels[C]) => void
  /** Chat events, each transcript stream routed to the window showing that chat. */
  sendChatEvent: (event: ChatWorkspaceEvent) => void
  browserHistory: BrowserHistoryStore
  browserTabSession: BrowserTabSessionStore | null
  securitySettings: SecuritySettingsStore
  permissionRequests: BrowserPermissionBroker
  chatService: ChatPeerManager | null
  /** Settled before the first page loads; see BrowserServiceOptions.readyToLoad. */
  browserReadyToLoad: Promise<unknown> | null
  toolRegistry: ToolRegistry | null
  toolTelemetry: ToolTelemetry | null
  setMainWindow: (window: BrowserWindow | null) => void
  setBrowserService: (service: BrowserService | null) => void
  setBrowserDownloads: (service: BrowserDownloadService | null) => void
  setBrowserSessionFlush: (flush: Promise<void> | null) => void
  getBrowserService: () => BrowserService | null
  getMainWindow: () => BrowserWindow | null
  nativeInstrument: NativeInstrumentService | null
  disposeResearch: (() => void) | null
  appAutomationAccess: AppAutomationAccess | null
  cdpAccess: BrowserCdpAccess | null
  setCdpAccess: (access: BrowserCdpAccess | null) => void
  /** Routes events to a layer inside the main window; null before the window registry exists. */
  attachSurface: (contents: SurfaceContents) => AppSurfaceHandle | null
  setQuickChatOverlay: (overlay: QuickChatOverlay | null) => void
  /** Carries the quick chat's request to the main window's layout. */
  quickChatRequest: (request: QuickChatOverlayRequest) => void
  getQuickChatOverlay: () => QuickChatOverlay | null
}

export function openMainWindow(host: MainWindowHost): BrowserWindow {
  const window = createMainWindow({ openLinkInNewTab: (url) => host.getBrowserService()?.openNewTab(url, false) })
  host.setMainWindow(window)
  const browserService = new BrowserService(window, host.browserHistory, {
    restore: host.browserTabSession?.restored() ?? undefined,
    readyToLoad: host.browserReadyToLoad ?? undefined,
    permissions: {
      policy: () => host.securitySettings.get().webPermissions,
      ask: (request) => host.permissionRequests.ask(request)
    },
    pageKeys: (input) => host.getQuickChatOverlay()?.shortcut(input) ?? false
  })
  host.setBrowserService(browserService)
  browserService.on('popup', (opener: string, child: string) => host.toolRegistry?.browserCoordination?.inherit(opener, child))
  wireBrowserEvents(host, browserService)
  const quickChat = new QuickChatOverlay({
    window,
    attachSurface: (contents) => host.attachSurface(contents),
    openLinkInNewTab: (url) => host.getBrowserService()?.openNewTab(url, false),
    request: (request) => host.quickChatRequest(request)
  })
  host.setQuickChatOverlay(quickChat)
  window.webContents.on('before-input-event', (event, input) => {
    if (quickChat.shortcut(input)) event.preventDefault()
  })
  // The quick chat floats over the page: it follows the page's box and stays stacked above it.
  browserService.on('page', (bounds: BrowserBounds, visible: boolean) => quickChat.setPage(bounds, visible))
  browserService.on('pageViewAttached', () => quickChat.raise())
  browserService.on('state', (state: BrowserState) => quickChat.setUrl(state.url))
  const browserDownloads = new BrowserDownloadService({ workspaceRoot: host.downloadsRoot })
  host.setBrowserDownloads(browserDownloads)
  browserDownloads.install(session.fromPartition(PARTITION))
  browserDownloads.on('changed', (downloads: BrowserDownload[]) =>
    host.sendToWindows(IPC.event.browserDownloadsChanged, downloads)
  )
  const batchChat = rendererChatBatcher(
    (event) => host.sendChatEvent(event),
    traceChatIpcMetrics
  )
  const forwardChat = rendererChatForwarder(
    host.chatService?.snapshot({ limit: 0 }).selectedPaneId ?? '', batchChat)
  host.chatService?.on('event', (event: ChatWorkspaceEvent) => {
    traceChatEvent(event)
    forwardChat(event)
  })
  traceLog.on('event', (event: TraceEvent) => host.sendToWindows(IPC.event.traceEvent, event))
  const sendToolsEvent = (event: ToolsEvent): void => { host.sendToWindows(IPC.event.toolsEvent, event) }
  host.toolTelemetry?.on('record', (record) => sendToolsEvent({ type: 'call', record }))
  host.toolTelemetry?.on('cleared', () => sendToolsEvent({ type: 'cleared' }))

  loadAppRenderer(window)
  window.on('closed', () => disposeMainWindowServices(host))
  return window
}

export function wireBrowserEvents(host: MainWindowHost, service: BrowserService): void {
  service.on('state', (state: BrowserState) => host.sendToWindows(IPC.event.browserState, state))
  service.on('tabs', (tabs: BrowserTabInfo[]) => {
    host.sendToWindows(IPC.event.browserTabs, tabs)
    host.browserTabSession?.save(service.persistTabs())
  })
  service.on('error', (error: unknown) => {
    console.warn('[browser]', error instanceof Error ? error.message : error)
  })
}

export function disposeMainWindowServices(host: MainWindowHost): void {
  host.nativeInstrument?.dispose()
  host.disposeResearch?.()
  host.setBrowserSessionFlush(host.getBrowserService()?.flushSessionData() ?? null)
  host.appAutomationAccess?.dispose()
  host.cdpAccess?.dispose()
  host.setCdpAccess(null)
  host.getQuickChatOverlay()?.dispose()
  host.setQuickChatOverlay(null)
  host.getBrowserService()?.dispose()
  host.setBrowserService(null)
  host.setMainWindow(null)
}
