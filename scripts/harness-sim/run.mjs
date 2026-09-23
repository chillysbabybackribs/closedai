#!/usr/bin/env node
// Replay, model, or variant-comparison simulation runs.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))?.slice(10)
const catalog = catalogArg ? resolve(project, catalogArg) : undefined
let concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.slice(14) ?? 8)
const taskFilter = args.find((a) => a.startsWith('--task='))?.slice(7)
const modelMode = args.includes('--model') || args.includes('--compare')
const adapter = args.find((a) => a.startsWith('--adapter='))?.slice(10) ?? (modelMode ? 'golden' : 'golden')
const variantIds = args.filter((a) => a.startsWith('--variant=')).map((a) => a.slice(10))
const variantId = variantIds.at(-1)
const compare = args.includes('--compare') || variantIds.length > 1
const model = args.find((a) => a.startsWith('--model='))?.slice(8)
  ?? process.env.CLOSEDAI_HARNESS_MODEL
  ?? process.env.CLOSEDAI_HARNESS_CODEX_MODEL
const effort = args.find((a) => a.startsWith('--effort='))?.slice(9) ?? process.env.CLOSEDAI_HARNESS_EFFORT

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
  throw new Error('concurrency must be an integer 1–128')
}
if (!['golden', 'codex'].includes(adapter)) throw new Error('--adapter must be golden or codex')
if (adapter === 'codex' && concurrency > 4) concurrency = Math.min(concurrency, 2)

const catalogModule = await import(pathToFileURL(join(project, 'src/main/harness/run-catalog.ts')).href)
const runOptions = {
  projectRoot: project,
  catalogPath: catalog,
  concurrency,
  taskFilter,
  adapter,
  model: model ?? null,
  effort: effort ?? null
}

let reports
if (compare) {
  const ids = variantIds.length ? variantIds : ['main', 'page-preamble-v1']
  const { variants } = await catalogModule.runVariantComparison({ ...runOptions, variantIds: ids })
  reports = variants
} else if (modelMode) {
  reports = [await catalogModule.runTaskCatalogModel({ ...runOptions, variantId: variantId === 'main' ? undefined : variantId })]
} else {
  reports = [await catalogModule.runTaskCatalogReplay(runOptions)]
}

for (const report of reports) {
  const outDir = join(project, 'harness/out', report.runId)
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  const { totals } = report
  const skipped = report.results.filter((r) => r.skipped).length
  console.log(`Simulation ${report.mode}${report.runId.includes('-') ? '' : ''}: ${totals.passed}/${totals.runs} passed${skipped ? `, ${skipped} skipped` : ''}, concurrency=${concurrency}`)
  for (const row of report.summaryByTask) {
    console.log(`  ${row.taskId}: ${row.passed}/${row.passed + row.failed} (${(row.passRate * 100).toFixed(0)}%)`)
  }
  const hardFails = report.results.filter((r) => !r.passed && !r.skipped)
  if (hardFails.length) {
    for (const result of hardFails) {
      console.error(`FAIL ${result.taskId} [${result.variationKey}]: ${result.failures.join('; ')}`)
    }
    process.exitCode = 1
  }
  for (const result of report.results.filter((r) => r.skipped)) {
    console.warn(`SKIP ${result.taskId} [${result.variationKey}]: ${result.skipReason}`)
  }
  console.log(`Report: ${join(outDir, 'report.json')}`)
}

if (compare && reports.length > 1) {
  console.log('\nVariant pass rates:')
  for (const report of reports) {
    const rate = report.totals.runs ? report.totals.passed / report.totals.runs : 0
    console.log(`  ${report.runId}: ${(rate * 100).toFixed(0)}% (${report.totals.passed}/${report.totals.runs})`)
  }
}
