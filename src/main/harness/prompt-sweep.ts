import type { ModelAdapterKind } from './model-run.js'
import { runModelCatalog } from './model-run.js'
import { expandCatalog } from './expand-variations.js'
import { filterHarnessTasks, loadHarnessTasks } from './run-catalog.js'
import { generatePromptMutations } from './prompt-mutations.js'
import type { SimulationReport } from './types.js'

export type PromptSweepVariantResult = {
  variantId: string
  passRate: number
  passed: number
  failed: number
  skipped: number
  meanDurationMs: number
  report: SimulationReport
}

export type PromptSweepSummary = {
  runId: string
  adapter: ModelAdapterKind
  variantCount: number
  taskFilter?: string
  startedAt: string
  finishedAt: string
  ranked: PromptSweepVariantResult[]
}

export async function runPromptSweep(options: {
  projectRoot: string
  count?: number
  adapter: ModelAdapterKind
  concurrency?: number
  catalogPath?: string
  taskFilter?: string
  model?: string | null
  effort?: string | null
}): Promise<PromptSweepSummary> {
  const startedAt = new Date().toISOString()
  const count = options.count ?? 100
  const variants = generatePromptMutations(count)
  const tasks = filterHarnessTasks(
    await loadHarnessTasks(options.projectRoot, options.catalogPath),
    options.taskFilter
  )
  const simulations = expandCatalog(tasks).filter((sim) => sim.user?.trim())
  if (!simulations.length) {
    throw new Error('Prompt sweep requires catalog tasks with a user message for model runs')
  }
  const ranked: PromptSweepVariantResult[] = []
  for (const variant of variants) {
    const report = await runModelCatalog({
      simulations,
      concurrency: options.concurrency ?? 2,
      adapter: options.adapter,
      projectRoot: options.projectRoot,
      variant,
      model: options.model,
      effort: options.effort,
      runId: `sweep-${variant.id}-${Date.now()}`
    })
    const scored = report.results.filter((r) => !r.skipped)
    const passed = scored.filter((r) => r.passed).length
    const failed = scored.length - passed
    const skipped = report.results.length - scored.length
    const meanDurationMs = scored.length
      ? Math.round(scored.reduce((sum, r) => sum + r.durationMs, 0) / scored.length)
      : 0
    ranked.push({
      variantId: variant.id,
      passRate: scored.length ? passed / scored.length : 0,
      passed,
      failed,
      skipped,
      meanDurationMs,
      report
    })
  }
  ranked.sort((a, b) => (
    b.passRate - a.passRate
    || a.meanDurationMs - b.meanDurationMs
    || a.variantId.localeCompare(b.variantId)
  ))
  return {
    runId: `prompt-sweep-${Date.now()}`,
    adapter: options.adapter,
    variantCount: variants.length,
    taskFilter: options.taskFilter,
    startedAt,
    finishedAt: new Date().toISOString(),
    ranked
  }
}
