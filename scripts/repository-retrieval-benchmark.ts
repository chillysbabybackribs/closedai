import { resolve } from 'node:path'
import { runBenchmark } from '../src/main/harness/repository-benchmark/run.js'
import type { BenchmarkProvider } from '../src/main/harness/repository-benchmark/providers.js'

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const providers = (arg('providers') ?? 'codex,claude,antigravity').split(',')
if (!providers.every(value => ['codex', 'claude', 'antigravity'].includes(value))) throw new Error('Unknown provider')
const repetitions = Number(arg('repetitions') ?? 1)
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('repetitions must be 1–20')
await runBenchmark({ output: resolve(arg('output') ?? 'output/retrieval-benchmark.json'), repetitions,
  providers: providers as BenchmarkProvider[],
  models: Object.fromEntries(providers.flatMap(provider => arg(`${provider}-model`) ? [[provider, arg(`${provider}-model`)]] : [])) })
