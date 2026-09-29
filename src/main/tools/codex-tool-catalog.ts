import type { AppSettings } from '../../shared/types.js'
import { dynamicToolSpecs, type DynamicToolSpec } from './app-server-tools.js'
import type { ToolRegistry } from './registry.js'
import { applyToolSliceById, loadToolSliceCatalog } from './tool-slice.js'
import { selectToolSliceId, type ToolSliceTurnInput } from './tool-slice-select.js'

export type CodexToolCatalogBundle = {
  dynamicTools: DynamicToolSpec[]
  sliceId: string | null
  promotedIds: readonly string[]
}

export async function resolveCodexToolCatalog(
  registry: ToolRegistry,
  settings: Pick<AppSettings, 'chatToolSliceEnabled'>,
  turn: ToolSliceTurnInput
): Promise<CodexToolCatalogBundle> {
  if (!settings.chatToolSliceEnabled) {
    return { dynamicTools: dynamicToolSpecs(registry), sliceId: null, promotedIds: [] }
  }
  const catalog = await loadToolSliceCatalog()
  const sliceId = selectToolSliceId(catalog, turn)
  const applied = applyToolSliceById(registry, catalog, sliceId)
  return {
    dynamicTools: dynamicToolSpecs(applied.registry),
    sliceId,
    promotedIds: applied.promotedIds
  }
}
