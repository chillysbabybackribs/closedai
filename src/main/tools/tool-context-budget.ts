import { dynamicToolSpecs } from './app-server-tools.js'
import { toolManifest } from './manifest.js'
import type { ToolRegistry } from './registry.js'

export type ToolWireRow = { id: string; chars: number; deferred: boolean }

export type ToolContextBudget = {
  /** Enabled tools the Codex adapter sends eagerly (full schema each turn). */
  eagerWireChars: number
  /** Enabled deferred tools if every stub were expanded to full schema. */
  deferredWireChars: number
  /** Sum of manifest costTokens for enabled tools (stubs for deferred). */
  advertisedTokens: number
  toolCount: number
  eagerTools: ToolWireRow[]
  deferredTools: ToolWireRow[]
}

/** Serialized tool definitions as Codex dynamicTools would measure them (description + schema). */
export function measureToolContextBudget(registry: ToolRegistry): ToolContextBudget {
  const specs = dynamicToolSpecs(registry)
  const eagerTools: ToolWireRow[] = []
  const deferredTools: ToolWireRow[] = []
  let eagerWireChars = 0
  let deferredWireChars = 0
  for (const namespace of specs) {
    for (const tool of namespace.tools) {
      const chars = JSON.stringify({ description: tool.description, parameters: tool.inputSchema }).length
      const row = { id: `${namespace.name}.${tool.name}`, chars, deferred: tool.deferLoading === true }
      if (row.deferred) {
        deferredWireChars += chars
        deferredTools.push(row)
      } else {
        eagerWireChars += chars
        eagerTools.push(row)
      }
    }
  }
  eagerTools.sort((left, right) => right.chars - left.chars)
  deferredTools.sort((left, right) => right.chars - left.chars)
  return {
    eagerWireChars,
    deferredWireChars,
    advertisedTokens: toolManifest(registry, ['codex']).advertisedTokens,
    toolCount: eagerTools.length + deferredTools.length,
    eagerTools,
    deferredTools
  }
}
