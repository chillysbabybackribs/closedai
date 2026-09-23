import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { harnessTasksDir, loadAllCatalogTasks, listTaskCatalogFiles } from './catalog-index.js'
import { expandCatalog } from './expand-variations.js'
import { runModelCatalog, type ModelAdapterKind } from './model-run.js'
import { runReplayCatalog } from './replay.js'
import type { HarnessSimulationTask, SimulationReport } from './types.js'

export async function loadTaskCatalog(path: string): Promise<HarnessSimulationTask[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error(`Task catalog must be a JSON array: ${path}`)
  return raw as HarnessSimulationTask[]
}

function filterTasks(tasks: HarnessSimulationTask[], taskFilter?: string): HarnessSimulationTask[] {
  if (!taskFilter) return tasks
  return tasks.filter((t) => t.id === taskFilter || t.tool === taskFilter)
}

export async function loadHarnessTasks(projectRoot: string, catalogPath?: string): Promise<HarnessSimulationTask[]> {
  if (catalogPath) return loadTaskCatalog(catalogPath)
  return loadAllCatalogTasks(harnessTasksDir(projectRoot))
}

export async function runTaskCatalogReplay(options: {
  projectRoot: string
  catalogPath?: string
  concurrency?: number
  taskFilter?: string
  runId?: string
}): Promise<SimulationReport> {
  const tasks = filterTasks(await loadHarnessTasks(options.projectRoot, options.catalogPath), options.taskFilter)
  const simulations = expandCatalog(tasks)
  return runReplayCatalog({
    simulations,
    concurrency: options.concurrency ?? 8,
    runId: options.runId
  })
}

export async function runTaskCatalogModel(options: {
  projectRoot: string
  catalogPath?: string
  concurrency?: number
  taskFilter?: string
  adapter: ModelAdapterKind
  runId?: string
}): Promise<SimulationReport> {
  const tasks = filterTasks(await loadHarnessTasks(options.projectRoot, options.catalogPath), options.taskFilter)
  const simulations = expandCatalog(tasks)
  return runModelCatalog({
    simulations,
    concurrency: options.concurrency ?? 8,
    adapter: options.adapter,
    runId: options.runId
  })
}

export async function defaultCatalogPaths(projectRoot: string): Promise<string[]> {
  const dir = harnessTasksDir(projectRoot)
  const files = await listTaskCatalogFiles(dir)
  return files.map((f) => join(dir, f))
}
