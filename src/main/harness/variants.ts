import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolRegistry } from '../tools/registry.js'
import { closedAiDeveloperInstructions } from '../chat-context/developer-instructions.js'

export type HarnessVariant = {
  id: string
  base?: string
  overrides?: {
    tools?: Record<string, { description?: string }>
    instructions?: { append?: string }
  }
}

export async function loadHarnessVariant(variantsDir: string, id: string): Promise<HarnessVariant> {
  const path = join(variantsDir, `${id}.json`)
  const raw = JSON.parse(await readFile(path, 'utf8')) as HarnessVariant
  if (raw.id !== id) throw new Error(`Variant id mismatch in ${path}: expected ${id}, got ${raw.id}`)
  return raw
}

/** Patch enabled tool descriptions before advertising dynamicTools to Codex. */
export function applyVariantToRegistry(registry: ToolRegistry, variant?: HarnessVariant): void {
  const tools = variant?.overrides?.tools
  if (!tools) return
  for (const namespace of registry.namespaces) {
    for (const tool of namespace.tools) {
      const toolId = `${namespace.name}.${tool.name}`
      const patch = tools[toolId]
      if (patch?.description) tool.description = patch.description
      for (const action of tool.actions ?? []) {
        const actionId = `${toolId}.${action.name}`
        const actionPatch = tools[actionId]
        if (actionPatch?.description) action.description = actionPatch.description
      }
    }
  }
}

export function harnessDeveloperInstructions(variant?: HarnessVariant): string {
  const base = closedAiDeveloperInstructions()
  const append = variant?.overrides?.instructions?.append?.trim()
  return append ? `${base}\n${append}` : base
}
