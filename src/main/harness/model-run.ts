import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CODEX_BINARY_ENV } from '../provider-binary.js'
import { resolveExternalBinary } from '../provider-availability.js'
import type { ExpandedSimulation } from './expand-variations.js'
import { runCodexHarnessTurn } from './codex-turn.js'
import { fixtureRegistry } from './fixture-registry.js'
import { replaySimulation } from './replay.js'
import { scoreOracle } from './oracle.js'
import type { SimulationReport, SimulationRunResult } from './types.js'
import { mapParallel } from './parallel.js'
import { applyVariantToRegistry, loadHarnessVariant, type HarnessVariant } from './variants.js'

export type ModelAdapterKind = 'golden' | 'codex'

export type ModelRunOptions = {
  projectRoot: string
  variantId?: string
  model?: string | null
  effort?: string | null
}

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

function envModel(): string | null {
  return process.env.CLOSEDAI_HARNESS_MODEL?.trim()
    || process.env.CLOSEDAI_HARNESS_CODEX_MODEL?.trim()
    || null
}

function envEffort(): string | null {
  return process.env.CLOSEDAI_HARNESS_EFFORT?.trim() || null
}

async function loadVariant(projectRoot: string, variantId?: string): Promise<HarnessVariant | undefined> {
  if (!variantId) return undefined
  return loadHarnessVariant(join(projectRoot, 'harness/variants'), variantId)
}

export async function runModelSimulation(
  sim: ExpandedSimulation,
  adapter: ModelAdapterKind,
  options: ModelRunOptions
): Promise<SimulationRunResult> {
  const started = performance.now()
  const kind = resolveModelAdapter(adapter)
  if (kind === 'golden') {
    return replaySimulation(sim)
  }
  if (!sim.user?.trim()) {
    return {
      taskId: sim.taskId,
      variationKey: sim.variationKey,
      passed: false,
      failures: [],
      calls: [],
      durationMs: 0,
      skipped: true,
      skipReason: 'no-user-message'
    }
  }
  if (process.env.CLOSEDAI_HARNESS_SKIP_CODEX === '1') {
    return {
      taskId: sim.taskId,
      variationKey: sim.variationKey,
      passed: false,
      failures: [],
      calls: [],
      durationMs: 0,
      skipped: true,
      skipReason: 'codex-disabled'
    }
  }
  try {
    const variant = await loadVariant(options.projectRoot, options.variantId)
    const { registry } = fixtureRegistry(sim.fixture)
    applyVariantToRegistry(registry, variant)
    const turn = await runCodexHarnessTurn({
      registry,
      userMessage: sim.user,
      model: options.model ?? envModel(),
      effort: options.effort ?? envEffort(),
      variant,
      projectRoot: options.projectRoot
    })
    const failures = scoreOracle(sim.oracle, turn.calls)
    return {
      taskId: sim.taskId,
      variationKey: sim.variationKey,
      passed: failures.length === 0,
      failures,
      calls: turn.calls,
      durationMs: Math.round(performance.now() - started)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      taskId: sim.taskId,
      variationKey: sim.variationKey,
      passed: false,
      failures: [message],
      calls: [],
      durationMs: Math.round(performance.now() - started)
    }
  }
}

export async function runModelCatalog(options: {
  simulations: ExpandedSimulation[]
  concurrency: number
  adapter: ModelAdapterKind
  runId?: string
  projectRoot: string
  variantId?: string
  model?: string | null
  effort?: string | null
}): Promise<SimulationReport> {
  const startedAt = new Date().toISOString()
  const adapter = resolveModelAdapter(options.adapter)
  const runOpts: ModelRunOptions = {
    projectRoot: options.projectRoot,
    variantId: options.variantId,
    model: options.model,
    effort: options.effort
  }
  const results = await mapParallel(
    options.simulations,
    options.concurrency,
    (sim) => runModelSimulation(sim, adapter, runOpts)
  )
  const passed = results.filter((r) => r.passed).length
  const skipped = results.filter((r) => r.skipped).length
  return {
    runId: options.runId ?? `model-${Date.now()}${options.variantId ? `-${options.variantId}` : ''}`,
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
