import type { IpcMain } from 'electron'
import { session } from 'electron'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import type { ModelsEvent } from '../shared/model-settings.js'
import type { ToolsEvent } from '../shared/tools.js'
import { IPC, type IpcEventChannel, type IpcEventChannels } from '../shared/ipc-channels.js'
import { registerWindowIpc } from './window-ipc.js'
import { registerBrowserCoreIpc } from './browser-core-ipc.js'
import { registerBrowserDownloadsIpc } from './browser-downloads-ipc.js'
import { registerSavedSitesIpc } from './saved-sites-ipc.js'
import { registerLocalFilesIpc } from './local-files/ipc.js'
import { registerChatIpc } from './chat-ipc.js'
import { registerAgentRunsIpc } from './agent-runs/ipc.js'
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
import type { ChatPeerManager } from './chat-peers/peer-manager.js'
import type { AgentRunService } from './agent-runs/agent-run-service.js'
import type { CredentialVault } from './credential-vault.js'
import type { SecuritySettingsStore } from './security-settings-store.js'
import type { AppSettingsStore } from './app-settings-store.js'
import type { ProviderCatalogCache } from './chat-context/provider-catalog-cache.js'
import type { ToolRegistry } from './tools/registry.js'
import type { ToolTelemetry } from './tools/telemetry.js'
import type { CredentialApprovalBroker } from './security-approvals.js'
import type { BrowserPermissionBroker } from './browser-permission-broker.js'
import type { BrowserWindow } from 'electron'

export type MainIpcRegistration = {
  ipcMain: IpcMain
  sendToMainWindow: <C extends IpcEventChannel>(channel: C, payload: IpcEventChannels[C]) => void
  mainWindow: () => BrowserWindow | null
  browserService: () => BrowserService | null
  browserDownloads: () => BrowserDownloadService | null
  savedSites: () => SavedSitesStore | null
  chatService: () => ChatPeerManager | null
  agentRuns: () => AgentRunService | null
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
  registerWindowIpc(reg.ipcMain, reg.mainWindow)
  registerBrowserCoreIpc(reg.ipcMain, reg.browserService, reg.savedSites)
  registerBrowserDownloadsIpc(reg.ipcMain, reg.browserDownloads)
  registerSavedSitesIpc(reg.ipcMain, reg.savedSites)
  registerLocalFilesIpc(reg.ipcMain, reg.browserService)
  registerChatIpc(reg.ipcMain, reg.chatService)
  registerAgentRunsIpc(reg.ipcMain, reg.agentRuns)
  registerTraceIpc(reg.ipcMain, traceLog)
  registerCredentialVaultIpc(reg.ipcMain, reg.credentialVault)
  registerSecurityIpc(reg.ipcMain, {
    settings: reg.securitySettings,
    vault: reg.credentialVault,
    credentialApprovals: reg.credentialApprovals,
    permissions: reg.permissionRequests,
    importCookies: () => importBrowserCookiesNow(mainCookieImportDeps(reg)),
    send: reg.sendToMainWindow
  })
  registerToolsIpc(reg.ipcMain, {
    registry: reg.toolRegistry,
    telemetry: reg.toolTelemetry,
    providers: () => [...CHAT_PROVIDERS],
    onEnabledChanged: async (toolId, enabled, disabledIds) => {
      await reg.settings()?.set({ disabledTools: disabledIds })
      reg.sendToMainWindow(IPC.event.toolsEvent, { type: 'enabled', toolId, enabled } satisfies ToolsEvent)
    },
    onEnabledManyChanged: async (disabledIds) => {
      await reg.settings()?.set({ disabledTools: disabledIds })
      reg.sendToMainWindow(IPC.event.toolsEvent, { type: 'changed' } satisfies ToolsEvent)
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
      reg.sendToMainWindow(IPC.event.modelsEvent, { type: 'enabled', modelId, enabled } satisfies ModelsEvent)
    },
    onDisabledManyChanged: async (disabledIds) => {
      await reg.settings()?.set({ disabledModels: disabledIds })
      reg.chatService()?.modelSettings.refresh()
      reg.sendToMainWindow(IPC.event.modelsEvent, { type: 'changed' } satisfies ModelsEvent)
    }
  })
}
