import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { ToolRegistry } from '../../tools/registry.js'
import { repositoryTools } from '../../tools/repository/index.js'
import { REPAIR_FIXTURES, correctSnapshot, type RepairFixture } from './fixtures.js'
import { runProvider, type BenchmarkProvider } from './providers.js'

export type Trial = {
  provider: BenchmarkProvider; fixture: string; retrieval: boolean; repetition: number
  requestedModel: string | null; observedModel: string | null
  firstCorrectEditMs: number | null; elapsedMs: number; finalCorrect: boolean
  retrievalCalls: number; retrievalErrors: number; error: string | null
}
async function snapshot(root: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, path))
    else if (entry.isFile()) result[path] = await readFile(join(root, path), 'utf8')
  }
  return result
}

async function trial(provider: BenchmarkProvider, fixture: RepairFixture, retrieval: boolean, repetition: number, model: string | null): Promise<Trial> {
  const root = await mkdtemp(join(tmpdir(), 'closedai-retrieval-eval-'))
  const cwd = join(root, 'workspace')
  for (const [path, text] of Object.entries(fixture.files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true })
    await writeFile(join(cwd, path), text)
  }
  const registry = new ToolRegistry(retrieval ? [repositoryTools({ root: () => cwd })] : [])
  const result: Trial = { provider, fixture: fixture.id, retrieval, repetition, requestedModel: model, observedModel: null,
    firstCorrectEditMs: null, elapsedMs: 0, finalCorrect: false, retrievalCalls: 0, retrievalErrors: 0, error: null }
  registry.observe(event => {
    if (event.phase === 'end') { result.retrievalCalls++; if (event.result.isError) result.retrievalErrors++ }
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180_000)
  let started: number | null = null
  let stopped = false
  let pending: Promise<void> = Promise.resolve()
  const sample = async () => {
    if (stopped || started === null) return
    const observedAt = performance.now()
    try {
      const files = await snapshot(cwd)
      const correct = correctSnapshot(fixture, files)
      result.finalCorrect = correct
      if (correct && result.firstCorrectEditMs === null) result.firstCorrectEditMs = Math.round(observedAt - started)
    } catch { /* Atomic replacement may briefly remove a file. Next sample retries. */ }
  }
  let sampling = false
  const interval = setInterval(() => {
    if (sampling) return
    sampling = true
    pending = sample().finally(() => { sampling = false })
  }, 100)
  const wall = performance.now()
  try {
    await runProvider({ provider, cwd, stateDir: join(root, 'state'), registry, model, signal: controller.signal,
      prompt: `${fixture.prompt}\nChange existing implementation files only; do not add files.`,
      submitted: () => { started = performance.now() }, modelObserved: value => { result.observedModel = value } })
  } catch (error) { result.error = String(error) }
  finally {
    clearTimeout(timeout); clearInterval(interval)
    await pending; await sample(); stopped = true
    result.elapsedMs = Math.round(performance.now() - (started ?? wall))
    await rm(root, { recursive: true, force: true })
  }
  return result
}

export function summarize(trials: Trial[]) {
  return [...new Set(trials.map(row => row.provider))].map(provider => {
    const rows = trials.filter(row => row.provider === provider)
    const pairs = rows.filter(row => !row.retrieval).map(off => {
      const on = rows.find(row => row.retrieval && row.fixture === off.fixture && row.repetition === off.repetition)
      const comparable = !!on && !on.error && !off.error && on.finalCorrect && off.finalCorrect &&
        on.observedModel !== null && on.observedModel === off.observedModel &&
        on.firstCorrectEditMs !== null && off.firstCorrectEditMs !== null
      return { fixture: off.fixture, repetition: off.repetition, comparable,
        deltaMs: comparable ? on!.firstCorrectEditMs! - off.firstCorrectEditMs! : null,
        retrievalUsed: (on?.retrievalCalls ?? 0) > 0 }
    })
    return { provider, trials: rows.length, finalCorrect: rows.filter(row => row.finalCorrect).length,
      errors: rows.filter(row => row.error).length, pairs }
  })
}

export async function runBenchmark(options: { output: string; repetitions: number; providers: BenchmarkProvider[]; models?: Partial<Record<BenchmarkProvider, string>> }) {
  const report = {
    kind: 'live-provider-retrieval-pilot', startedAt: new Date().toISOString(),
    methodology: 'Fresh temporary CommonJS repair fixtures; native editing/shell unchanged; only shared repository tool availability varies. Sequential trials, arm order alternates by fixture/repetition. 100ms snapshots graded against a hidden behavior oracle and unchanged non-target files. Null firstCorrectEditMs means no observed correct snapshot, never zero. No guide/ledger or task slicing in either arm. Provider account defaults unless model pinned. This is a small adapter microbenchmark, not a full Electron or production-codebase evaluation.',
    trials: [] as Trial[], summary: [] as ReturnType<typeof summarize>
  }
  await mkdir(dirname(options.output), { recursive: true })
  for (const provider of options.providers) {
    for (let repetition = 0; repetition < options.repetitions; repetition++) {
      for (const [index, fixture] of REPAIR_FIXTURES.entries()) {
        const arms = (index + repetition) % 2 === 0 ? [false, true] : [true, false]
        for (const retrieval of arms) {
          console.log(`Starting ${provider} ${fixture.id} retrieval=${retrieval} repetition=${repetition}`)
          const result = await trial(provider, fixture, retrieval, repetition, options.models?.[provider] ?? null)
          report.trials.push(result)
          report.summary = summarize(report.trials)
          await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`)
          console.log(JSON.stringify(result))
        }
      }
    }
  }
  return report
}
