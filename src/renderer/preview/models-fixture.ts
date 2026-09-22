import type { ModelManifest, ModelsEvent, ModelSwitch } from '../../shared/model-settings.js'
import type { ModelsApi } from '../settings/models-settings.js'

const SAMPLE: ModelManifest = {
  enabledCount: 3,
  totalCount: 4,
  providers: [{
    provider: 'cursor',
    label: 'Cursor',
    installed: true,
    connection: { state: 'ready', message: 'Ready' },
    models: [
      { enabled: true, model: { provider: 'cursor', id: 'cursor:composer', displayName: 'Composer 2.5', description: '', defaultReasoningEffort: 'high', supportedReasoningEfforts: [], isDefault: true, contextWindow: 200_000 } },
      { enabled: true, model: { provider: 'cursor', id: 'cursor:opus', displayName: 'Claude Opus', description: '', defaultReasoningEffort: 'high', supportedReasoningEfforts: [], isDefault: false, contextWindow: 200_000 } },
      { enabled: false, model: { provider: 'cursor', id: 'cursor:gpt', displayName: 'GPT-5.6', description: '', defaultReasoningEffort: 'high', supportedReasoningEfforts: [], isDefault: false } }
    ]
  }, {
    provider: 'codex',
    label: 'Codex',
    installed: true,
    connection: { state: 'ready', message: 'Ready' },
    models: [
      { enabled: true, model: { provider: 'codex', id: 'gpt', displayName: 'GPT-5.6 Codex', description: '', defaultReasoningEffort: 'high', supportedReasoningEfforts: [], isDefault: true, contextWindow: 400_000 } }
    ]
  }]
}

function recount(manifest: ModelManifest): void {
  manifest.enabledCount = manifest.providers.reduce(
    (sum, section) => sum + section.models.filter((row) => row.enabled).length,
    0
  )
  manifest.totalCount = manifest.providers.reduce((sum, section) => sum + section.models.length, 0)
}

export function createModelsFixture(): ModelsApi {
  let manifest = structuredClone(SAMPLE)
  const listeners = new Set<(event: ModelsEvent) => void>()
  const publish = (event: ModelsEvent): void => {
    for (const listener of listeners) listener(event)
  }
  const apply = (modelId: string, enabled: boolean): void => {
    manifest = structuredClone(manifest)
    for (const section of manifest.providers) {
      for (const row of section.models) {
        if (row.model.id === modelId) row.enabled = enabled
      }
    }
    recount(manifest)
    publish({ type: 'enabled', modelId, enabled })
  }
  return {
    manifest: async () => structuredClone(manifest),
    setEnabled: async (modelId, enabled) => { apply(modelId, enabled) },
    setEnabledMany: async (switches: ModelSwitch[]) => {
      for (const entry of switches) apply(entry.id, entry.enabled)
      publish({ type: 'changed' })
    },
    onEvent: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
}
