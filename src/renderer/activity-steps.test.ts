import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChatTranscriptItem } from '../shared/chat.ts'
import { activitySteps, activitySummary, diffCounts, formatDuration, summaryLabel } from './activity-steps.ts'
import { ActivitySteps } from './activity-step-list.tsx'
import type { ActivityItem } from './transcript-rows.ts'

type Command = Extract<ChatTranscriptItem, { type: 'command' }>

const command = (id: string, text: string, overrides: Partial<Command> = {}): ActivityItem => ({
  type: 'command', id, turnId: 't', command: text, cwd: '/', status: 'completed', output: '', exitCode: 0, ...overrides
})

test('a command step reads as the literal command after a plain verb', () => {
  const [step] = activitySteps([command('c1', 'bash -lc "sed -n 1,20p src/main/index.ts"')], 0)
  assert.equal(step?.kind, 'command')
  assert.equal(step?.verb, 'Ran')
  assert.equal(step?.label, 'sed -n 1,20p src/main/index.ts')
  assert.equal(step?.title, null)
  assert.equal(step?.phase, 'done')
  assert.deepEqual(step?.body, {
    heading: 'Shell', invocation: 'sed -n 1,20p src/main/index.ts', shell: true, output: null, diffs: [],
    status: { tone: 'ok', label: 'Success' }
  })
})

test('a long command is cut on the line but kept whole for hover', () => {
  const long = `echo ${'x'.repeat(200)}`
  const [step] = activitySteps([command('c1', long, { status: 'inProgress', exitCode: null })], 0)
  assert.equal(step?.verb, 'Running')
  assert.match(step?.label ?? '', /…$/)
  assert.equal(step?.title, long)
})

test('a failed command shows its exit code, its output, and a one-line failure', () => {
  const [step] = activitySteps([command('c1', 'npm test', { status: 'failed', exitCode: 1, output: 'FAIL suite' })], 0)
  assert.equal(step?.phase, 'failed')
  assert.deepEqual(step?.meta, ['exit 1'])
  assert.equal(step?.body?.output, 'FAIL suite')
  assert.deepEqual(step?.body?.status, { tone: 'error', label: 'Exit code 1' })
  assert.equal(step?.failure, 'npm test exited with code 1')
})

test('a file change reports its line delta and exposes the diff', () => {
  const diff = '--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n'
  const item: ActivityItem = {
    type: 'fileChange', id: 'f1', turnId: 't', status: 'completed',
    changes: [{ path: 'src/x.ts', kind: 'update', diff }]
  }
  const [step] = activitySteps([item], 0)
  assert.equal(step?.kind, 'fileChange')
  assert.equal(step?.verb, 'Edited')
  assert.equal(step?.label, 'src/x.ts')
  assert.deepEqual(step?.meta, ['+2 −1'])
  assert.equal(step?.body?.heading, 'Edit')
  assert.equal(step?.body?.invocation, null)
  assert.deepEqual(step?.body?.diffs.map((entry) => entry.path), ['src/x.ts'])
  assert.deepEqual(diffCounts([{ diff }]), { added: 2, removed: 1 })
})

test('an unphrased tool label falls back to a plain verb instead of splitting the label', () => {
  const item: ActivityItem = { type: 'tool', id: 't1', turnId: 't', label: 'closedai_ui · capture', detail: '{"action":"app_window"}', status: 'inProgress' }
  const [step] = activitySteps([item], 0)
  assert.equal(step?.verb, 'Using')
  assert.equal(step?.label, 'closedai_ui · capture')
  assert.equal(step?.phase, 'running')
})

test('the failure line names a step the same way its own row does', () => {
  const item: ActivityItem = { type: 'tool', id: 't1', turnId: 't', label: 'closedai_app · ui', detail: '{}', status: 'failed' }
  const [step] = activitySteps([item], 0)
  assert.equal(`${step?.verb} ${step?.label}`, 'Used closedai_app · ui')
  assert.equal(step?.failure, 'closedai_app · ui failed')
})

test('a phrased tool keeps its phrase instead of its raw arguments', () => {
  const item: ActivityItem = { type: 'tool', id: 't1', turnId: 't', label: 'Web search', detail: '{"q":"x"}', status: 'completed' }
  const [step] = activitySteps([item], 0)
  assert.equal(step?.verb, 'Searched')
  assert.equal(step?.label, 'the web')
  assert.equal(step?.body?.heading, 'Web search')
  assert.equal(step?.body?.invocation, '{"q":"x"}')
  assert.equal(step?.body?.shell, false)
})

test('a failed tool call opens on its error message', () => {
  const item: ActivityItem = {
    type: 'tool', id: 't1', turnId: 't', label: 'closedai_app · ui', detail: '{"action":"click"}',
    status: 'failed', output: 'Control matches 2 elements'
  }
  const [step] = activitySteps([item], 0)
  assert.equal(step?.body?.output, 'Control matches 2 elements')
  assert.deepEqual(step?.body?.status, { tone: 'error', label: 'Failed' })
})

test('durations come from the stamped clock and keep ticking for a running step', () => {
  const settled = command('c1', 'ls', { startedAt: 1_000, finishedAt: 2_400 })
  const live = command('c2', 'ls', { status: 'inProgress', exitCode: null, startedAt: 5_000 })
  const steps = activitySteps([settled, live], 17_000)
  assert.deepEqual(steps.map((step) => step.meta), [['1.4s'], ['12s']])
})

test('the summary counts settled steps while live and reports failures once done', () => {
  const items = [
    command('c1', 'ls', { startedAt: 1_000, finishedAt: 2_000 }),
    command('c2', 'ls', { status: 'failed', exitCode: 2, startedAt: 2_000, finishedAt: 3_000 }),
    command('c3', 'ls', { status: 'inProgress', exitCode: null, startedAt: 3_000 })
  ]
  assert.equal(summaryLabel(activitySummary(items, 13_000)), '2 of 3 · 1 failed · 12s')
  const done = items.map((item) => (item.id === 'c3' ? { ...item, status: 'completed', exitCode: 0, finishedAt: 15_000 } : item))
  assert.equal(summaryLabel(activitySummary(done, 99_000)), '2 done · 1 failed · 14s')
})

test('history items without timing get counts but no duration', () => {
  const summary = activitySummary([command('c1', 'ls'), command('c2', 'ls')], 0)
  assert.equal(summary.elapsedMs, null)
  assert.equal(summaryLabel(summary), '2 done')
})

test('durations read as seconds, then minutes, then hours', () => {
  assert.equal(formatDuration(420), '0.4s')
  assert.equal(formatDuration(9_950), '10s')
  assert.equal(formatDuration(9_940), '9.9s')
  assert.equal(formatDuration(12_400), '12s')
  assert.equal(formatDuration(65_000), '1m 05s')
  assert.equal(formatDuration(3_720_000), '1h 02m')
})

test('the step list renders the alert line, the rows, and opens failed output by default', () => {
  const items = [
    command('c1', 'bash -lc "rg AGENTS.md"', { startedAt: 0, finishedAt: 300 }),
    command('c2', 'npm test', { status: 'failed', exitCode: 1, output: 'Expected 2 to equal 3', startedAt: 300, finishedAt: 1_800 })
  ]
  const html = renderToStaticMarkup(createElement(ActivitySteps, { items }))
  assert.match(html, /role="alert"/)
  assert.match(html, /npm test exited with code 1/)
  assert.match(html, /1 done · 1 failed · 1\.8s/)
  assert.match(html, /aria-label="Ran rg AGENTS.md, completed"/)
  assert.match(html, /aria-label="Ran npm test, failed"/)
  assert.match(html, /Expected 2 to equal 3/)
  assert.match(html, /data-phase="failed"/)
  assert.match(html, /data-expandable="true"/)
  assert.match(html, /activity-card-heading">Shell</)
  assert.match(html, /\$ <\/span>npm test/)
  assert.match(html, /Exit code 1/)
  assert.doesNotMatch(html, /INPUT|"steps"/)
})
