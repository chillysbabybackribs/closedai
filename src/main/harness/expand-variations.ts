import type { HarnessSimulationTask } from './types.js'

function cartesian(keys: string[], values: unknown[][]): Record<string, unknown>[] {
  if (keys.length === 0) return [{}]
  const [head, ...restKeys] = keys
  const [headValues, ...restValues] = values
  const rest = cartesian(restKeys, restValues)
  const out: Record<string, unknown>[] = []
  for (const value of headValues!) {
    for (const combo of rest) {
      out.push({ [head!]: value, ...combo })
    }
  }
  return out
}

function variationKey(overrides: Record<string, unknown>): string {
  const parts = Object.keys(overrides).sort().map((k) => `${k}=${JSON.stringify(overrides[k])}`)
  return parts.length ? parts.join('&') : 'base'
}

function mergeArgs(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...overrides }
}

export type ExpandedSimulation = {
  taskId: string
  variationKey: string
  replay: HarnessSimulationTask['replay']
  oracle: HarnessSimulationTask['oracle']
  fixture?: string
  user?: string
}

/** Expand a task's `variations` map into independent simulation runs. */
export function expandTaskVariations(task: HarnessSimulationTask): ExpandedSimulation[] {
  const variations = task.variations
  if (!variations || !Object.keys(variations).length) {
    return [{
      taskId: task.id,
      variationKey: 'base',
      replay: task.replay,
      oracle: task.oracle,
      fixture: task.fixture,
      user: task.user
    }]
  }
  const keys = Object.keys(variations)
  const combos = cartesian(keys, keys.map((k) => variations[k]!))
  return combos.map((overrides) => ({
    taskId: task.id,
    variationKey: variationKey(overrides),
    replay: task.replay.map((step) => ({
      ...step,
      arguments: mergeArgs(step.arguments, overrides)
    })),
    oracle: task.oracle,
    fixture: task.fixture,
    user: task.user
  }))
}

export function expandCatalog(tasks: HarnessSimulationTask[]): ExpandedSimulation[] {
  return tasks.flatMap(expandTaskVariations)
}
