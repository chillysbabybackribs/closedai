import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { CODEX_BINARY_ENV } from '../provider-binary.js'
import { resolveExternalBinary } from '../provider-availability.js'
import type { ExpandedSimulation } from './expand-variations.js'
import { replaySimulation } from './replay.js'
import type { SimulationReport, SimulationRunResult } from './types.js'
import { mapParallel } from './parallel.js'

export type ModelAdapterKind = 'golden' | 'codex'

function codexInstalled(): boolean {
  return resolveExternalBinary(
    { provider: 'codex', name: 'codex', envVar: CODEX_BINARY_ENV, installerPath: false },
    { env: process.env, home: homedir(), exists: existsSync, platform: process.platform }
  ) !== null
}

export function resolveModelAdapter(requested: ModelAdapterKind): ModelAdapterKind {
  if (requested === 'codex' && !codexInstalled()) return 'golden'
  return requested
}

/**
 * Phase 2 model turn. `golden` replays the catalog trace through stub hosts (proves oracles
 * on the model path). `codex` will drive a real app-server turn once wired; until then it
 * falls back to golden when Codex is unavailable.
 */
export async function runModelSimulation(
  sim: ExpandedSimulation,
  adapter: ModelAdapterKind
): Promise<SimulationRunResult> {
  const kind = resolveModelAdapter(adapter)
  if (kind === 'codex') {
    return {
      taskId: sim.taskId,
      variationKey: sim.variationKey,
      passed: false,
      failures: ['Codex model adapter is not implemented yet; use golden adapter or replay-only'],
      calls: [],
      durationMs: 0,
      skipped: true,
      skipReason: 'codex-adapter-pending'
    }
  }
  if (!sim.user && kind === 'golden') {
    return replaySimulation(sim)
  }
  return replaySimulation(sim)
}

export async function runModelCatalog(options: {
  simulations: ExpandedSimulation[]
  concurrency: number
  adapter: ModelAdapterKind
  runId?: string
}): Promise<SimulationReport> {
  const startedAt = new Date().toISOString()
  const adapter = resolveModelAdapter(options.adapter)
  const results = await mapParallel(
    options.simulations,
    options.concurrency,
    (sim) => runModelSimulation(sim, adapter)
  )
  const passed = results.filter((r) => r.passed).length
  const skipped = results.filter((r) => r.skipped).length
  return {
    runId: options.runId ?? `model-${Date.now()}`,
    mode: adapter === 'codex' ? 'model-codex' : 'model-golden',
    startedAt,
    finishedAt: new Date().toISOString(),
    concurrency: options.concurrency,
    totals: {
      runs: results.length,
      passed,
      failed: results.length - passed - skipped
    },
    results,
    summaryByTask: summarizeByTask(results)
  }
}

function summarizeByTask(results: SimulationRunResult[]): SimulationReport['summaryByTask'] {
  const byTask = new Map<string, { passed: number; failed: number }>()
  for (const row of results) {
    if (row.skipped) continue
    const cur = byTask.get(row.taskId) ?? { passed: 0, failed: 0 }
    if (row.passed) cur.passed++
    else cur.failed++
    byTask.set(row.taskId, cur)
  }
  return [...byTask.entries()]
    .map(([taskId, counts]) => {
      const total = counts.passed + counts.failed
      return { taskId, ...counts, passRate: total ? counts.passed / total : 0 }
    })
    .sort((a, b) => b.passRate - a.passRate || a.taskId.localeCompare(b.taskId))
}
