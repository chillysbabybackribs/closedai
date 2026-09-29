import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { coverageJobs, nextJobs, normalizeLedger, recordResult, reopen, summarize, type CoverageLedger } from './ledger.ts'

// npm run ui-coverage -- <next|record|status|reopen>. The ledger lives in the checkout's
// gitignored .closedai directory: it is the coverage agent's working memory, not source.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const USAGE = `Usage: npm run ui-coverage -- <command>
  next [--count 4]                      the next untested jobs, or COMPLETE
  record <job> --status pass|fail|skip --path menu|command|state|ui --calls N [--note "…"] [--fix "…"]
  status                                totals, the backlog of failed or over-budget jobs, stale results
  reopen <job id | family prefix such as control:layout | menu | failed>
Options: --ledger <file> (default .closedai/ui-coverage.json)`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      count: { type: 'string' }, status: { type: 'string' }, path: { type: 'string' }, calls: { type: 'string' },
      note: { type: 'string' }, fix: { type: 'string' }, ledger: { type: 'string' }
    }
  })
  const [command, subject] = positionals
  const file = path.resolve(root, values.ledger ?? '.closedai/ui-coverage.json')
  const jobs = coverageJobs()
  const ledger = await readLedger(file)
  if (command === 'next') {
    const summary = summarize(jobs, ledger)
    if (summary.complete) {
      print({ complete: true, message: `COMPLETE: all ${summary.jobs} jobs have results. Report the backlog from status, then call closedai_app.agent finish.`, byStatus: summary.byStatus, backlog: summary.backlog.length })
      return
    }
    print({ remaining: summary.remaining, of: summary.jobs, jobs: nextJobs(jobs, ledger, Number(values.count ?? 4)) })
  } else if (command === 'record') {
    if (!subject) throw new Error('record needs a job id')
    const recorded = recordResult(jobs, ledger, {
      job: subject, status: values.status ?? '', path: values.path ?? '', calls: Number(values.calls ?? Number.NaN),
      note: values.note, fix: values.fix
    }, new Date())
    await writeLedger(file, recorded.ledger)
    const summary = summarize(jobs, recorded.ledger)
    print({ recorded: subject, overBudget: recorded.overBudget, remaining: summary.remaining, complete: summary.complete })
  } else if (command === 'status') {
    print(summarize(jobs, ledger))
  } else if (command === 'reopen') {
    if (!subject) throw new Error('reopen needs a job id, a family prefix, menu, or failed')
    const reopened = reopen(ledger, subject)
    await writeLedger(file, reopened.ledger)
    print({ reopened: reopened.reopened })
  } else {
    process.stdout.write(`${USAGE}\n`)
    if (command) process.exitCode = 1
  }
}

async function readLedger(file: string): Promise<CoverageLedger> {
  try {
    return normalizeLedger(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return normalizeLedger(null)
    throw new Error(`Could not read ${file}: ${(error as Error).message}`)
  }
}

async function writeLedger(file: string, ledger: CoverageLedger): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(ledger, null, 1)}\n`)
  await rename(temporary, file)
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 1)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`ui-coverage: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
