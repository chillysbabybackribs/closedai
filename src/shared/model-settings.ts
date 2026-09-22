import type { ChatConnection, ChatModel, ChatProvider } from './chat.js'

export type ModelSwitch = { id: string; enabled: boolean }

export type ModelSettingsRow = {
  model: ChatModel
  /** When false the model is hidden from the composer picker unless it is in use on a chat. */
  enabled: boolean
}

export type ModelSettingsProviderSection = {
  provider: ChatProvider
  label: string
  connection: ChatConnection
  /** False when the CLI is missing on this machine. */
  installed: boolean
  models: ModelSettingsRow[]
}

export type ModelManifest = {
  providers: ModelSettingsProviderSection[]
  /** How many models are enabled across connected providers. */
  enabledCount: number
  totalCount: number
}

export type ModelsEvent =
  | { type: 'enabled'; modelId: string; enabled: boolean }
  | { type: 'changed' }

/** Models shown in the picker: enabled ones plus any id the caller asks to keep visible. */
export function filterPickerModels(models: ChatModel[], disabledModels: readonly string[], keepVisible: readonly string[]): ChatModel[] {
  if (disabledModels.length === 0) return models
  const disabled = new Set(disabledModels)
  const keep = new Set(keepVisible)
  return models.filter((model) => !disabled.has(model.id) || keep.has(model.id))
}

export function applyModelSwitch(disabledModels: readonly string[], modelId: string, enabled: boolean): string[] {
  const next = new Set(disabledModels)
  if (enabled) next.delete(modelId)
  else next.add(modelId)
  return [...next]
}

export function applyModelSwitches(disabledModels: readonly string[], switches: readonly ModelSwitch[]): string[] {
  let next = [...disabledModels]
  for (const entry of switches) next = applyModelSwitch(next, entry.id, entry.enabled)
  return next
}

export function buildModelManifest(
  providers: Array<{
    provider: ChatProvider
    label: string
    connection: ChatConnection
    installed: boolean
    models: ChatModel[]
  }>,
  disabledModels: readonly string[]
): ModelManifest {
  const disabled = new Set(disabledModels)
  let enabledCount = 0
  let totalCount = 0
  const sections: ModelSettingsProviderSection[] = providers.flatMap((entry) => {
    if (entry.models.length === 0) return []
    const rows = entry.models.map((model) => {
      const enabled = !disabled.has(model.id)
      if (enabled) enabledCount += 1
      totalCount += 1
      return { model, enabled }
    })
    return [{ ...entry, models: rows }]
  })
  return { providers: sections, enabledCount, totalCount }
}
