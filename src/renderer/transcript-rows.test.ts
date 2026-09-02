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
  assert.deepEqual(rows.map((row) => row.kind), ['activity', 'item', 'activity', 'activity'])
  assert.equal(rows[0]?.kind === 'activity' && rows[0].items[0]?.id, 'c1')
  assert.equal(rows[2]?.kind === 'activity' && rows[2].items[0]?.id, 'f1')
  assert.equal(rows[3]?.kind === 'activity' && rows[3].items[0]?.id, 'c2')
})

test('empty placeholders do not split identically named calls', () => {
  const web = (id: string, turnId: string | null): ChatTranscriptItem => ({
    type: 'tool', id, turnId, label: 'Web search', detail: id, status: 'completed'
  })
  const rows = transcriptRows([
    web('s1', null),
    { type: 'assistant', id: 'a0', turnId: 't1', text: '', phase: null, streaming: true },
    web('s2', 't1')
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.kind, 'activity')
  if (rows[0]?.kind === 'activity') {
    assert.deepEqual(rows[0].items.map((item) => item.id), ['s1', 's2'])
    assert.equal(activityHeadline(rows[0].items), 'Web search 2')
  }
})

test('different activity names stay on their own rows', () => {
  const rows = transcriptRows([
    command('c1', 't1', 'bash -lc "sed -n 1,20p file"'),
    { type: 'tool', id: 's1', turnId: 't1', label: 'Web search', detail: 'q1', status: 'completed' },
    { type: 'tool', id: 's2', turnId: 't1', label: 'Web search', detail: 'q2', status: 'completed' }
  ])
  assert.deepEqual(rows.map((row) => row.kind === 'activity' ? activityHeadline(row.items) : ''), [
    "sed -n 1,20p file",
    'Web search 2'
  ])
})

test('tool activity never consolidates across a visible turn break', () => {
  const rows = transcriptRows([
    command('a', 'turn-a', 'a'),
    { type: 'user', id: 'u', turnId: 'turn-b', text: 'next' },
    command('b', 'turn-b', 'b')
  ])
  assert.deepEqual(rows.map((row) => row.kind), ['activity', 'item', 'activity'])
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
  const orphanTool: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    command('c1', null, 'ls')
  ]
  assert.equal(visibleTranscriptRows(orphanTool, 't1').some((row) => row.kind === 'reasoning'), false)
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
  assert.deepEqual(activityClusters(items).map((cluster) => cluster.title), ['rg 2', 'sed -n 1,20p package.json'])
})

test('a single command keeps its short title instead of a count', () => {
  assert.equal(activityHeadline([command('c1', 't1', 'bash -lc "git status"') as Extract<ChatTranscriptItem, { type: 'command' }>]), 'git status')
})
