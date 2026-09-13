import { app, BrowserWindow, ipcMain, Menu, nativeTheme, safeStorage, session } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { configureChromiumStartup } from './chromium-startup-policy.js'
import { logGpuFeatureStatus } from './gpu-startup-diagnostics.js'
import { claimProfileInstance } from './app-single-instance.js'
import { browserUserAgentFallback } from './browser-identity.js'
import { createMainWindow } from './main-window.js'
import { BrowserService } from './browser-service.js'
import { BrowserHistoryStore } from './browser-history-store.js'
import { BrowserTabSessionStore } from './browser-tab-session-store.js'
import { AppSettingsStore } from './app-settings-store.js'
import { BrowserDownloadService } from './browser-download-service.js'
import { registerBrowserCoreIpc } from './browser-core-ipc.js'
import { registerBrowserDownloadsIpc } from './browser-downloads-ipc.js'
import { pruneOversizedBrowserCacheOnce } from './browser-cache-maintenance.js'
import { discoverSources, importCookies } from './import-cookies.js'
import { PARTITION } from './browser-url.js'
import { ChatService } from './chat-service.js'
import { CodexWorkspaceRuntime } from './codex-workspace-runtime.js'
import { ChatHub } from './chat-hub.js'
import { ChatPeerManager } from './chat-peers/peer-manager.js'
import { rendererChatBatcher, rendererChatForwarder } from './chat-peers/peer-events.js'
import { ChatStore } from './chat-store/chat-store.js'
import { ChatTranscriptCache } from './chat-store/chat-transcript-cache.js'
import { migrateChatPeersIntoStore } from './chat-store/chat-store-migration.js'
import { ProviderCatalogCache } from './chat-context/provider-catalog-cache.js'
import { stopAllProcessGroups } from './process-tree.js'
import { ClaudeChatService } from './claude/claude-service.js'
import { AntigravityChatService } from './antigravity/antigravity-service.js'
import { CursorChatService } from './cursor/cursor-service.js'
import { CursorToolBridge } from './cursor/cursor-mcp.js'
import { AntigravityToolBridge } from './antigravity/antigravity-mcp.js'
import { BrowserPageAccess } from './browser-page-access.js'
import { BrowserNetworkAccess } from './browser-network-access.js'
import { BrowserCdpAccess } from './cdp/browser-cdp-access.js'
import { AppAutomationAccess } from './app-automation-access.js'
import { AppCommandAccess } from './app-commands.js'
import { UiCaptureAccess } from './ui-capture-access.js'
import { createToolRegistry, type ToolRegistry } from './tools/index.js'
import { browserTools } from './tools/browser/index.js'
import { appTools } from './tools/app/index.js'
import { cdpTools } from './tools/cdp/index.js'
import { captureTools, ScreenshotStore } from './tools/capture/index.js'
import { credentialVaultTools } from './tools/credential-vault/index.js'
import { batchTools } from './tools/batch/index.js'
import { createResearchRuntime } from './research-runtime.js'
import type { ResearchService } from './tools/search/research/service.js'
import { peerChatTools } from './tools/peer-chats/index.js'
import { ToolTelemetry } from './tools/telemetry.js'
import { registerToolsIpc } from './tools/ipc.js'
import { registerTraceIpc } from './trace/ipc.js'
import { traceLog } from './trace/trace-log.js'
import { traceChatEvent, traceChatIpcMetrics, traceToolCalls } from './trace/taps.js'
import type { TraceEvent } from '../shared/trace.js'
import type { ToolsEvent } from '../shared/tools.js'
import { registerChatIpc } from './chat-ipc.js'
import { registerWindowIpc } from './window-ipc.js'
import { CredentialVault } from './credential-vault.js'
import { registerCredentialVaultIpc } from './credential-vault-ipc.js'
import type { ChatWorkspaceEvent } from '../shared/chat-peers.js'
import { IPC, type IpcEventChannel, type IpcEventChannels } from '../shared/ipc-channels.js'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import type { BrowserDownload, BrowserState, BrowserTabInfo } from '../shared/types.js'

// Chromium switches must land before `ready`. Owner decision: the Linux sandbox flags stay
// exactly as appv1 has them (docs/electron-browser-platform-review.md §0).
configureChromiumStartup(app)
// Drop the Electron/app tokens from the UA before any session exists, keeping Chromium's
// native version and Client Hints intact.
app.userAgentFallback = browserUserAgentFallback(app.userAgentFallback, app.getName())
// Frameless window, no native menu — and no default accelerators shadowing browser shortcuts.
Menu.setApplicationMenu(null)
// Pages see prefers-color-scheme: dark and native dialogs/context menus follow the chrome.
nativeTheme.themeSource = 'dark'

let mainWindow: BrowserWindow | null = null
let browserService: BrowserService | null = null
let browserDownloads: BrowserDownloadService | null = null
let browserHistory: BrowserHistoryStore | null = null
let browserTabSession: BrowserTabSessionStore | null = null
let settings: AppSettingsStore | null = null
let chatStore: ChatStore | null = null
let chatTranscripts: ChatTranscriptCache | null = null
let providerCatalogs: ProviderCatalogCache | null = null
let chatService: ChatPeerManager | null = null
let credentialVault: CredentialVault | null = null
let codexRuntime: CodexWorkspaceRuntime | null = null
let toolRegistry: ToolRegistry | null = null
let researchService: ResearchService | null = null
let toolTelemetry: ToolTelemetry | null = null
let antigravityBridge: AntigravityToolBridge | null = null
let cursorBridge: CursorToolBridge | null = null
let browserSessionFlush: Promise<void> | null = null
let cdpAccess: BrowserCdpAccess | null = null
let appAutomationAccess: AppAutomationAccess | null = null
let appCommandAccess: AppCommandAccess | null = null
let quitting = false
let pendingLiveVerify: { mode: string; quitAfter: boolean } | null = null

function liveVerifyFromArgv(): string | undefined {
  return process.argv.find((arg) => arg.startsWith('--live-verify='))?.slice('--live-verify='.length).trim()
}

function requestLiveVerify(mode: string, quitAfter: boolean): void {
  pendingLiveVerify = { mode, quitAfter }
  void runPendingLiveVerify()
}

async function runPendingLiveVerify(): Promise<void> {
  const pending = pendingLiveVerify
  if (!pending || !toolRegistry || !researchService) return
  pendingLiveVerify = null
  try {
    const { runLiveVerify } = await import('./live-verify/search-pipeline.js')
    const result = await runLiveVerify(pending.mode, toolRegistry, researchService)
    console.log(`[live-verify:${pending.mode}]`, JSON.stringify(result))
  } catch (error) {
    console.error(`[live-verify:${pending.mode}]`, error)
    if (pending.quitAfter) process.exitCode = 1
  } finally {
    if (pending.quitAfter) app.quit()
  }
}

// The BrowserWindow reference can outlive its WebContents during Electron shutdown. Keep all
// renderer notifications behind one liveness check so late browser/service events are harmless.
function sendToMainWindow<C extends IpcEventChannel>(channel: C, payload: IpcEventChannels[C]): void {
  const window = mainWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, payload)
}

const userData = (): string => app.getPath('userData')

if (!claimProfileInstance(app, { profile: userData(), checkout: app.getAppPath(), pid: process.pid }, () => mainWindow)) {
  // A second launch against the same profile focused the owner and is exiting.
} else {
  app.on('second-instance', (_event, argv) => {
    const mode = argv.map(String).find((arg) => arg.startsWith('--live-verify='))?.slice('--live-verify='.length).trim()
    if (mode) requestLiveVerify(mode, false)
  })
  void app.whenReady().then(main)
}

async function main(): Promise<void> {
  logGpuFeatureStatus()
  await mkdir(userData(), { recursive: true })
  ;[browserHistory, browserTabSession, settings, chatStore] = await Promise.all([
    BrowserHistoryStore.open(join(userData(), 'browser-history.json')),
    BrowserTabSessionStore.open(join(userData(), 'browser-tabs.json')),
    AppSettingsStore.open(join(userData(), 'app-settings.json')),
    ChatStore.open(join(userData(), 'chats.json'))
  ])
  credentialVault = new CredentialVault(join(userData(), 'credential-vault.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
    // Linux reports which keyring backend was selected; elsewhere safeStorage is the OS store.
    backend: () =>
      safeStorage.isEncryptionAvailable()
        ? (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'keychain' : 'dpapi')
        : 'unavailable'
  })
  const configuredWorkspace = process.env.CLOSEDAI_WORKSPACE?.trim()
  // An environment-supplied workspace wins for the initial launch, but project changes are
  // still user-owned afterwards. A missing saved selection keeps the existing checkout as the
  // pleasant first-run project rather than dropping people into their home folder unexpectedly.
  let chatWorkspace = configuredWorkspace
    ? resolve(configuredWorkspace)
    : settings.get().chatWorkspacePath ?? app.getAppPath()
  let projectPath: string | null = configuredWorkspace
    ? chatWorkspace
    : settings.get().chatProjectPath ?? chatWorkspace
  // Pane records that settings used to hold become chat records once; ids are preserved.
  await migrateChatPeersIntoStore(settings, chatStore, { cwd: chatWorkspace, projectPath })
  const workspaceSelector = {
    current: () => ({
      cwd: chatWorkspace,
      projectPath,
      recentProjects: [...settings!.get().chatWorkspaces]
        .reverse()
        .filter((workspace) => workspace.projectPath && !sameChatWorkspace(workspace, { cwd: chatWorkspace, projectPath }))
        .map((workspace) => ({ cwd: workspace.cwd, projectPath: workspace.projectPath! }))
    }),
    select: async (
      nextProjectPath: string | null,
      preference: { modelId: string | null; reasoningEffort: string | null }
    ): Promise<void> => {
      const current = settings!.get()
      const previous = {
        cwd: chatWorkspace,
        projectPath,
        openIds: current.chatOpenIds,
        peers: [],
        selectedPaneId: current.chatSelectedPaneId
      }
      const nextCwd = nextProjectPath ?? app.getPath('home')
      const saved = current.chatWorkspaces.filter((workspace) => !sameChatWorkspace(workspace, previous))
      const destination = saved.find((workspace) =>
        workspace.cwd === nextCwd && workspace.projectPath === nextProjectPath
      )
      const destinationOpenIds = (destination?.openIds ?? []).filter((id) => chatStore!.has(id))
      const destinationSelected = destination?.selectedPaneId && destinationOpenIds.includes(destination.selectedPaneId)
        ? destination.selectedPaneId
        : destinationOpenIds[0] ?? null
      const destinationChat = destinationSelected ? chatStore!.get(destinationSelected) ?? null : null
      projectPath = nextProjectPath
      chatWorkspace = nextCwd
      await settings!.set({
        chatWorkspaces: [...saved, previous],
        chatWorkspacePath: chatWorkspace,
        chatProjectPath: projectPath,
        chatOpenIds: destinationOpenIds,
        chatSelectedPaneId: destinationSelected,
        chatThreadId: destinationChat?.codexThreadId ?? null,
        chatClaudeSessionId: destinationChat?.claudeSessionId ?? null,
        chatAntigravityConversationId: destinationChat?.antigravityConversationId ?? null,
        chatCursorSessionId: destinationChat?.cursorSessionId ?? null,
        chatModelId: destinationChat?.modelId ?? preference.modelId,
        chatReasoningEffort: destinationChat?.reasoningEffort ?? preference.reasoningEffort,
        chatContinuation: destinationChat?.continuation ?? null
      })
    }
  }
  // Tools resolve the browser lazily: it is created with the window, after the chat service.
  const pageAccess = new BrowserPageAccess(() => browserService)
  cdpAccess = new BrowserCdpAccess(() => browserService)
  const networkAccess = new BrowserNetworkAccess(() => browserService, () => cdpAccess)
  appAutomationAccess = new AppAutomationAccess(() => mainWindow)
  appCommandAccess = new AppCommandAccess({
    chat: () => chatService, browser: () => browserService, downloads: () => browserDownloads, window: () => mainWindow
  })
  const captureAccess = new UiCaptureAccess(() => mainWindow, () => browserService)
  // Full-resolution captures for the transcript; the model only ever receives the scaled copy.
  const screenshots = new ScreenshotStore()
  const research = await createResearchRuntime({
    root: join(userData(), 'research-runs'), browser: () => browserService,
    peers: () => process.env.CLOSEDAI_LIVE_VERIFY?.trim()
      ? ({
          paneSnapshot: () => ({ threadId: 'live-verify-thread', activeTurnId: 'live-verify-turn' })
        } as unknown as ChatPeerManager)
      : chatService,
    workspace: () => chatWorkspace
  })
  researchService = research.service
  toolRegistry = createToolRegistry([
    credentialVaultTools(() => credentialVault),
    appTools(() => appCommandAccess, () => appAutomationAccess),
    browserTools(() => pageAccess, () => networkAccess, () => networkAccess),
    cdpTools(() => cdpAccess),
    captureTools(() => captureAccess, screenshots),
    research.namespace,
    peerChatTools(() => chatService),
    // Lazy self-reference: the batch dispatches into the registry it is registered in.
    batchTools(() => toolRegistry!, { maxCalls: settings.get().toolBatchMaxCalls })
  ])
  for (const toolId of settings.get().disabledTools) toolRegistry.setEnabled(toolId, false)
  toolTelemetry = await ToolTelemetry.open(
    join(userData(), 'tool-telemetry.json'),
    join(userData(), 'tool-telemetry.jsonl')
  )
  toolRegistry.subscribe((record) => toolTelemetry?.record(record))
  // The live turn trace: full arguments and results, in memory only, for the user's own view.
  traceToolCalls(toolRegistry)
  const activeBrowserContext = (): { tabId: string; url: string; title: string; isLoading: boolean } | null => {
    const active = browserService?.tabList().find((tab) => tab.active)
    if (!active) return null
    return {
      tabId: active.id,
      url: active.url,
      title: active.title,
      isLoading: active.isLoading
    }
  }
  // One MCP bridge serves every pane's `agy` processes; calls carry the conversation id back.
  // The CLI config is shared by every instance, so only the default profile registers bare names.
  antigravityBridge = new AntigravityToolBridge(toolRegistry, { profileKey: profileKeyFor(userData()) })
  const antigravityStateDir = join(userData(), 'antigravity')
  const cursorStateDir = join(userData(), 'cursor')
  // ACP takes its MCP servers per session, so this bridge registers nothing outside the app.
  cursorBridge = new CursorToolBridge(toolRegistry)
  // Model catalogs are shared per workspace and across launches, so a pane's non-active
  // providers fill the picker from the last catalog seen instead of each starting a process.
  const catalogCache = await ProviderCatalogCache.open(join(userData(), 'provider-catalogs.json'))
  providerCatalogs = catalogCache
  // What each chat last looked like, so opening one paints before its provider has replayed it.
  chatTranscripts = new ChatTranscriptCache(join(userData(), 'chat-transcripts'))
  chatService = new ChatPeerManager(settings, chatStore, (peerSettings, record) => {
    const catalogs = catalogCache.forWorkspace(chatWorkspace)
    if (!codexRuntime || codexRuntime.cwd !== chatWorkspace) {
      codexRuntime?.stop()
      codexRuntime = new CodexWorkspaceRuntime(chatWorkspace, settings!)
    }
    return new ChatHub({
    codex: new ChatService(
      chatWorkspace, peerSettings, toolRegistry!, activeBrowserContext, screenshots, codexRuntime, peerSettings.paneId
    ),
    claude: new ClaudeChatService(
      chatWorkspace, peerSettings, toolRegistry!, activeBrowserContext, screenshots, peerSettings.paneId
    ),
    antigravity: new AntigravityChatService(
      chatWorkspace, peerSettings, antigravityBridge!, antigravityStateDir, activeBrowserContext, screenshots, peerSettings.paneId, catalogs
    ),
    cursor: new CursorChatService(
      chatWorkspace, peerSettings, cursorBridge!, cursorStateDir, activeBrowserContext, screenshots, peerSettings.paneId, catalogs
    )
  }, record.modelId, peerSettings, {
    provider: record.provider,
    catalogs,
    checkpoint: () => chatStore!.get(peerSettings.paneId)?.checkpoint ?? null
  })
  }, undefined, workspaceSelector, chatTranscripts, (paneId) => {
    const snapshot = chatService?.paneSnapshot(paneId)
    researchService?.cancelPane(paneId, snapshot?.threadId, snapshot?.activeTurnId)
  })
  chatService.on('event', (event: ChatWorkspaceEvent) => {
    if (event.type !== 'pane' || !['turn', 'replace'].includes(event.event.type)) return
    const snapshot = chatService?.paneSnapshot(event.paneId)
    researchService?.reconcile(event.paneId, snapshot?.threadId ?? null, snapshot?.activeTurnId ?? null)
  })
  registerIpc()
  // The one-shot cookie import runs before the first tab loads, so a restored or home page
  // arrives already signed in rather than racing the import.
  await importDefaultBrowserCookies()
  createWindow()
  void chatService.start()
  void pruneOversizedBrowserCacheOnce(userData()).catch(() => {})
  const liveVerify = process.env.CLOSEDAI_LIVE_VERIFY?.trim() || liveVerifyFromArgv()
  if (liveVerify) requestLiveVerify(liveVerify, true)
}

/** Null for Electron's default userData; a short stable hash for any other profile. */
function profileKeyFor(userDataDir: string): string | null {
  if (resolve(userDataDir) === resolve(join(app.getPath('appData'), app.getName()))) return null
  let hash = 0
  for (let index = 0; index < userDataDir.length; index += 1) hash = (hash * 31 + userDataDir.charCodeAt(index)) >>> 0
  return hash.toString(36)
}

function sameChatWorkspace(
  left: { cwd: string; projectPath: string | null },
  right: { cwd: string; projectPath: string | null }
): boolean {
  return left.cwd === right.cwd && left.projectPath === right.projectPath
}

function createWindow(): void {
  const window = createMainWindow({ openLinkInNewTab: (url) => browserService?.openNewTab(url, false) })
  mainWindow = window
  // Reopen the tabs the last run ended with. The session was read from disk above, so the
  // strip is rebuilt inside the constructor with no async gap the renderer could observe.
  browserService = new BrowserService(window, browserHistory!, {
    restore: browserTabSession?.restored() ?? undefined
  })
  wireBrowserEvents(browserService)
  // Attached to the partition session rather than a tab: a download outlives the tab that
  // started it. Files land in the OS downloads folder like Chrome.
  browserDownloads = new BrowserDownloadService({ workspaceRoot: () => app.getPath('downloads') })
  browserDownloads.install(session.fromPartition(PARTITION))
  browserDownloads.on('changed', (downloads: BrowserDownload[]) =>
    sendToMainWindow(IPC.event.browserDownloadsChanged, downloads)
  )
  const batchChat = rendererChatBatcher(
    (event) => sendToMainWindow(IPC.event.chatEvent, event),
    traceChatIpcMetrics
  )
  const forwardChat = rendererChatForwarder(
    chatService?.snapshot({ limit: 0 }).selectedPaneId ?? '', batchChat)
  chatService?.on('event', (event: ChatWorkspaceEvent) => {
    traceChatEvent(event)
    forwardChat(event)
  })
  traceLog.on('event', (event: TraceEvent) => sendToMainWindow(IPC.event.traceEvent, event))
  const sendToolsEvent = (event: ToolsEvent): void => { sendToMainWindow(IPC.event.toolsEvent, event) }
  toolTelemetry?.on('record', (record) => sendToolsEvent({ type: 'call', record }))
  toolTelemetry?.on('cleared', () => sendToolsEvent({ type: 'cleared' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  window.on('closed', disposeWindowServices)
}

function wireBrowserEvents(service: BrowserService): void {
  service.on('state', (state: BrowserState) => sendToMainWindow(IPC.event.browserState, state))
  service.on('tabs', (tabs: BrowserTabInfo[]) => {
    sendToMainWindow(IPC.event.browserTabs, tabs)
    // Persist the strip on every change rather than only at quit: a crash never reaches a
    // quit hook, and the point is that the tabs come back regardless of how the app died.
    browserTabSession?.save(service.persistTabs())
  })
  service.on('error', (error: unknown) => {
    console.warn('[browser]', error instanceof Error ? error.message : error)
  })
}

function registerIpc(): void {
  registerWindowIpc(ipcMain, () => mainWindow)
  registerBrowserCoreIpc(ipcMain, () => browserService)
  registerBrowserDownloadsIpc(ipcMain, () => browserDownloads)
  registerChatIpc(ipcMain, () => chatService)
  registerTraceIpc(ipcMain, traceLog)
  registerCredentialVaultIpc(ipcMain, () => credentialVault)
  registerToolsIpc(ipcMain, {
    registry: () => toolRegistry,
    telemetry: () => toolTelemetry,
    providers: () => [...CHAT_PROVIDERS],
    onEnabledChanged: async (toolId, enabled, disabledIds) => {
      await settings?.set({ disabledTools: disabledIds })
      sendToMainWindow(IPC.event.toolsEvent, { type: 'enabled', toolId, enabled } satisfies ToolsEvent)
    }
  })
}

// One-shot clone of the user's real browser session (cookies) into persist:browser, so the
// embedded browser starts signed in where the user already is. Latched in settings, but an
// empty session with the latch set means a lost import, so re-run it in that case.
async function importDefaultBrowserCookies(): Promise<void> {
  if (!settings) return
  if (settings.get().browserCookiesImported) {
    try {
      const existing = await session.fromPartition(PARTITION).cookies.get({})
      if (existing.length > 0) return
      console.warn('[cookie-import] latch set but session is empty; re-importing')
    } catch {
      // Reading cookies failed — fall through and attempt a fresh import.
    }
  }
  const chosen = discoverSources()[0]
  if (!chosen) {
    console.warn('[cookie-import] no supported browser profile found; skipping')
    return
  }
  try {
    const target = session.fromPartition(PARTITION)
    const result = await importCookies(chosen, target)
    await target.cookies.flushStore()
    await settings.set({ browserCookiesImported: true })
    console.log(`[cookie-import] imported ${result.imported} cookies from ${result.source} (${result.failed} failed, ${result.skipped} skipped)`)
  } catch (error) {
    // Do not latch on failure — retry on the next launch.
    console.warn('[cookie-import] failed:', error instanceof Error ? error.message : error)
  }
}

function disposeWindowServices(): void {
  researchService?.dispose()
  browserSessionFlush = browserService?.flushSessionData() ?? null
  appAutomationAccess?.dispose()
  cdpAccess?.dispose()
  cdpAccess = null
  browserService?.dispose()
  browserService = null
  mainWindow = null
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  chatService?.stop()
  codexRuntime?.stop()
  const flushSession = browserSessionFlush ?? browserService?.flushSessionData()
  void Promise.allSettled([
    browserHistory?.flush(),
    browserTabSession?.close(),
    settings?.set({}),
    chatStore?.flush(),
    chatTranscripts?.flush(),
    providerCatalogs?.flush(),
    flushSession,
    // Leaves the user's agy MCP config without dead localhost endpoints.
    antigravityBridge?.stop(),
    // Nothing outside the app to clean up here; this only closes the listener.
    cursorBridge?.stop()
  ]).finally(() => {
    // Provider processes were asked to stop above; none may outlive the app.
    stopAllProcessGroups()
    app.quit()
  })
})
