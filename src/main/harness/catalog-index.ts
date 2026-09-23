import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HarnessSimulationTask } from './types.js'

const TASK_FILE_PATTERN = /^[a-z0-9_.-]+\.json$/
const RESERVED = new Set(['schema.json', 'waived.json'])

function isTaskCatalogFile(name: string): boolean {
  return TASK_FILE_PATTERN.test(name) && !RESERVED.has(name) && !name.endsWith('.draft.json')
}

export function harnessTasksDir(root: string): string {
  return join(root, 'harness/tasks')
}

export async function readWaivedTools(tasksDir: string): Promise<Map<string, string>> {
  const path = join(tasksDir, 'waived.json')
  const raw = JSON.parse(await readFile(path, 'utf8')) as { tools?: Record<string, string> }
  return new Map(Object.entries(raw.tools ?? {}))
}

export async function listTaskCatalogFiles(tasksDir: string): Promise<string[]> {
  const names = await readdir(tasksDir)
  return names.filter(isTaskCatalogFile)
}

export async function loadAllCatalogTasks(tasksDir: string): Promise<HarnessSimulationTask[]> {
  const files = await listTaskCatalogFiles(tasksDir)
  const tasks: HarnessSimulationTask[] = []
  for (const file of files) {
    const chunk = JSON.parse(await readFile(join(tasksDir, file), 'utf8')) as unknown
    if (!Array.isArray(chunk)) throw new Error(`Task catalog must be a JSON array: ${file}`)
    tasks.push(...(chunk as HarnessSimulationTask[]))
  }
  return tasks
}

/** Tool ids (`namespace.tool`) that have at least one task entry in the task catalog. */
export async function coveredToolIds(tasksDir: string): Promise<Set<string>> {
  const tasks = await loadAllCatalogTasks(tasksDir)
  return new Set(tasks.map((task) => task.tool))
}
