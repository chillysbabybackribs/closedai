#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const count = Number(args.find((a) => a.startsWith('--count='))?.slice(8) ?? 100)
const taskFilter = args.find((a) => a.startsWith('--task='))?.slice(7)
const adapter = args.find((a) => a.startsWith('--adapter='))?.slice(10) ?? 'codex'
let concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.slice(14) ?? 2)
const model = args.find((a) => a.startsWith('--model='))?.slice(8) ?? process.env.CLOSEDAI_HARNESS_MODEL ?? null
const effort = args.find((a) => a.startsWith('--effort='))?.slice(9) ?? process.env.CLOSEDAI_HARNESS_EFFORT ?? null

if (!Number.isInteger(count) || count < 1 || count > 512) throw new Error('--count must be 1–512')
if (!['golden', 'codex'].includes(adapter)) throw new Error('--adapter must be golden or codex')
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error('concurrency must be an integer 1–8 for prompt sweep')
}
if (adapter === 'codex' && concurrency > 4) concurrency = 4

const mod = await import(pathToFileURL(join(project, 'src/main/harness/prompt-sweep.ts')).href)
const summary = await mod.runPromptSweep({
  projectRoot: project,
  count,
  adapter,
  concurrency,
  taskFilter,
  model,
  effort
})

const outDir = join(project, 'harness/out', summary.runId)
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)

const top = summary.ranked.slice(0, 10)
console.log(`Prompt sweep ${summary.runId}: ${summary.variantCount} variants, adapter=${adapter}`)
console.log('Top variants (pass rate, mean ms):')
for (const row of top) {
  console.log(`  ${row.variantId}: ${(row.passRate * 100).toFixed(0)}% (${row.passed}/${row.passed + row.failed}), ${row.meanDurationMs}ms`)
}
const baseline = summary.ranked.find((r) => r.variantId === 'sweep-000')
const best = summary.ranked[0]
if (baseline && best && best.variantId !== baseline.variantId) {
  console.log(`\nBest ${best.variantId} vs baseline sweep-000: pass ${(best.passRate * 100).toFixed(0)}% vs ${(baseline.passRate * 100).toFixed(0)}%, ${best.meanDurationMs}ms vs ${baseline.meanDurationMs}ms`)
} else if (best) {
  console.log(`\nBaseline (sweep-000) ties or leads: ${(best.passRate * 100).toFixed(0)}%, ${best.meanDurationMs}ms mean`)
}
console.log(`Report: ${join(outDir, 'summary.json')}`)

if (best && best.passRate < 1 && summary.ranked.every((r) => r.passRate < 1)) {
  process.exitCode = 1
}
