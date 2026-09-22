import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage } from 'electron'
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
import { BrowserTabSessionStore } from './browser-tab-session-store.js'
import { AppSettingsStore } from './app-settings-store.js'
import { BrowserDownloadService } from './browser-download-service.js'
import { AgentWorkspaceSurface } from './agent-workspace-surface.js'
import { maintainBrowserCache, scheduleBrowserCacheMaintenance } from './browser-cache-maintenance.js'
import { importDefaultBrowserCookies } from './browser-cookie-import.js'
import { CodexWorkspaceRuntime } from './codex-workspace-runtime.js'
import { AgentRunner } from './agent-runner/agent-runner.js'
import { runnerChat, runnerStore } from './agent-runner/runner-hosts.js'
import { ChatPeerManager } from './chat-peers/peer-manager.js'
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
import type { ResearchLibrary } from './research-library/service.js'
import { createArtifactRuntime } from './investigations/artifact-runtime.js'
import type { ArtifactStore } from './investigations/artifact-store.js'
import type { ResearchService } from './tools/search/research/service.js'
import { peerChatTools } from './tools/peer-chats/index.js'
import { projectTools } from './tools/project/index.js'
import { NativeControllerClient } from './native-instrument/client.js'
import { NativeInstrumentService } from './native-instrument/service.js'
import { nativeInstrumentTools } from './tools/native-instrument/index.js'
import { ToolTelemetry } from './tools/telemetry.js'
import { traceToolCalls } from './trace/taps.js'
import { ProjectHub } from './project-store/project-hub.js'
import { CredentialVault } from './credential-vault.js'
import { safeStorageEncryption } from './safe-storage-encryption.js'
import { SecuritySettingsStore } from './security-settings-store.js'
import { CredentialApprovalBroker } from './security-approvals.js'
import { BrowserPermissionBroker } from './browser-permission-broker.js'
import type { ChatWorkspaceEvent } from '../shared/chat-peers.js'
import type { IpcEventChannel, IpcEventChannels } from '../shared/ipc-channels.js'
import { liveVerifyFromArgv, requestLiveVerify, type LiveVerifyHandle } from './app-live-verify.js'
import { createChatWorkspaceSelector } from './main-workspace-selector.js'
import { createPaneChatHub } from './main-pane-chat-hub.js'
import { mainCookieImportDeps, registerMainProcessIpc } from './main-ipc-registration.js'
import { openMainWindow, type MainWindowHost } from './main-window-setup.js'

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
let agentWorkspaceSurface: AgentWorkspaceSurface | null = null
let browserDownloads: BrowserDownloadService | null = null
let browserHistory: BrowserHistoryStore | null = null
let browserTabSession: BrowserTabSessionStore | null = null
let settings: AppSettingsStore | null = null
let chatStore: ChatStore | null = null
let projectHub: ProjectHub | null = null
let chatTranscripts: ChatTranscriptCache | null = null
let providerCatalogs: ProviderCatalogCache | null = null
let chatService: ChatPeerManager | null = null
let agentRunner: AgentRunner | null = null
let credentialVault: CredentialVault | null = null
let securitySettings: SecuritySettingsStore | null = null
// Pending user decisions (credential reads, page permissions); empty unless Settings → Security asks for them.
const credentialApprovals = new CredentialApprovalBroker()
const permissionRequests = new BrowserPermissionBroker()
const codexRuntimes = new Map<string, CodexWorkspaceRuntime>()
let toolRegistry: ToolRegistry | null = null
let researchService: ResearchService | null = null
let researchLibrary: ResearchLibrary | null = null
let disposeResearch: (() => void) | null = null
let artifactStore: ArtifactStore | null = null
let toolTelemetry: ToolTelemetry | null = null
let antigravityBridge: AntigravityToolBridge | null = null
let cursorBridge: CursorToolBridge | null = null
let browserSessionFlush: Promise<void> | null = null
let cdpAccess: BrowserCdpAccess | null = null
let nativeInstrument: NativeInstrumentService | null = null
let appAutomationAccess: AppAutomationAccess | null = null
let appCommandAccess: AppCommandAccess | null = null
let stopBrowserCacheMaintenance: (() => void) | null = null
let quitting = false
const liveVerifyHandle: LiveVerifyHandle = {
  requested: false,
  pending: null,
  toolRegistry: null,
  researchService: null,
  userDataPath: () => app.getPath('userData')
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
    if (mode) requestLiveVerify(liveVerifyHandle, app, mode, false)
  })
  // A bootstrap failure is shown and ends the app; a later stray fault is logged and survived.
  const crashHost = { app, process, showErrorBox: dialog.showErrorBox, hasWindow: () => mainWindow !== null }
  installCrashGuard(crashHost)
  void app.whenReady().then(() => runBootstrap(main, crashHost))
}

async function main(): Promise<void> {
  logGpuFeatureStatus()
  await mkdir(userData(), { recursive: true })
  ;[browserHistory, browserTabSession, settings, chatStore, securitySettings] = await Promise.all([
    BrowserHistoryStore.open(join(userData(), 'browser-history.json')),
    BrowserTabSessionStore.open(join(userData(), 'browser-tabs.json')),
    AppSettingsStore.open(join(userData(), 'app-settings.json')),
    ChatStore.open(join(userData(), 'chats.json')),
    SecuritySettingsStore.open(join(userData(), 'security-settings.json'))
  ])
  projectHub = new ProjectHub()
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
    browserCoordination
  })
  agentWorkspaceSurface = new AgentWorkspaceSurface()
  const captureAccess = new UiCaptureAccess(() => mainWindow, () => browserService, () => agentWorkspaceSurface?.current() ?? null)
  // Full-resolution captures for the transcript; the model only ever receives the scaled copy.
  const screenshots = new ScreenshotStore()
  const research = await createResearchRuntime({
    libraryPath: join(userData(), 'research-library.json'),
    root: join(userData(), 'research-runs'), browser: () => browserService,
    // The verifier's synthetic pane owns research only in a process that was asked to verify.
    peers: () => liveVerifyHandle.requested
      ? ({
          paneSnapshot: () => ({ threadId: 'live-verify-thread', activeTurnId: 'live-verify-turn' })
        } as unknown as ChatPeerManager)
      : chatService,
    workspace: () => chatWorkspace,
    browserCoordination
  })
  researchService = research.service
  researchLibrary = research.library
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
    appTools(() => appCommandAccess, () => appAutomationAccess),
    browserTools(() => pageAccess, () => networkAccess, () => networkAccess),
    cdpTools(() => cdpAccess, artifacts.service),
    captureTools(() => captureAccess, screenshots),
    research.namespace,
    peerChatTools(() => chatService),
    // A chat writes into the project it runs in: the agent workspace's coordinator and the worker
    // chats it opens share one store by path, so their plans and results meet on the canvas.
    projectTools(() => projectHub, (paneId) => {
      const record = chatStore?.get(paneId)
      return record ? record.projectPath ?? record.cwd : null
    }),
    // Lazy self-reference: the batch dispatches into the registry it is registered in.
    batchTools(() => toolRegistry!, { maxCalls: settings.get().toolBatchMaxCalls })
  ])
  toolRegistry.browserCoordination = browserCoordination
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
  antigravityBridge = new AntigravityToolBridge(toolRegistry, { profileKey: profileKeyFor(userData()), version: app.getVersion() })
  const antigravityStateDir = join(userData(), 'antigravity')
  const cursorStateDir = join(userData(), 'cursor')
  // ACP takes its MCP servers per session, so this bridge registers nothing outside the app.
  cursorBridge = new CursorToolBridge(toolRegistry, { version: app.getVersion() })
  // Model catalogs are shared per workspace and across launches, so a pane's non-active
  // providers fill the picker from the last catalog seen instead of each starting a process.
  const catalogCache = await ProviderCatalogCache.open(join(userData(), 'provider-catalogs.json'))
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
    if (event.type !== 'pane' || !['turn', 'replace'].includes(event.event.type)) return
    const snapshot = chatService?.paneSnapshot(event.paneId)
    researchService?.reconcile(event.paneId, snapshot?.threadId ?? null, snapshot?.activeTurnId ?? null)
  })
  liveVerifyHandle.toolRegistry = toolRegistry
  liveVerifyHandle.researchService = researchService
  registerMainProcessIpc(mainIpcRegistration())
  // The one-shot cookie import runs before the first tab loads, so a restored or home page
  // arrives already signed in rather than racing the import.
  await importDefaultBrowserCookies(mainCookieImportDeps(mainIpcRegistration()))
  // Measure and prune before the first tab paints so a bloated cache does not slow restore.
  void maintainBrowserCache(userData()).catch((error: unknown) => {
    console.warn('[browser-cache] startup maintenance failed', error)
  })
  openMainWindow(mainWindowHost())
  void chatService.start()
  // The agent workspace's hive: it dispatches queued tasks to worker chats and keeps going as
  // each one lands, so a build continues whether or not anyone is watching the workspace.
  agentRunner = new AgentRunner({
    store: () => (projectHub ? runnerStore(projectHub) : null),
    chat: () => (chatService ? runnerChat(chatService) : null),
    warn: (message) => console.warn(message)
  })
  agentRunner.start()
  stopBrowserCacheMaintenance = scheduleBrowserCacheMaintenance(userData())
  const liveVerifyMode = process.env.CLOSEDAI_LIVE_VERIFY?.trim() || liveVerifyFromArgv()
  if (liveVerifyMode) requestLiveVerify(liveVerifyHandle, app, liveVerifyMode, true)
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
    sendToMainWindow,
    researchLibrary: () => researchLibrary,
    mainWindow: () => mainWindow,
    browserService: () => browserService,
    agentWorkspaceSurface: () => agentWorkspaceSurface,
    browserDownloads: () => browserDownloads,
    chatService: () => chatService,
    projectHub: () => projectHub,
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
    sendToMainWindow,
    browserHistory: browserHistory!,
    browserTabSession,
    securitySettings: securitySettings!,
    permissionRequests,
    chatService,
    projectHub,
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
    researchLibrary,
    appAutomationAccess,
    cdpAccess,
    setCdpAccess: (access) => { cdpAccess = access }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  nativeInstrument?.dispose()
  stopBrowserCacheMaintenance?.()
  stopBrowserCacheMaintenance = null
  agentRunner?.stop()
  agentRunner = null
  chatService?.stop()
  for (const runtime of codexRuntimes.values()) runtime.stop()
  codexRuntimes.clear()
  const flushSession = browserSessionFlush ?? browserService?.flushSessionData()
  // Bounded: a store or listener that will not settle must not hold the quit open.
  void settleWithin([
    browserHistory?.flush(),
    browserTabSession?.close(),
    settings?.set({}),
    chatStore?.flush(),
    projectHub?.flushAll(),
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
    app.quit()
  })
})
