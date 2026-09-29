import { app, BaseWindow, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, screen } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { configureChromiumStartup } from './chromium-startup-policy.js'
import { logGpuFeatureStatus } from './gpu-startup-diagnostics.js'
import { claimProfileInstance } from './app-single-instance.js'
import { installCrashGuard, runBootstrap } from './app-crash-guard.js'
import { QUIT_SETTLE_TIMEOUT_MS, settleWithin } from './app-quit.js'
import { browserUserAgentFallback } from './browser-identity.js'
import { BrowserService } from './browser-service.js'
import { BrowserHistoryStore } from './browser-history-store.js'
import { SavedSitesStore } from './saved-sites-store.js'
import { BrowserTabSessionStore } from './browser-tab-session-store.js'
import { AppSettingsStore } from './app-settings-store.js'
import { BrowserDownloadService } from './browser-download-service.js'
import { maintainBrowserCache, scheduleBrowserCacheMaintenance } from './browser-cache-maintenance.js'
import { setAppCheckoutPath } from './app-checkout.js'
import { scheduleVerifyJanitor } from './verify-janitor.js'
import { importDefaultBrowserCookies } from './browser-cookie-import.js'
import { CodexWorkspaceRuntime } from './codex-workspace-runtime.js'
import { ChatPeerManager } from './chat-peers/peer-manager.js'
import { AgentRunService } from './agent-runs/agent-run-service.js'
import { AgentLibraryStore } from './agent-library/agent-library-store.js'
import { ChatStore } from './chat-store/chat-store.js'
import { ChatTranscriptCache } from './chat-store/chat-transcript-cache.js'
import { migrateChatPeersIntoStore } from './chat-store/chat-store-migration.js'
import { ProviderCatalogCache } from './chat-context/provider-catalog-cache.js'
import { stopAllProcessGroups } from './process-tree.js'
import { CursorToolBridge } from './cursor/cursor-mcp.js'
import { AntigravityToolBridge } from './antigravity/antigravity-mcp.js'
import { BrowserPageAccess } from './browser-page-access.js'
import { BrowserCoordination } from './tools/browser/coordination.js'
import { BrowserAssignmentIdleRelease } from './tools/browser/assignment-idle-release.js'
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
import { createArtifactRuntime } from './investigations/artifact-runtime.js'
import type { ArtifactStore } from './investigations/artifact-store.js'
import type { ResearchService } from './tools/search/research/service.js'
import { peerChatTools } from './tools/peer-chats/index.js'
import { NativeControllerClient } from './native-instrument/client.js'
import { NativeInstrumentService } from './native-instrument/service.js'
import { nativeInstrumentTools } from './tools/native-instrument/index.js'
import { mediaTools, VideoJobs } from './tools/media/index.js'
import { recordPageVideo } from './video-render/page-recorder.js'
import { ToolTelemetry } from './tools/telemetry.js'
import { traceToolCalls } from './trace/taps.js'
import { CredentialVault } from './credential-vault.js'
import { safeStorageEncryption } from './safe-storage-encryption.js'
import { SecuritySettingsStore } from './security-settings-store.js'
import { CredentialApprovalBroker } from './security-approvals.js'
import { BrowserPermissionBroker } from './browser-permission-broker.js'
import type { AgentRun, AgentRunsEvent } from '../shared/agent-runs.js'
import type { SavedAgent } from '../shared/agent-library.js'
import type { ChatWorkspaceEvent } from '../shared/chat-peers.js'
import { IPC, type IpcEventChannel, type IpcEventChannels } from '../shared/ipc-channels.js'
import type { SavedSite } from '../shared/saved-sites.js'
import { liveVerifyFromArgv, requestLiveVerify, type LiveVerifyHandle } from './app-live-verify.js'
import { createChatWorkspaceSelector } from './main-workspace-selector.js'
import { createPaneChatHub } from './main-pane-chat-hub.js'
import { mainCookieImportDeps, registerMainProcessIpc } from './main-ipc-registration.js'
import { openMainWindow, type MainWindowHost } from './main-window-setup.js'
import { AppWindowRegistry } from './windows/app-window-registry.js'
import { AppWindowStore } from './windows/app-window-store.js'
import { openDetachedWindow } from './windows/detached-window.js'

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
let windows: AppWindowRegistry | null = null
let windowStore: AppWindowStore | null = null
let browserService: BrowserService | null = null
let browserDownloads: BrowserDownloadService | null = null
let browserHistory: BrowserHistoryStore | null = null
let savedSites: SavedSitesStore | null = null
let browserTabSession: BrowserTabSessionStore | null = null
let settings: AppSettingsStore | null = null
let chatStore: ChatStore | null = null
let chatTranscripts: ChatTranscriptCache | null = null
let providerCatalogs: ProviderCatalogCache | null = null
let chatService: ChatPeerManager | null = null
let agentRuns: AgentRunService | null = null
let agentLibrary: AgentLibraryStore | null = null
let credentialVault: CredentialVault | null = null
let securitySettings: SecuritySettingsStore | null = null
// Pending user decisions (credential reads, page permissions); empty unless Settings → Security asks for them.
const credentialApprovals = new CredentialApprovalBroker()
const permissionRequests = new BrowserPermissionBroker()
const codexRuntimes = new Map<string, CodexWorkspaceRuntime>()
let toolRegistry: ToolRegistry | null = null
let researchService: ResearchService | null = null
let disposeResearch: (() => void) | null = null
let artifactStore: ArtifactStore | null = null
let toolTelemetry: ToolTelemetry | null = null
let antigravityBridge: AntigravityToolBridge | null = null
let cursorBridge: CursorToolBridge | null = null
let browserSessionFlush: Promise<void> | null = null
let cdpAccess: BrowserCdpAccess | null = null
let nativeInstrument: NativeInstrumentService | null = null
const videoJobs = new VideoJobs()
let appAutomationAccess: AppAutomationAccess | null = null
let appCommandAccess: AppCommandAccess | null = null
let stopBrowserCacheMaintenance: (() => void) | null = null
let stopVerifyJanitor: (() => void) | null = null
let browserReadyToLoad: Promise<unknown> | null = null
/** A cookie import this slow is a broken one; the first page loads without it. */
const COOKIE_IMPORT_LOAD_GATE_MS = 5000
/** Long enough after the window's first load that the check cannot compete with the mount. */
const COOKIE_REPAIR_IDLE_MS = 10_000
let quitting = false
let quitFlushed = false
const liveVerifyHandle: LiveVerifyHandle = {
  requested: false,
  pending: null,
  toolRegistry: null,
  researchService: null
}

// The registry keeps every renderer notification behind a liveness check and decides which
// windows hear it: browser state only reaches the main window, which hosts the browser.
function sendToWindows<C extends IpcEventChannel>(channel: C, payload: IpcEventChannels[C]): void {
  windows?.send(channel, payload)
}

const userData = (): string => app.getPath('userData')

if (!claimProfileInstance(app, { profile: userData(), checkout: app.getAppPath(), pid: process.pid }, () => mainWindow)) {
  // A second launch against the same profile focused the owner and is exiting.
} else {
  app.on('second-instance', (_event, argv) => {
    const mode = argv.map(String).find((arg) => arg.startsWith('--live-verify='))?.slice('--live-verify='.length).trim()
    if (mode) requestLiveVerify(liveVerifyHandle, app, mode, false)
  })
  // A bootstrap failure is shown and ends the app; a later stray fault is logged and survived.
  const crashHost = { app, process, showErrorBox: dialog.showErrorBox, hasWindow: () => mainWindow !== null }
  installCrashGuard(crashHost)
  void app.whenReady().then(() => runBootstrap(main, crashHost))
}

async function main(): Promise<void> {
  setAppCheckoutPath(app.getAppPath())
  logGpuFeatureStatus()
  await mkdir(userData(), { recursive: true })
  ;[browserHistory, savedSites, browserTabSession, settings, chatStore, securitySettings, agentLibrary, windowStore] = await Promise.all([
    BrowserHistoryStore.open(join(userData(), 'browser-history.json')),
    SavedSitesStore.open(join(userData(), 'saved-sites.json')),
    BrowserTabSessionStore.open(join(userData(), 'browser-tabs.json')),
    AppSettingsStore.open(join(userData(), 'app-settings.json')),
    ChatStore.open(join(userData(), 'chats.json')),
    SecuritySettingsStore.open(join(userData(), 'security-settings.json')),
    AgentLibraryStore.open(join(userData(), 'agent-library.json')),
    AppWindowStore.open(join(userData(), 'app-windows.json'))
  ])
  savedSites.on('changed', (sites: SavedSite[]) => sendToWindows(IPC.event.savedSitesChanged, sites))
  agentLibrary.on('changed', (agents: SavedAgent[]) => sendToWindows(IPC.event.agentLibraryChanged, agents))
  credentialVault = new CredentialVault(join(userData(), 'credential-vault.json'), safeStorageEncryption(safeStorage, process.platform), {
    secretsRequireKeychain: () => securitySettings!.get().secretsRequireKeychain
  })
  const configuredWorkspace = process.env.CLOSEDAI_WORKSPACE?.trim()
  // An environment-supplied workspace wins for the initial launch, but project changes are
  // still user-owned afterwards. A missing saved selection keeps the existing checkout as the
  // pleasant first-run project rather than dropping people into their home folder unexpectedly.
  const savedSettings = settings.get()
  const isFirstLaunch = savedSettings.chatWorkspacePath === null && !configuredWorkspace
  let chatWorkspace = configuredWorkspace
    ? resolve(configuredWorkspace)
    : savedSettings.chatWorkspacePath ?? app.getAppPath()
  let projectPath: string | null = configuredWorkspace
    ? chatWorkspace
    : isFirstLaunch
      ? chatWorkspace
      : savedSettings.chatProjectPath
  // Bootstrap is a handful of small, unrelated disk reads, and the window cannot paint until
  // the last of them returns. Start them together here and await each where it is first
  // needed: the cookie import alone walks the user's real browser profile.
  const telemetryOpening = started(ToolTelemetry.open(
    join(userData(), 'tool-telemetry.json'),
    join(userData(), 'tool-telemetry.jsonl')
  ))
  // Model catalogs are shared per workspace and across launches, so a pane's non-active
  // providers fill the picker from the last catalog seen instead of each starting a process.
  const catalogOpening = started(ProviderCatalogCache.open(join(userData(), 'provider-catalogs.json')))
  // The one-shot cookie import must finish before the first tab loads, so a restored or home
  // page arrives already signed in rather than racing the import. It walks the user's real
  // browser profile — ~600ms — so on the launch that does it the window no longer waits
  // behind it: only the first page load does, and only until the cap, since a stuck import
  // must not leave someone looking at an empty browser.
  const cookieDeps = mainCookieImportDeps(mainIpcRegistration())
  const cookieImportPending = cookieDeps.enabled() && !cookieDeps.latch.get().browserCookiesImported
  const cookieImport = cookieImportPending
    ? started(importDefaultBrowserCookies(cookieDeps).catch(reportCookieImport))
    : null
  browserReadyToLoad = cookieImport
    ? capped(cookieImport, COOKIE_IMPORT_LOAD_GATE_MS, () => {
        console.warn('[cookie-import] still running; loading the first page without it')
      })
    : null
  // Tools resolve the browser lazily: it is created with the window, after the chat service.
  const browserCoordination = new BrowserCoordination({
    tabs: () => browserService?.tabList() ?? [],
    create: () => {
      if (!browserService) throw new Error('The browser is not available yet')
      // A chat opening a tab for its own work brings it to the front: the user watches the page
      // the model is driving, and Chromium gives the selected tab full cycles to load with.
      return browserService.openNewTab('about:blank', true)
    },
    paneExists: paneId => !!chatService?.paneSnapshot(paneId),
    paneRunning: paneId => chatService?.snapshot().chats.find(row => row.paneId === paneId)?.running ?? false
  })
  const researchOpening = started(createResearchRuntime({
    root: join(userData(), 'research-runs'), browser: () => browserService,
    // The verifier's synthetic pane owns research only in a process that was asked to verify.
    peers: () => liveVerifyHandle.requested
      ? ({
          paneSnapshot: () => ({ threadId: 'live-verify-thread', activeTurnId: 'live-verify-turn' })
        } as unknown as ChatPeerManager)
      : chatService,
    workspace: () => chatWorkspace,
    browserCoordination
  }))
  windows = new AppWindowRegistry({
    store: windowStore,
    openWindow: (id, activate) => openDetachedWindow(id, { openLinkInNewTab: (url) => browserService?.openNewTab(url, false) }, activate),
    forgetPlacement: (id) => BaseWindow.clearPersistedState(`detached-${id}`),
    releaseChats: (id) => chatService?.releaseWindow(id),
    workspaceCwd: () => chatWorkspace,
    selectedChat: () => settings?.get().chatSelectedPaneId ?? null,
    display: (bounds) => {
      const display = screen.getDisplayMatching(bounds)
      return { id: display.id, label: display.label }
    }
  })
  // Pane records that settings used to hold become chat records once; ids are preserved.
  await migrateChatPeersIntoStore(settings, chatStore, { cwd: chatWorkspace, projectPath })
  const workspaceSelector = createChatWorkspaceSelector({
    app,
    settings: settings!,
    chatStore: chatStore!,
    getWorkspace: () => ({ cwd: chatWorkspace, projectPath }),
    setWorkspace: (cwd, nextProjectPath) => {
      chatWorkspace = cwd
      projectPath = nextProjectPath
    }
  })
  const browserAssignmentIdle = new BrowserAssignmentIdleRelease(browserCoordination, (paneId) => {
    const row = chatService?.snapshot({ limit: 0 }).chats.find((chat) => chat.paneId === paneId)
    if (row?.running) return true
    return Boolean(chatService?.paneSnapshot(paneId)?.pausedTurnId)
  })
  const pageAccess = new BrowserPageAccess(() => browserService)
  cdpAccess = new BrowserCdpAccess(() => browserService)
  const networkAccess = new BrowserNetworkAccess(() => browserService)
  appAutomationAccess = new AppAutomationAccess(() => mainWindow)
  appCommandAccess = new AppCommandAccess({
    chat: () => chatService, browser: () => browserService, downloads: () => browserDownloads, window: () => mainWindow,
    windows: () => windows, ui: () => appAutomationAccess, browserCoordination, agentRuns: () => agentRuns, agentLibrary: () => agentLibrary
  })
  const captureAccess = new UiCaptureAccess(() => mainWindow, () => browserService)
  // Full-resolution captures for the transcript; the model only ever receives the scaled copy.
  const screenshots = new ScreenshotStore()
  const research = await researchOpening
  researchService = research.service
  disposeResearch = research.dispose
  const artifacts = createArtifactRuntime({
    root: join(userData(), 'investigation-artifacts'), workerUrl: new URL('./artifact-worker.js', import.meta.url),
    chats: chatStore!, peers: () => chatService
  })
  artifactStore = artifacts.store
  nativeInstrument = new NativeInstrumentService(new NativeControllerClient(new URL('./native-controller.js', import.meta.url)))
  toolRegistry = createToolRegistry([
    nativeInstrumentTools(nativeInstrument, context => {
      const snapshot = context.paneId ? chatService?.paneSnapshot(context.paneId) : undefined
      return !!context.threadId && !!context.turnId && snapshot?.threadId === context.threadId && snapshot.activeTurnId === context.turnId
    }),
    credentialVaultTools(() => credentialVault, () => ({
      requireApproval: () => securitySettings!.get().credentialsRequireApproval,
      approve: (request, signal) => credentialApprovals.ask(request, signal)
    })),
    appTools(() => appCommandAccess, () => appAutomationAccess, () => pageAccess),
    mediaTools({ app: () => appCommandAccess, ui: () => appAutomationAccess, page: () => pageAccess, record: recordPageVideo }, videoJobs),
    browserTools(() => pageAccess, () => networkAccess, () => networkAccess),
    cdpTools(() => cdpAccess, artifacts.service),
    captureTools(() => captureAccess, screenshots),
    research.namespace,
    peerChatTools(() => chatService),
    // Lazy self-reference: the batch dispatches into the registry it is registered in.
    batchTools(() => toolRegistry!, { maxCalls: settings.get().toolBatchMaxCalls })
  ])
  toolRegistry.browserCoordination = browserCoordination
  for (const toolId of settings.get().disabledTools) toolRegistry.setEnabled(toolId, false)
  toolTelemetry = await telemetryOpening
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
  antigravityBridge = new AntigravityToolBridge(toolRegistry, { profileKey: profileKeyFor(userData()), version: app.getVersion() })
  const antigravityStateDir = join(userData(), 'antigravity')
  const cursorStateDir = join(userData(), 'cursor')
  // ACP takes its MCP servers per session, so this bridge registers nothing outside the app.
  cursorBridge = new CursorToolBridge(toolRegistry, { version: app.getVersion() })
  const catalogCache = await catalogOpening
  providerCatalogs = catalogCache
  // What each chat last looked like, so opening one paints before its provider has replayed it.
  chatTranscripts = new ChatTranscriptCache(join(userData(), 'chat-transcripts'))
  chatService = new ChatPeerManager(settings, chatStore, (peerSettings, record) => createPaneChatHub({
    app,
    settings: settings!,
    chatStore: chatStore!,
    codexRuntimes,
    toolRegistry: toolRegistry!,
    screenshots,
    activeBrowserContext,
    antigravityBridge: antigravityBridge!,
    antigravityStateDir,
    cursorBridge: cursorBridge!,
    cursorStateDir,
    peerSettings,
    record,
    catalogs: catalogCache.forWorkspace(record.cwd)
  }), undefined, workspaceSelector, chatTranscripts, (paneId) => {
    const snapshot = chatService?.paneSnapshot(paneId)
    researchService?.cancelPane(paneId, snapshot?.threadId, snapshot?.activeTurnId)
  }, browserAssignmentIdle)
  chatService.on('event', (event: ChatWorkspaceEvent) => {
    if (event.type === 'workspace' && event.snapshot.workspace) windows?.observeWorkspace(event.snapshot.workspace.cwd)
    if (event.type !== 'pane' || !['turn', 'replace'].includes(event.event.type)) return
    const snapshot = chatService?.paneSnapshot(event.paneId)
    researchService?.reconcile(event.paneId, snapshot?.threadId ?? null, snapshot?.activeTurnId ?? null)
  })
  // The loop behind agent chats: every finished turn is followed by the next cycle until paused.
  agentRuns = new AgentRunService(chatStore, chatService)
  agentRuns.on('change', (event: AgentRunsEvent) => sendToWindows(IPC.event.agentRunsEvent, event))
  // A run started from a library entry counts as that agent's use, whichever surface started it.
  agentRuns.on('started', (run: AgentRun) => { if (run.agentId) agentLibrary?.recordRun(run.agentId) })
  liveVerifyHandle.toolRegistry = toolRegistry
  liveVerifyHandle.researchService = researchService
  registerMainProcessIpc(mainIpcRegistration())
  // Measure and prune before the first tab paints so a bloated cache does not slow restore.
  void maintainBrowserCache(userData()).catch((error: unknown) => {
    console.warn('[browser-cache] startup maintenance failed', error)
  })
  openMainWindow(mainWindowHost())
  // Before the first renderer asks: the main window must know which chats detached windows hold.
  if (mainWindow) windows.attachMain(mainWindow)
  windows.restore(chatWorkspace)
  // Every later launch is latched, and all the import does then is confirm the jar is not
  // empty — a read of every cookie in it, which is slower than the first page paints. That
  // repair belongs after the app is up, not in front of it: a jar lost between launches is
  // refilled a moment late, and the launch after it is latched and correct.
  if (!cookieImportPending) {
    mainWindow?.webContents.once('did-finish-load', () => {
      setTimeout(() => { void importDefaultBrowserCookies(cookieDeps).catch(reportCookieImport) },
        COOKIE_REPAIR_IDLE_MS).unref()
    })
  }
  void chatService.start()
  agentRuns.start()
  stopBrowserCacheMaintenance = scheduleBrowserCacheMaintenance(userData())
  stopVerifyJanitor = scheduleVerifyJanitor(() => chatService!.runningPaneIds())
  const liveVerifyMode = process.env.CLOSEDAI_LIVE_VERIFY?.trim() || liveVerifyFromArgv()
  if (liveVerifyMode) requestLiveVerify(liveVerifyHandle, app, liveVerifyMode, true)
}

/**
 * Run work now, deliver its failure to whoever awaits it later. The `catch` marks the
 * rejection handled so a bootstrap step that fails while another is still in flight is
 * reported as the bootstrap failure it is, not as an unhandled rejection.
 */
function started<T>(work: Promise<T>): Promise<T> {
  work.catch(() => {})
  return work
}

function reportCookieImport(error: unknown): void {
  console.warn('[cookie-import] failed', error)
}

/** The same promise, but never waited on for longer than `ms`. */
function capped(work: Promise<unknown>, ms: number, onTimeout: () => void): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { onTimeout(); resolve(null) }, ms)
    timer.unref()
    const settle = (): void => { clearTimeout(timer); resolve(null) }
    void work.then(settle, settle)
  })
}

/** Null for Electron's default userData; a short stable hash for any other profile. */
function profileKeyFor(userDataDir: string): string | null {
  if (resolve(userDataDir) === resolve(join(app.getPath('appData'), app.getName()))) return null
  let hash = 0
  for (let index = 0; index < userDataDir.length; index += 1) hash = (hash * 31 + userDataDir.charCodeAt(index)) >>> 0
  return hash.toString(36)
}

function mainIpcRegistration() {
  return {
    ipcMain,
    sendToWindows,
    windows: () => windows,
    browserService: () => browserService,
    browserDownloads: () => browserDownloads,
    savedSites: () => savedSites,
    chatService: () => chatService,
    agentRuns: () => agentRuns,
    agentLibrary: () => agentLibrary,
    credentialVault: () => credentialVault,
    securitySettings: () => securitySettings,
    settings: () => settings,
    providerCatalogs: () => providerCatalogs,
    toolRegistry: () => toolRegistry,
    toolTelemetry: () => toolTelemetry,
    credentialApprovals,
    permissionRequests
  }
}

function mainWindowHost(): MainWindowHost {
  return {
    downloadsRoot: () => app.getPath('downloads'),
    sendToWindows,
    sendChatEvent: (event) => windows?.sendChatEvent(event),
    browserHistory: browserHistory!,
    browserTabSession,
    securitySettings: securitySettings!,
    permissionRequests,
    chatService,
    browserReadyToLoad,
    toolRegistry,
    toolTelemetry,
    setMainWindow: (window) => { mainWindow = window },
    setBrowserService: (service) => { browserService = service },
    setBrowserDownloads: (service) => { browserDownloads = service },
    setBrowserSessionFlush: (flush) => { browserSessionFlush = flush },
    getBrowserService: () => browserService,
    getMainWindow: () => mainWindow,
    nativeInstrument,
    disposeResearch,
    appAutomationAccess,
    cdpAccess,
    setCdpAccess: (access) => { cdpAccess = access }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  // A second quit (another signal, the last window closing) during the flush must wait for it,
  // not exit mid-write; only the quit issued after the flush settles goes through.
  if (quitting) {
    if (!quitFlushed) event.preventDefault()
    return
  }
  event.preventDefault()
  quitting = true
  // Scroll offsets reach a tab's page state without a strip change, so read the live strip once more.
  if (browserService) browserTabSession?.save(browserService.persistTabs())
  // Detached windows close with the app and reopen at the next launch.
  windows?.shutdown()
  nativeInstrument?.dispose()
  videoJobs.dispose()
  stopBrowserCacheMaintenance?.()
  stopBrowserCacheMaintenance = null
  stopVerifyJanitor?.()
  stopVerifyJanitor = null
  agentRuns?.stop()
  chatService?.stop()
  for (const runtime of codexRuntimes.values()) runtime.stop()
  codexRuntimes.clear()
  const flushSession = browserSessionFlush ?? browserService?.flushSessionData()
  // Bounded: a store or listener that will not settle must not hold the quit open.
  void settleWithin([
    browserHistory?.flush(),
    savedSites?.flush(),
    agentLibrary?.flush(),
    windowStore?.flush(),
    browserTabSession?.close(),
    settings?.set({}),
    chatStore?.flush(),
    chatTranscripts?.flush(),
    artifactStore?.close(),
    providerCatalogs?.flush(),
    flushSession,
    // Leaves the user's agy MCP config without dead localhost endpoints.
    antigravityBridge?.stop(),
    // Nothing outside the app to clean up here; this only closes the listener.
    cursorBridge?.stop()
  ], QUIT_SETTLE_TIMEOUT_MS).then((outcome) => {
    if (outcome === 'timed-out') console.warn(`[main] shutdown flush exceeded ${QUIT_SETTLE_TIMEOUT_MS} ms; quitting anyway`)
    // Provider processes were asked to stop above; none may outlive the app.
    stopAllProcessGroups()
    quitFlushed = true
    app.quit()
  })
})
