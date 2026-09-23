import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolRegistry } from '../tools/registry.js'

export type HarnessInstructionOverrides = {
  prepend?: string
  append?: string
  /** Drop instruction lines at these zero-based indices (after splitting on `\n`). */
  omitLineIndices?: number[]
}

export type HarnessVariant = {
  id: string
  base?: string
  overrides?: {
    tools?: Record<string, { description?: string }>
    instructions?: HarnessInstructionOverrides
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
  const inst = variant?.overrides?.instructions
  let text = ''
  const omit = inst?.omitLineIndices
  if (omit?.length) {
    const blocked = new Set(omit)
    text = text.split('\n').filter((_, index) => !blocked.has(index)).join('\n')
  }
  const prepend = inst?.prepend?.trim()
  if (prepend) text = [prepend, text].filter(Boolean).join('\n')
  const append = inst?.append?.trim()
  if (append) text = [text, append].filter(Boolean).join('\n')
  return text
}
