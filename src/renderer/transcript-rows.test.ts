import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../shared/chat.ts'
import {
  activityClusters,
  activityHeadline,
  commandTitle,
  transcriptRows,
  visibleTranscriptRows
} from './transcript-rows.ts'

const command = (
  id: string,
  turnId: string | null,
  commandText: string,
  status = 'completed'
): ChatTranscriptItem => ({
  type: 'command', id, turnId, command: commandText, cwd: '/', status, output: '', exitCode: status === 'completed' ? 0 : null
})

test('consecutive tool activity in one turn becomes one counted row', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Make the change' },
    command('c1', 't1', 'npm install'),
    command('c2', 't1', 'npm test', 'inProgress')
  ]
  const rows = transcriptRows(items)
  assert.deepEqual(rows.map((row) => row.kind), ['item', 'activity'])
  const activity = rows[1]
  assert.equal(activity?.kind, 'activity')
  if (activity?.kind === 'activity') assert.deepEqual(activity.items.map((item) => item.id), ['c1', 'c2'])
})

test('commentary splits tool batches so later calls stay in narrative order', () => {
  const items: ChatTranscriptItem[] = [
    command('c1', 't1', 'npm install'),
    {
      type: 'assistant', id: 'a1', turnId: 't1', text: 'Checking compatibility.',
      phase: 'commentary', streaming: false
    },
    { type: 'fileChange', id: 'f1', turnId: 't1', status: 'completed', changes: [] },
    command('c2', 't1', 'npm test', 'inProgress')
  ]
  const rows = transcriptRows(items)
  assert.deepEqual(rows.map((row) => row.kind), ['activity', 'item', 'activity'])
  assert.equal(rows[0]?.kind === 'activity' && rows[0].items[0]?.id, 'c1')
  assert.equal(rows[2]?.kind === 'activity' && rows[2].items.map((item) => item.id).join(','), 'f1,c2')
})

test('tool activity never consolidates across turns or unowned items', () => {
  const rows = transcriptRows([
    command('a', 'turn-a', 'a'),
    command('b', 'turn-b', 'b'),
    command('loose-1', null, 'loose-1'),
    command('loose-2', null, 'loose-2')
  ])
  assert.deepEqual(rows.map((row) => row.kind === 'activity' ? row.items.map((item) => item.id) : []), [
    ['a'], ['b'], ['loose-1'], ['loose-2']
  ])
})

test('consecutive reasoning stays one row; later thoughts after an answer start another', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'reasoning', id: 'r1', turnId: 'turn-a', text: 'First thought', streaming: true },
    {
      type: 'assistant', id: 'a1', turnId: 'turn-a', text: 'Progress update',
      phase: 'commentary', streaming: false
    },
    { type: 'reasoning', id: 'r2', turnId: 'turn-a', text: 'Second thought', streaming: false },
    { type: 'plan', id: 'p1', turnId: 'turn-a', text: 'Implementation plan', streaming: false }
  ]
  const rows = transcriptRows(items)
  assert.deepEqual(rows.map((row) => row.kind), ['reasoning', 'item', 'reasoning'])
  assert.equal(rows[0]?.kind === 'reasoning' && rows[0].items[0]?.id, 'r1')
  assert.deepEqual(rows[2]?.kind === 'reasoning' && rows[2].items.map((item) => item.id), ['r2', 'p1'])
})

test('an active turn with only the user prompt shows a pending thinking row', () => {
  const items: ChatTranscriptItem[] = [{ type: 'user', id: 'u1', turnId: 't1', text: 'Hello' }]
  const rows = visibleTranscriptRows(items, 't1')
  assert.deepEqual(rows.map((row) => row.kind), ['item', 'reasoning'])
  assert.equal(rows[1]?.kind === 'reasoning' && rows[1].items.length, 0)
  assert.equal(visibleTranscriptRows(items, null).length, 1)
})

test('pending thinking stays until the turn has visible output', () => {
  const emptyAnswer: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: '', phase: null, streaming: true }
  ]
  assert.equal(visibleTranscriptRows(emptyAnswer, 't1').some((row) => row.kind === 'reasoning' && row.items.length === 0), true)
  const withThought: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    { type: 'reasoning', id: 'r1', turnId: 't1', text: 'Plan', streaming: true }
  ]
  assert.equal(visibleTranscriptRows(withThought, 't1').filter((row) => row.kind === 'reasoning').length, 1)
  const withTool: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    command('c1', 't1', 'ls')
  ]
  assert.equal(visibleTranscriptRows(withTool, 't1').some((row) => row.kind === 'reasoning'), false)
})

test('command titles unwrap bash -lc and truncate the working command', () => {
  assert.equal(commandTitle('npm test'), 'npm test')
  assert.equal(
    commandTitle(`/bin/bash -lc "pwd && rg --files -g 'AGENTS.md' -g '!node_modules'"`),
    "pwd && rg --files -g 'AGENTS.md' -g '!node_modules'"
  )
  assert.equal(commandTitle("bash -lc 'sed -n 1,240p package.json src/main/index.ts extra'"), 'sed -n 1,240p package.json src/main/index.ts extra')
  assert.match(commandTitle(`bash -lc "${'x'.repeat(80)}"`, 20), /…$/)
})

test('stacked commands collapse to a counted headline and cluster by verb', () => {
  const items = [
    command('c1', 't1', 'bash -lc "rg AGENTS.md"'),
    command('c2', 't1', `/bin/bash -lc 'rg src'`),
    command('c3', 't1', 'bash -lc "sed -n 1,20p package.json"')
  ] as Extract<ChatTranscriptItem, { type: 'command' }>[]
  assert.equal(activityHeadline(items), 'Ran 3 commands')
  assert.deepEqual(activityClusters(items).map((cluster) => cluster.title), ['rg × 2', 'sed -n 1,20p package.json'])
})

test('a single command keeps its short title instead of a count', () => {
  assert.equal(activityHeadline([command('c1', 't1', 'bash -lc "git status"') as Extract<ChatTranscriptItem, { type: 'command' }>]), 'git status')
})
