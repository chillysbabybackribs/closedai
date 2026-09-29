import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appCheckoutPath } from '../app-checkout.js'
import { parseToolSliceCatalog, type ToolSliceCatalog, type ToolSliceDefinition } from '../../shared/tool-slices.js'
import { measureToolContextBudget } from './tool-context-budget.js'
import { ToolRegistry, type ToolRegistry as ToolRegistryType } from './registry.js'
import type { ToolDefinition, ToolNamespace } from './tool.js'

/** Source module dir (tests); bundled main is `out/main/index.js` so `../../..` is not the repo. */
function toolSliceCatalogFile(): string {
  try {
    return path.join(appCheckoutPath(), 'scripts/tool-slices.json')
  } catch {
    const fromSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
    return path.join(fromSource, 'scripts/tool-slices.json')
  }
}

let cachedCatalog: ToolSliceCatalog | null = null

export async function loadToolSliceCatalog(): Promise<ToolSliceCatalog> {
  if (cachedCatalog) return cachedCatalog
  const source = await readFile(toolSliceCatalogFile(), 'utf8')
  cachedCatalog = parseToolSliceCatalog(JSON.parse(source))
  return cachedCatalog
}

/** Clear catalog cache (tests). */
export function resetToolSliceCatalogCache(): void {
  cachedCatalog = null
}

export type PromotedRegistry = {
  registry: ToolRegistryType
  sliceId: string
  promotedIds: string[]
  eagerWireChars: number
}

/**
 * Build a registry view that promotes deferred tools to eager in priority order until the Codex
 * wire budget is exhausted. User-disabled tools are never promoted. Does not hide tools.
 */
export function applyToolSlice(registry: ToolRegistryType, slice: ToolSliceDefinition, wireCap: number): PromotedRegistry {
  const resetEager = slice.resetEager === true
  const promoteSet = greedyPromote(registry, slice.promotePriority, wireCap, resetEager)
  const promotedIds = [...promoteSet].sort()
  const next = new ToolRegistry(cloneNamespaces(registry, promoteSet, resetEager))
  return {
    registry: next,
    sliceId: '',
    promotedIds,
    eagerWireChars: measureToolContextBudget(next).eagerWireChars
  }
}

export function applyToolSliceById(registry: ToolRegistryType, catalog: ToolSliceCatalog, sliceId: string): PromotedRegistry {
  const slice = catalog.slices[sliceId]
  if (!slice) throw new Error(`Unknown tool slice "${sliceId}"`)
  const applied = applyToolSlice(registry, slice, catalog.codexEagerWireCap)
  return { ...applied, sliceId }
}

function greedyPromote(registry: ToolRegistryType, priority: readonly string[], wireCap: number, resetEager: boolean): Set<string> {
  const chosen = new Set<string>()
  const known = new Set(registry.names())
  for (const id of priority) {
    if (!known.has(id)) continue
    if (!toolAdvertised(registry, id)) continue
    chosen.add(id)
    const trial = new ToolRegistry(cloneNamespaces(registry, chosen, resetEager))
    if (measureToolContextBudget(trial).eagerWireChars > wireCap) {
      chosen.delete(id)
    }
  }
  return chosen
}

function toolAdvertised(registry: ToolRegistryType, toolId: string): boolean {
  const [namespace, name] = toolId.split('.')
  if (!namespace || !name) return false
  const ns = registry.enabledNamespaces().find((entry) => entry.name === namespace)
  const tool = ns?.tools.find((entry) => entry.name === name)
  if (!tool) return false
  if (!tool.actions?.length) return registry.isEnabled(toolId)
  return tool.actions.some((action) => registry.isEnabled(`${toolId}.${action.name}`))
}

function cloneNamespaces(registry: ToolRegistryType, promote: Set<string>, resetEager: boolean): ToolNamespace[] {
  return registry.enabledNamespaces().map((namespace) => ({
    ...namespace,
    tools: namespace.tools.map((tool) => {
      let next = tool
      if (resetEager && !next.deferLoading) next = { ...next, deferLoading: true }
      return promoteTool(namespace.name, next, promote)
    })
  }))
}

function promoteTool(namespace: string, tool: ToolDefinition, promote: Set<string>): ToolDefinition {
  const toolId = `${namespace}.${tool.name}`
  if (promote.has(toolId) && tool.deferLoading) return { ...tool, deferLoading: false }
  return tool
}

/** Validate slice ids and promotion budgets against a registry (CI-friendly). */
export function validateToolSliceCatalog(catalog: ToolSliceCatalog, registry: ToolRegistryType): string[] {
  const problems: string[] = []
  const known = new Set(registry.names())
  for (const [id, slice] of Object.entries(catalog.slices)) {
    for (const toolId of slice.promotePriority) {
      if (!known.has(toolId)) problems.push(`slice "${id}": unknown tool "${toolId}"`)
    }
    const applied = applyToolSlice(registry, slice, catalog.codexEagerWireCap)
    if (applied.eagerWireChars > catalog.codexEagerWireCap) {
      problems.push(`slice "${id}": eager wire ${applied.eagerWireChars} exceeds cap ${catalog.codexEagerWireCap}`)
    }
  }
  return problems
}
