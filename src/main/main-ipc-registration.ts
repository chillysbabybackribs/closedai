import type { IpcMain } from 'electron'
import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import type { ModelsEvent } from '../shared/model-settings.js'
import type { ToolsEvent } from '../shared/tools.js'
import { IPC, type IpcEventChannel, type IpcEventChannels } from '../shared/ipc-channels.js'
import { registerWindowIpc } from './window-ipc.js'
import { registerAppWindowsIpc } from './windows/ipc.js'
import { registerQuickChatIpc } from './quick-chat-overlay/ipc.js'
import type { QuickChatOverlay } from './quick-chat-overlay/quick-chat-overlay.js'
import { registerWallpaperIpc } from './wallpapers/ipc.js'
import { registerProfilesIpc } from './profiles/ipc.js'
import type { ProfileSession } from './profiles/profile-session.js'
import { WallpaperUploadStore } from './wallpapers/upload-store.js'
import { registerBrowserCoreIpc } from './browser-core-ipc.js'
import { registerBrowserDownloadsIpc } from './browser-downloads-ipc.js'
import { registerSavedSitesIpc } from './saved-sites-ipc.js'
import { registerNotesIpc } from './notes/notes-ipc.js'
import { registerLocalFilesIpc } from './local-files/ipc.js'
import { registerChatIpc } from './chat-ipc.js'
import { registerAgentRunsIpc } from './agent-runs/ipc.js'
import { registerAgentLibraryIpc } from './agent-library/ipc.js'
import { registerTraceIpc } from './trace/ipc.js'
import { registerCredentialVaultIpc } from './credential-vault-ipc.js'
import { registerSecurityIpc } from './security-ipc.js'
import { registerToolsIpc } from './tools/ipc.js'
import { providerSourcesFromHub, registerModelsIpc } from './model-settings/ipc.js'
import { detectProviderAvailability } from './provider-availability.js'
import { importBrowserCookiesNow, type CookieImportDeps } from './browser-cookie-import.js'
import { PARTITION } from './browser-url.js'
import { traceLog } from './trace/trace-log.js'
import type { BrowserService } from './browser-service.js'
import type { BrowserDownloadService } from './browser-download-service.js'
import type { SavedSitesStore } from './saved-sites-store.js'
import type { NotesStore } from './notes/notes-store.js'
import type { NotepadBindings } from './notes/notepad-bindings.js'
import type { ChatPeerManager } from './chat-peers/peer-manager.js'
import type { AgentRunService } from './agent-runs/agent-run-service.js'
import type { AgentLibraryStore } from './agent-library/agent-library-store.js'
import type { CredentialVault } from './credential-vault.js'
import type { SecuritySettingsStore } from './security-settings-store.js'
import type { AppSettingsStore } from './app-settings-store.js'
import type { ProviderCatalogCache } from './chat-context/provider-catalog-cache.js'
import type { ToolRegistry } from './tools/registry.js'
import type { ToolTelemetry } from './tools/telemetry.js'
import type { CredentialApprovalBroker } from './security-approvals.js'
import type { BrowserPermissionBroker } from './browser-permission-broker.js'
import type { AppWindowRegistry } from './windows/app-window-registry.js'

export type MainIpcRegistration = {
  ipcMain: IpcMain
  sendToWindows: <C extends IpcEventChannel>(channel: C, payload: IpcEventChannels[C]) => void
  windows: () => AppWindowRegistry | null
  profiles: ProfileSession
  browserService: () => BrowserService | null
  quickChatOverlay: () => QuickChatOverlay | null
  browserDownloads: () => BrowserDownloadService | null
  savedSites: () => SavedSitesStore | null
  notes: () => NotesStore | null
  notepadBindings: NotepadBindings
  chatService: () => ChatPeerManager | null
  agentRuns: () => AgentRunService | null
  agentLibrary: () => AgentLibraryStore | null
  credentialVault: () => CredentialVault | null
  securitySettings: () => SecuritySettingsStore | null
  settings: () => AppSettingsStore | null
  providerCatalogs: () => ProviderCatalogCache | null
  toolRegistry: () => ToolRegistry | null
  toolTelemetry: () => ToolTelemetry | null
  credentialApprovals: CredentialApprovalBroker
  permissionRequests: BrowserPermissionBroker
}

export function mainCookieImportDeps(reg: MainIpcRegistration): CookieImportDeps {
  return {
    latch: reg.settings()!,
    enabled: () => reg.securitySettings()!.get().importBrowserCookies,
    target: () => session.fromPartition(PARTITION)
  }
}

export function registerMainProcessIpc(reg: MainIpcRegistration): void {
  registerWindowIpc(reg.ipcMain, (event) => BrowserWindow.fromWebContents(event.sender))
  let wallpapers: WallpaperUploadStore | null = null
  registerWallpaperIpc(reg.ipcMain, () => wallpapers ??= new WallpaperUploadStore(join(app.getPath('userData'), 'wallpapers')))
  // The quit path flushes every store first, so the next process opens settled files.
  registerProfilesIpc(reg.ipcMain, reg.profiles, () => { app.relaunch(); app.quit() })
  registerAppWindowsIpc(reg.ipcMain, reg.windows)
  registerQuickChatIpc(reg.ipcMain, reg.quickChatOverlay, reg.windows)
  registerBrowserCoreIpc(reg.ipcMain, reg.browserService, reg.savedSites, (sender) => reg.windows()?.isMain(sender) ?? true)
  registerBrowserDownloadsIpc(reg.ipcMain, reg.browserDownloads)
  registerSavedSitesIpc(reg.ipcMain, reg.savedSites)
  registerNotesIpc(reg.ipcMain, reg.notes, reg.notepadBindings, (chatPaneId) => {
    reg.chatService()?.tagQuickChatSurface(chatPaneId, 'notepad')
  })
  registerLocalFilesIpc(reg.ipcMain, reg.browserService)
  registerChatIpc(reg.ipcMain, reg.chatService, reg.windows)
  registerAgentRunsIpc(reg.ipcMain, reg.agentRuns)
  registerAgentLibraryIpc(reg.ipcMain, reg.agentLibrary)
  registerTraceIpc(reg.ipcMain, traceLog)
  registerCredentialVaultIpc(reg.ipcMain, reg.credentialVault)
  registerSecurityIpc(reg.ipcMain, {
    settings: reg.securitySettings,
    vault: reg.credentialVault,
    credentialApprovals: reg.credentialApprovals,
    permissions: reg.permissionRequests,
    importCookies: () => importBrowserCookiesNow(mainCookieImportDeps(reg)),
    send: reg.sendToWindows
  })
  registerToolsIpc(reg.ipcMain, {
    registry: reg.toolRegistry,
    telemetry: reg.toolTelemetry,
    settings: reg.settings,
    providers: () => [...CHAT_PROVIDERS],
    notifyEvent: (event) => { reg.sendToWindows(IPC.event.toolsEvent, event) },
    onEnabledChanged: async (toolId, enabled, disabledIds) => {
      await reg.settings()?.set({ disabledTools: disabledIds })
      reg.sendToWindows(IPC.event.toolsEvent, { type: 'enabled', toolId, enabled } satisfies ToolsEvent)
    },
    onEnabledManyChanged: async (disabledIds) => {
      await reg.settings()?.set({ disabledTools: disabledIds })
      reg.sendToWindows(IPC.event.toolsEvent, { type: 'changed' } satisfies ToolsEvent)
    }
  })
  registerModelsIpc(reg.ipcMain, {
    settings: reg.settings,
    providerAvailability: () => detectProviderAvailability(),
    providers: () => {
      const hub = reg.chatService()?.modelSettings.selectedHub()
      const cwd = reg.chatService()?.snapshot().workspace?.cwd ?? reg.settings()?.get().chatWorkspacePath
      const catalogs = reg.providerCatalogs()
      if (!hub || !cwd || !catalogs) return []
      const workspaceCatalogs = catalogs.forWorkspace(cwd)
      return providerSourcesFromHub(
        (provider) => {
          const snapshot = hub.providerSnapshot(provider)
          return { provider, connection: snapshot.connection, models: snapshot.models }
        },
        (provider) => workspaceCatalogs.read(provider)?.models
      )
    },
    onDisabledChanged: async (modelId, enabled, disabledIds) => {
      await reg.settings()?.set({ disabledModels: disabledIds })
      reg.chatService()?.modelSettings.refresh()
      reg.sendToWindows(IPC.event.modelsEvent, { type: 'enabled', modelId, enabled } satisfies ModelsEvent)
    },
    onDisabledManyChanged: async (disabledIds) => {
      await reg.settings()?.set({ disabledModels: disabledIds })
      reg.chatService()?.modelSettings.refresh()
      reg.sendToWindows(IPC.event.modelsEvent, { type: 'changed' } satisfies ModelsEvent)
    }
  })
}
