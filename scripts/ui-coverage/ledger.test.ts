import assert from 'node:assert/strict'
import test from 'node:test'
import { MODEL_MENU_KEYS } from '../../src/shared/app-menu-run.ts'
import { UI_CONTROLS } from '../../src/shared/ui-controls.ts'
import { coverageJobs, nextJobs, normalizeLedger, recordResult, reopen, summarize } from './ledger.ts'

const now = new Date('2026-09-29T12:00:00Z')

test('jobs come from the live menu keys and control manifest, menu rows first', () => {
  const jobs = coverageJobs()
  assert.equal(jobs.length, MODEL_MENU_KEYS.length + Object.keys(UI_CONTROLS).length)
  assert.equal(jobs[0]!.id, `menu:${MODEL_MENU_KEYS[0]}`)
  assert.ok(!jobs.some((job) => job.id === 'menu:reload-renderer'), 'rows a model may not run are not jobs')
  assert.equal(new Set(jobs.map((job) => job.id)).size, jobs.length)
  const del = jobs.find((job) => job.id === 'control:titlebar.chat-search-delete')!
  assert.equal(del.caution, true)
  assert.equal(del.family, 'titlebar')
  assert.equal(jobs.find((job) => job.id === 'control:layout.tab')!.caution, undefined)
})

test('record validates the result, flags over-budget paths, and next moves past it', () => {
  const jobs = coverageJobs(['tools', 'overview'], { 'layout.tab': 'Select a tab', 'window.close': 'Close the window' })
  let ledger = normalizeLedger(null)
  assert.deepEqual(nextJobs(jobs, ledger, 2).map((job) => job.id), ['menu:tools', 'menu:overview'])
  const cheap = recordResult(jobs, ledger, { job: 'menu:tools', status: 'pass', path: 'menu', calls: 1 }, now)
  assert.equal(cheap.overBudget, false)
  ledger = cheap.ledger
  const clicked = recordResult(jobs, ledger, { job: 'menu:overview', status: 'pass', path: 'ui', calls: 1 }, now)
  assert.equal(clicked.overBudget, true, 'a menu row that needed a click is a finding')
  ledger = clicked.ledger
  assert.deepEqual(nextJobs(jobs, ledger, 4).map((job) => job.id), ['control:layout.tab', 'control:window.close'])
  assert.throws(() => recordResult(jobs, ledger, { job: 'control:nope', status: 'pass', path: 'ui', calls: 1 }, now), /Unknown job/)
  assert.throws(() => recordResult(jobs, ledger, { job: 'control:window.close', status: 'skip', path: 'ui', calls: 0 }, now), /--note/)
  assert.throws(() => recordResult(jobs, ledger, { job: 'control:layout.tab', status: 'pass', path: 'ui', calls: Number.NaN }, now), /calls/)
  ledger = recordResult(jobs, ledger, { job: 'control:layout.tab', status: 'fail', path: 'ui', calls: 5, note: 'tab did not select' }, now).ledger
  ledger = recordResult(jobs, ledger, { job: 'control:window.close', status: 'skip', path: 'ui', calls: 0, note: 'closes the app' }, now).ledger
  const summary = summarize(jobs, ledger)
  assert.equal(summary.complete, true)
  assert.deepEqual(summary.byStatus, { pass: 2, fail: 1, skip: 1 })
  assert.deepEqual(summary.backlog.map((entry) => entry.id), ['menu:overview', 'control:layout.tab'])
})

test('results for jobs that no longer exist are stale, and reopen brings jobs back', () => {
  const jobs = coverageJobs(['tools'], { 'layout.tab': 'Select a tab', 'layout.divider': 'Resize' })
  const stored = normalizeLedger({ version: 1, results: {
    'menu:tools': { status: 'pass', path: 'menu', calls: 1, at: now.toISOString() },
    'control:layout.tab': { status: 'fail', path: 'ui', calls: 4, at: now.toISOString(), note: 'x' },
    'control:layout.gone': { status: 'pass', path: 'ui', calls: 1, at: now.toISOString() },
    'control:layout.bad': { status: 'maybe', path: 'ui', calls: 1, at: now.toISOString() }
  } })
  assert.deepEqual(Object.keys(stored.results), ['menu:tools', 'control:layout.tab', 'control:layout.gone'])
  assert.deepEqual(summarize(jobs, stored).stale, ['control:layout.gone'])
  assert.deepEqual(reopen(stored, 'failed').reopened, ['control:layout.tab'])
  assert.deepEqual(reopen(stored, 'control:layout').reopened, ['control:layout.tab', 'control:layout.gone'])
  assert.deepEqual(reopen(stored, 'menu').reopened, ['menu:tools'])
})
