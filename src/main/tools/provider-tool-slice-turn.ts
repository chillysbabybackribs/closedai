import type { ChatProvider } from '../../shared/chat.js'
import type { AppSettings } from '../../shared/types.js'
import type { TurnSurfaceContext } from '../chat-context/turn-context.js'
import { traceLog } from '../trace/trace-log.js'
import type { ToolRegistry } from './registry.js'
import { resolveSlicedToolRegistry, type SlicedToolRegistryBundle } from './slice-tool-registry.js'

export type ToolSliceTurnAttachState = {
  cacheKey: string | null
}

const TRACE_LABEL: Record<'claude' | 'antigravity', string> = {
  claude: 'claude.tool_slice',
  antigravity: 'antigravity.tool_slice'
}

/** Resolve the task slice for this send and apply it when the cache key changes. */
export async function attachToolSliceForTurn(deps: {
  provider: Extract<ChatProvider, 'claude' | 'antigravity'>
  paneId: string | null
  activeTurnId: string | null
  registry: ToolRegistry
  settings: Pick<AppSettings, 'chatToolSliceEnabled'>
  prompt: string
  surface: TurnSurfaceContext | null
  state: ToolSliceTurnAttachState
  cacheKeyOf: (bundle: SlicedToolRegistryBundle) => string
  onApplied: (bundle: SlicedToolRegistryBundle) => Promise<void>
}): Promise<void> {
  const bundle = await resolveSlicedToolRegistry(deps.registry, deps.settings, {
    prompt: deps.prompt,
    surface: deps.surface
  })
  const key = deps.cacheKeyOf(bundle)
  if (deps.state.cacheKey === key) return
  deps.state.cacheKey = key
  await deps.onApplied(bundle)
  if (!bundle.sliceId) return
  traceLog.record({ paneId: deps.paneId, provider: deps.provider, turnId: deps.activeTurnId }, {
    kind: 'tool',
    label: TRACE_LABEL[deps.provider],
    summary: `${bundle.sliceId} (${bundle.promotedIds.length} eager)`,
    detail: { sliceId: bundle.sliceId, promotedIds: bundle.promotedIds },
    ok: true
  })
}
