import type { ToolRegistry } from '../tools/registry.js'
import { createBrowserFixtureRegistry } from './browser-fixture.js'
import { scoreOracle } from './oracle.js'
import type { ExpandedSimulation } from './expand-variations.js'
import type { RecordedToolCall, SimulationReport, SimulationRunResult } from './types.js'
import { mapParallel } from './parallel.js'

const context = { threadId: null, turnId: null, callId: 'harness' }

function fixtureRegistry(fixture?: string): { registry: ToolRegistry; recorded: () => RecordedToolCall[] } {
  if (!fixture || fixture.startsWith('browser/')) {
    const { registry, drainRecordedCalls } = createBrowserFixtureRegistry()
    return { registry, recorded: drainRecordedCalls }
  }
  throw new Error(`Unknown harness fixture: ${fixture}`)
}

export async function replaySimulation(
  sim: ExpandedSimulation
): Promise<SimulationRunResult> {
  const started = performance.now()
  const { registry, recorded } = fixtureRegistry(sim.fixture)
  const calls: RecordedToolCall[] = []

  for (const step of sim.replay) {
    await registry.call(
      { namespace: step.namespace, tool: step.tool, arguments: step.arguments },
      { ...context, callId: `harness-${calls.length}` }
    )
    calls.push(...recorded())
  }

  const failures = scoreOracle(sim.oracle, calls)
  return {
    taskId: sim.taskId,
    variationKey: sim.variationKey,
    passed: failures.length === 0,
    failures,
    calls,
    durationMs: Math.round(performance.now() - started)
  }
}

function summarizeResults(results: SimulationRunResult[]): SimulationReport['summaryByTask'] {
  const byTask = new Map<string, { passed: number; failed: number }>()
  for (const row of results) {
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

export async function runReplayCatalog(options: {
  simulations: ExpandedSimulation[]
  concurrency: number
  runId?: string
}): Promise<SimulationReport> {
  const startedAt = new Date().toISOString()
  const results = await mapParallel(options.simulations, options.concurrency, replaySimulation)
  const passed = results.filter((r) => r.passed).length
  return {
    runId: options.runId ?? `replay-${Date.now()}`,
    mode: 'replay',
    startedAt,
    finishedAt: new Date().toISOString(),
    concurrency: options.concurrency,
    totals: { runs: results.length, passed, failed: results.length - passed },
    results,
    summaryByTask: summarizeResults(results)
  }
}
