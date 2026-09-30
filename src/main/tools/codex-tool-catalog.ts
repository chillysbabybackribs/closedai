import type { AppSettings } from '../../shared/types.js'
import { dynamicToolSpecs, type DynamicToolSpec } from './app-server-tools.js'
import type { ToolRegistry } from './registry.js'
import { resolveSlicedToolRegistry } from './slice-tool-registry.js'
import type { ToolSliceTurnInput } from './tool-slice-select.js'

export type { ToolSliceTurnInput } from './tool-slice-select.js'

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
  const bundle = await resolveSlicedToolRegistry(registry, settings, turn)
  const view = bundle.advertisement ?? registry
  return {
    dynamicTools: dynamicToolSpecs(view),
    sliceId: bundle.sliceId,
    promotedIds: bundle.promotedIds
  }
}
