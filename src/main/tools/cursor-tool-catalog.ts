import type { AppSettings } from '../../shared/types.js'
import type { ToolRegistry } from './registry.js'
import { loadToolSliceCatalog } from './tool-slice.js'
import { selectToolSliceId, type ToolSliceTurnInput } from './tool-slice-select.js'

export type CursorToolCatalogBundle = {
  sliceId: string | null
  /** null = every enabled namespace; Cursor currently preserves the full catalog. */
  namespaces: readonly string[] | null
}

export async function resolveCursorToolCatalog(
  _registry: ToolRegistry,
  settings: Pick<AppSettings, 'chatToolSliceEnabled'>,
  turn: ToolSliceTurnInput
): Promise<CursorToolCatalogBundle> {
  if (!settings.chatToolSliceEnabled) {
    return { sliceId: null, namespaces: null }
  }
  const catalog = await loadToolSliceCatalog()
  const sliceId = selectToolSliceId(catalog, turn)
  // ACP exposes only attached MCP servers; omitted namespaces have no discovery path.
  // Keep the selected slice for telemetry, but preserve every enabled capability until
  // Cursor supports deferred attachment. Heuristics must not become access control.
  return { sliceId, namespaces: null }
}
