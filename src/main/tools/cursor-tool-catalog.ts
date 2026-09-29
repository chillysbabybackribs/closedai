import type { AppSettings } from '../../shared/types.js'
import type { ToolRegistry } from './registry.js'
import { loadToolSliceCatalog } from './tool-slice.js'
import { selectToolSliceId, type ToolSliceTurnInput } from './tool-slice-select.js'

export type CursorToolCatalogBundle = {
  sliceId: string | null
  /** null = every enabled namespace (slicing off or `full` slice). */
  namespaces: readonly string[] | null
}

export async function resolveCursorToolCatalog(
  registry: ToolRegistry,
  settings: Pick<AppSettings, 'chatToolSliceEnabled'>,
  turn: ToolSliceTurnInput
): Promise<CursorToolCatalogBundle> {
  if (!settings.chatToolSliceEnabled) {
    return { sliceId: null, namespaces: null }
  }
  const catalog = await loadToolSliceCatalog()
  const sliceId = selectToolSliceId(catalog, turn)
  if (sliceId === 'full') {
    return { sliceId, namespaces: null }
  }
  const allowlist = catalog.slices[sliceId]?.cursorNamespaces
  if (!allowlist?.length) {
    return { sliceId, namespaces: null }
  }
  const enabled = new Set(registry.enabledNamespaces().map((namespace) => namespace.name))
  const namespaces = allowlist.filter((name) => enabled.has(name))
  return { sliceId, namespaces }
}
