#!/usr/bin/env node
// Replay simulation tasks (stub hosts, parallel variations). Model-backed runs come in Phase 2.
// npm run harness:replay
// node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs scripts/harness-sim/run.mjs ...
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const catalog = resolve(project, args.find((a) => a.startsWith('--catalog='))?.slice(10)
  ?? 'harness/tasks/embedded_browser.page.json')
const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.slice(14) ?? 8)
const taskFilter = args.find((a) => a.startsWith('--task='))?.slice(7)
const replayOnly = args.includes('--replay-only') || !args.includes('--model')

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
  throw new Error('concurrency must be an integer 1–128')
}

const { runTaskCatalogReplay } = await import(pathToFileURL(join(project, 'src/main/harness/run-catalog.ts')).href)

const report = await runTaskCatalogReplay({
  catalogPath: catalog,
  concurrency,
  taskFilter
})

const outDir = join(project, 'harness/out', report.runId)
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

const { totals } = report
console.log(`Simulation replay (${replayOnly ? 'stub' : 'model'}): ${totals.passed}/${totals.runs} passed, concurrency=${concurrency}`)
for (const row of report.summaryByTask) {
  console.log(`  ${row.taskId}: ${row.passed}/${row.passed + row.failed} (${(row.passRate * 100).toFixed(0)}%)`)
}
if (totals.failed) {
  for (const result of report.results.filter((r) => !r.passed)) {
    console.error(`FAIL ${result.taskId} [${result.variationKey}]: ${result.failures.join('; ')}`)
  }
  process.exitCode = 1
}
console.log(`Report: ${join(outDir, 'report.json')}`)
