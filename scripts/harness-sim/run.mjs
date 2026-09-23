#!/usr/bin/env node
// Replay or model simulation tasks (stub hosts, parallel variations).
// npm run harness:replay | harness:model
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))?.slice(10)
const catalog = catalogArg ? resolve(project, catalogArg) : undefined
const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.slice(14) ?? 8)
const taskFilter = args.find((a) => a.startsWith('--task='))?.slice(7)
const modelMode = args.includes('--model')
const adapter = args.find((a) => a.startsWith('--adapter='))?.slice(10) ?? 'golden'

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
  throw new Error('concurrency must be an integer 1–128')
}
if (!['golden', 'codex'].includes(adapter)) throw new Error('--adapter must be golden or codex')

const catalogModule = await import(pathToFileURL(join(project, 'src/main/harness/run-catalog.ts')).href)
const runOptions = { projectRoot: project, catalogPath: catalog, concurrency, taskFilter }

const report = modelMode
  ? await catalogModule.runTaskCatalogModel({ ...runOptions, adapter })
  : await catalogModule.runTaskCatalogReplay(runOptions)

const outDir = join(project, 'harness/out', report.runId)
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

const { totals } = report
const skipped = report.results.filter((r) => r.skipped).length
console.log(`Simulation ${report.mode}: ${totals.passed}/${totals.runs} passed${skipped ? `, ${skipped} skipped` : ''}, concurrency=${concurrency}`)
for (const row of report.summaryByTask) {
  console.log(`  ${row.taskId}: ${row.passed}/${row.passed + row.failed} (${(row.passRate * 100).toFixed(0)}%)`)
}
const hardFails = report.results.filter((r) => !r.passed && !r.skipped)
if (totals.failed || hardFails.length) {
  for (const result of hardFails) {
    console.error(`FAIL ${result.taskId} [${result.variationKey}]: ${result.failures.join('; ')}`)
  }
  for (const result of report.results.filter((r) => r.skipped)) {
    console.warn(`SKIP ${result.taskId}: ${result.skipReason}`)
  }
  process.exitCode = hardFails.length ? 1 : 0
}
console.log(`Report: ${join(outDir, 'report.json')}`)
