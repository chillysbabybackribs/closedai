import type { IpcMain } from 'electron'
import type { ChatConnection, ChatModel, ChatProvider } from '../../shared/chat.js'
import { CHAT_PROVIDERS, CHAT_PROVIDER_LABELS } from '../../shared/chat-providers.js'
import { IPC } from '../../shared/ipc-channels.js'
import { applyModelSwitch, applyModelSwitches, buildModelManifest, type ModelSwitch } from '../../shared/model-settings.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ProviderAvailability } from '../../shared/provider-availability.js'

export type ModelSettingsProviderSource = {
  provider: ChatProvider
  connection: ChatConnection
  models: ChatModel[]
}

export type ModelsIpcDeps = {
  settings: () => AppSettingsAccess | null
  providers: () => ModelSettingsProviderSource[]
  providerAvailability: () => Promise<ProviderAvailability[]>
  onDisabledChanged: (modelId: string, enabled: boolean, disabledIds: string[]) => Promise<void>
  onDisabledManyChanged: (disabledIds: string[]) => Promise<void>
}

async function manifest(deps: ModelsIpcDeps) {
  const settings = deps.settings()
  if (!settings) throw new Error('Model settings are not available')
  const installed = new Map((await deps.providerAvailability()).map((entry) => [entry.provider, entry.installed]))
  const disabledModels = settings.get().disabledModels
  return buildModelManifest(
    connectedProviderSources(deps.providers()).map((entry) => ({
      provider: entry.provider,
      label: CHAT_PROVIDER_LABELS[entry.provider],
      connection: entry.connection,
      installed: installed.get(entry.provider) ?? true,
      models: entry.models
    })),
    disabledModels
  )
}

export function registerModelsIpc(ipcMain: IpcMain, deps: ModelsIpcDeps): void {
  ipcMain.handle(IPC.invoke.models.manifest, () => manifest(deps))
  ipcMain.handle(IPC.invoke.models.setEnabled, async (_event, modelId: string, enabled: boolean) => {
    const settings = deps.settings()
    if (!settings) throw new Error('Model settings are not available')
    if (typeof modelId !== 'string' || typeof enabled !== 'boolean') throw new Error('Invalid model toggle')
    const disabledIds = applyModelSwitch(settings.get().disabledModels, modelId, enabled)
    await deps.onDisabledChanged(modelId, enabled, disabledIds)
  })
  ipcMain.handle(IPC.invoke.models.setEnabledMany, async (_event, switches: unknown) => {
    const settings = deps.settings()
    if (!settings) throw new Error('Model settings are not available')
    if (!Array.isArray(switches) || !switches.every((entry) =>
      entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.enabled === 'boolean')) {
      throw new Error('Invalid model switches')
    }
    const disabledIds = applyModelSwitches(settings.get().disabledModels, switches as ModelSwitch[])
    await deps.onDisabledManyChanged(disabledIds)
  })
}

/** Merge live provider catalogs with the workspace cache, like the chat hub picker does. */
export function mergeProviderCatalog(
  _provider: ChatProvider,
  liveModels: ChatModel[],
  cachedModels: ChatModel[] | undefined
): ChatModel[] {
  return liveModels.length > 0 ? liveModels : cachedModels ?? []
}

/** Settings lists a provider only when it is connected (ready) and has models to choose from. */
export function connectedProviderSources(
  snapshots: ModelSettingsProviderSource[]
): ModelSettingsProviderSource[] {
  return snapshots.filter((entry) => entry.connection.state === 'ready' && entry.models.length > 0)
}

/** Read every provider from a hub-like surface for the active workspace. */
export function providerSourcesFromHub(
  read: (provider: ChatProvider) => ModelSettingsProviderSource,
  cached: (provider: ChatProvider) => ChatModel[] | undefined
): ModelSettingsProviderSource[] {
  return CHAT_PROVIDERS.map((provider) => {
    const source = read(provider)
    return {
      provider,
      connection: source.connection,
      models: mergeProviderCatalog(provider, source.models, cached(provider))
    }
  })
}
