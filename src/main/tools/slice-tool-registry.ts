import type { AppSettings } from '../../shared/types.js'
import type { ToolRegistry } from './registry.js'
import { applyToolSliceById, loadToolSliceCatalog } from './tool-slice.js'
import { selectToolSliceId, type ToolSliceTurnInput } from './tool-slice-select.js'
import type { ToolDefinition } from './tool.js'

/** Advertisement-only registry view; execution stays on the live pane registry. */
export type SlicedToolRegistryBundle = {
  sliceId: string | null
  promotedIds: readonly string[]
  advertisement: ToolRegistry | null
}

export async function resolveSlicedToolRegistry(
  registry: ToolRegistry,
  settings: Pick<AppSettings, 'chatToolSliceEnabled'> & Partial<Pick<AppSettings, 'chatCursorBaselineEnabled'>>,
  turn: ToolSliceTurnInput
): Promise<SlicedToolRegistryBundle> {
  if (settings.chatCursorBaselineEnabled === true || !settings.chatToolSliceEnabled) {
    return { sliceId: null, promotedIds: [], advertisement: null }
  }
  const catalog = await loadToolSliceCatalog()
  const sliceId = selectToolSliceId(catalog, turn)
  if (sliceId === 'full') {
    return { sliceId, promotedIds: [], advertisement: null }
  }
  const applied = applyToolSliceById(registry, catalog, sliceId)
  return { sliceId, promotedIds: applied.promotedIds, advertisement: applied.registry }
}

/** Whether a tool is eager (alwaysLoad / agy eager) given an optional slice advertisement view. */
export function toolAdvertisedEager(
  advertisement: ToolRegistry | null,
  namespace: string,
  tool: ToolDefinition
): boolean {
  if (!advertisement) return !tool.deferLoading
  const adv = advertisement.enabledNamespaces().find((entry) => entry.name === namespace)
    ?.tools.find((entry) => entry.name === tool.name)
  return adv ? !adv.deferLoading : !tool.deferLoading
}

export function slicedToolRegistryKey(bundle: SlicedToolRegistryBundle): string {
  if (!bundle.sliceId) return ''
  return `${bundle.sliceId}\0${bundle.promotedIds.join('\0')}`
}
