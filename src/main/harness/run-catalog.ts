import { readFile } from 'node:fs/promises'
import { expandCatalog } from './expand-variations.js'
import { runReplayCatalog } from './replay.js'
import type { HarnessSimulationTask, SimulationReport } from './types.js'

export async function loadTaskCatalog(path: string): Promise<HarnessSimulationTask[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error(`Task catalog must be a JSON array: ${path}`)
  return raw as HarnessSimulationTask[]
}

export async function runTaskCatalogReplay(options: {
  catalogPath: string
  concurrency?: number
  taskFilter?: string
  runId?: string
}): Promise<SimulationReport> {
  const tasks = await loadTaskCatalog(options.catalogPath)
  const filtered = options.taskFilter
    ? tasks.filter((t) => t.id === options.taskFilter || t.tool === options.taskFilter)
    : tasks
  const simulations = expandCatalog(filtered)
  return runReplayCatalog({
    simulations,
    concurrency: options.concurrency ?? 8,
    runId: options.runId
  })
}
