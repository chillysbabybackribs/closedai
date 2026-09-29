import { MODEL_MENU_KEYS } from '../../src/shared/app-menu-run.ts'
import { UI_CONTROLS } from '../../src/shared/ui-controls.ts'

// The UI coverage agent's memory across cycles and context rotations. Jobs are never stored:
// they are derived on every read from the two sources the app itself uses (the model-runnable
// menu keys and the `data-ui` control manifest), so a row or control added, renamed, or deleted
// shows up or drops out without a regeneration step. Only results are stored, keyed by job id;
// a result whose job no longer exists is reported as stale and ignored.

export type CoverageJob = {
  /** `menu:<key>` or `control:<manifest id>`. */
  id: string
  kind: 'menu' | 'control'
  target: string
  /** `menu`, or the control's family (the manifest id before the dot). */
  family: string
  what: string
  /** Tool calls the job should cost by its cheapest path; more is a finding. */
  budget: number
  how: string
  /** The control deletes, clears, resets, or closes something: exercise it only on what this run created. */
  caution?: true
}

export const COVERAGE_STATUSES = ['pass', 'fail', 'skip'] as const
export const COVERAGE_PATHS = ['menu', 'command', 'state', 'ui'] as const

export type CoverageResult = {
  status: (typeof COVERAGE_STATUSES)[number]
  /** The cheapest path that did the job. */
  path: (typeof COVERAGE_PATHS)[number]
  calls: number
  note?: string
  /** What was changed in the app so the next model pays less, when anything was. */
  fix?: string
  at: string
}

export type CoverageLedger = { version: 1; results: Record<string, CoverageResult> }

const MENU_BUDGET = 1
const CONTROL_BUDGET = 3
/** Controls reached through a menu row are exercised by that row's menu job instead. */
const MENU_ROW_CONTROLS = new Set(['titlebar.menu-item', 'layout.dock-preset', 'layout.preset-menu-custom'])
const CAUTION = /\b(delete|remove|clear|reset|close the window|minimi[sz]e the window)\b/i

export function coverageJobs(
  menuKeys: readonly string[] = MODEL_MENU_KEYS,
  controls: Readonly<Record<string, string>> = UI_CONTROLS
): CoverageJob[] {
  const menu = menuKeys.map((key): CoverageJob => ({
    id: `menu:${key}`, kind: 'menu', target: key, family: 'menu',
    what: `Application menu row ${key}`,
    budget: MENU_BUDGET,
    how: `closedai_app.menu {"key":"${key}"}; its result carries the ui state to verify against`
  }))
  const control = Object.entries(controls).map(([id, what]): CoverageJob => ({
    id: `control:${id}`, kind: 'control', target: id, family: id.slice(0, id.indexOf('.')), what,
    budget: CONTROL_BUDGET,
    how: MENU_ROW_CONTROLS.has(id)
      ? 'Covered by the menu:* jobs; confirm closedai_app.ui controls lists it, then record'
      : 'closedai_app.command, closedai_app.menu, or closedai_app.state when one does the job; else one tool_batch of ui controls → act (fallback_reason) → verify',
    ...(CAUTION.test(what) ? { caution: true as const } : {})
  }))
  return [...menu, ...control]
}

export function normalizeLedger(candidate: unknown): CoverageLedger {
  if (!candidate || typeof candidate !== 'object') return { version: 1, results: {} }
  const results = (candidate as { results?: unknown }).results
  if (!results || typeof results !== 'object') return { version: 1, results: {} }
  const clean: Record<string, CoverageResult> = {}
  for (const [id, value] of Object.entries(results as Record<string, unknown>)) {
    const result = value as Partial<CoverageResult> | null
    if (!result || !COVERAGE_STATUSES.includes(result.status!) || !COVERAGE_PATHS.includes(result.path!)) continue
    if (!Number.isInteger(result.calls) || result.calls! < 0 || typeof result.at !== 'string') continue
    clean[id] = {
      status: result.status!, path: result.path!, calls: result.calls!, at: result.at,
      ...(typeof result.note === 'string' && result.note ? { note: result.note } : {}),
      ...(typeof result.fix === 'string' && result.fix ? { fix: result.fix } : {})
    }
  }
  return { version: 1, results: clean }
}

/** Untested jobs in order, menu rows first; a failure comes back once `reopen` forgets it after a fix. */
export function nextJobs(jobs: CoverageJob[], ledger: CoverageLedger, count: number): CoverageJob[] {
  return jobs.filter((job) => !ledger.results[job.id]).slice(0, Math.max(1, count))
}

export type RecordInput = {
  job: string
  status: string
  path: string
  calls: number
  note?: string
  fix?: string
}

export function recordResult(jobs: CoverageJob[], ledger: CoverageLedger, input: RecordInput, now: Date): {
  ledger: CoverageLedger
  overBudget: boolean
} {
  const job = jobs.find((candidate) => candidate.id === input.job)
  if (!job) throw new Error(`Unknown job ${input.job}; take ids from the next command`)
  if (!COVERAGE_STATUSES.includes(input.status as CoverageResult['status'])) {
    throw new Error(`status must be one of ${COVERAGE_STATUSES.join(', ')}`)
  }
  if (!COVERAGE_PATHS.includes(input.path as CoverageResult['path'])) throw new Error(`path must be one of ${COVERAGE_PATHS.join(', ')}`)
  if (!Number.isInteger(input.calls) || input.calls < 0) throw new Error('calls must be a whole number of tool calls')
  if (input.status !== 'pass' && !input.note?.trim()) throw new Error(`A ${input.status} result needs --note saying why`)
  const result: CoverageResult = {
    status: input.status as CoverageResult['status'],
    path: input.path as CoverageResult['path'],
    calls: input.calls,
    at: now.toISOString(),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.fix?.trim() ? { fix: input.fix.trim() } : {})
  }
  return { ledger: { version: 1, results: { ...ledger.results, [job.id]: result } }, overBudget: isCostly(job, result) }
}

/** A result that cost more than its job's budget, or a menu row that needed anything but the menu tool. */
export function isCostly(job: CoverageJob, result: CoverageResult): boolean {
  return result.status !== 'skip' && (result.calls > job.budget || (job.kind === 'menu' && result.path !== 'menu'))
}

export type CoverageSummary = {
  jobs: number
  done: number
  remaining: number
  complete: boolean
  byStatus: Record<CoverageResult['status'], number>
  /** Failures and over-budget passes: the backlog of fixes that make the app cheaper for models. */
  backlog: Array<{ id: string; status: CoverageResult['status']; path: CoverageResult['path']; calls: number; budget: number; note?: string }>
  stale: string[]
}

export function summarize(jobs: CoverageJob[], ledger: CoverageLedger): CoverageSummary {
  const byStatus = { pass: 0, fail: 0, skip: 0 }
  const backlog: CoverageSummary['backlog'] = []
  let done = 0
  for (const job of jobs) {
    const result = ledger.results[job.id]
    if (!result) continue
    done += 1
    byStatus[result.status] += 1
    if (result.status === 'fail' || isCostly(job, result)) {
      backlog.push({ id: job.id, status: result.status, path: result.path, calls: result.calls, budget: job.budget,
        ...(result.note ? { note: result.note } : {}) })
    }
  }
  const known = new Set(jobs.map((job) => job.id))
  const stale = Object.keys(ledger.results).filter((id) => !known.has(id))
  return { jobs: jobs.length, done, remaining: jobs.length - done, complete: done === jobs.length, byStatus, backlog, stale }
}

/** Forget results so their jobs come back: one job, a whole family (`control:layout`), or every failure. */
export function reopen(ledger: CoverageLedger, selector: string): { ledger: CoverageLedger; reopened: string[] } {
  const matches = (id: string, result: CoverageResult): boolean => {
    if (selector === 'failed') return result.status === 'fail'
    if (selector === 'menu') return id.startsWith('menu:')
    return id === selector || id.startsWith(`${selector}.`)
  }
  const results: Record<string, CoverageResult> = {}
  const reopened: string[] = []
  for (const [id, result] of Object.entries(ledger.results)) {
    if (matches(id, result)) reopened.push(id)
    else results[id] = result
  }
  return { ledger: { version: 1, results }, reopened }
}
