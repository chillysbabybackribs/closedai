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
    assert.equal(activityHeadline(rows[0].items), 'Searched the web 2 times')
  }
})

test('different activity names stay on their own rows', () => {
  const rows = transcriptRows([
    command('c1', 't1', 'bash -lc "sed -n 1,20p file"'),
    { type: 'tool', id: 's1', turnId: 't1', label: 'Web search', detail: 'q1', status: 'completed' },
    { type: 'tool', id: 's2', turnId: 't1', label: 'Web search', detail: 'q2', status: 'completed' }
  ])
  assert.deepEqual(rows.map((row) => row.kind === 'activity' ? activityHeadline(row.items) : ''), [
    'Read file',
    'Searched the web 2 times'
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

test('consecutive reasoning in a turn hoists to one thinking slot before the answer', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 'turn-a', text: 'Go' },
    { type: 'reasoning', id: 'r1', turnId: 'turn-a', text: 'First thought', streaming: true },
    {
      type: 'assistant', id: 'a1', turnId: 'turn-a', text: 'Progress update',
      phase: 'commentary', streaming: false
    },
    { type: 'reasoning', id: 'r2', turnId: 'turn-a', text: 'Second thought', streaming: false },
    { type: 'plan', id: 'p1', turnId: 'turn-a', text: 'Implementation plan', streaming: false }
  ]
  const rows = visibleTranscriptRows(items, 'turn-a')
  assert.deepEqual(rows.map((row) => row.kind), ['item', 'reasoning', 'item'])
  assert.equal(rows[1]?.kind === 'reasoning' && rows[1].items.map((item) => item.id).join(','), 'r1,r2,p1')
})

test('an active turn with only the user prompt shows a pending thinking row', () => {
  const items: ChatTranscriptItem[] = [{ type: 'user', id: 'u1', turnId: 't1', text: 'Hello' }]
  const rows = visibleTranscriptRows(items, 't1')
  assert.deepEqual(rows.map((row) => row.kind), ['item', 'reasoning'])
  assert.equal(rows[1]?.kind === 'reasoning' && rows[1].items.length, 0)
  assert.equal(visibleTranscriptRows(items, null).length, 1)
})

test('thinking stays pinned after the user while tools and answers stream', () => {
  const emptyAnswer: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: '', phase: null, streaming: true }
  ]
  assert.deepEqual(visibleTranscriptRows(emptyAnswer, 't1').map((row) => row.kind), ['item', 'reasoning'])

  const withThought: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    { type: 'reasoning', id: 'r1', turnId: 't1', text: 'Plan', streaming: true },
    command('c1', 't1', 'ls'),
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Done', phase: 'final_answer', streaming: false }
  ]
  assert.deepEqual(visibleTranscriptRows(withThought, 't1').map((row) => row.kind), [
    'item', 'reasoning', 'activity', 'item'
  ])

  const withTool: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    command('c1', 't1', 'ls')
  ]
  assert.deepEqual(visibleTranscriptRows(withTool, 't1').map((row) => row.kind), ['item', 'reasoning', 'activity'])

  const orphanTool: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    command('c1', null, 'ls')
  ]
  assert.deepEqual(visibleTranscriptRows(orphanTool, 't1').map((row) => row.kind), ['item', 'reasoning', 'activity'])
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

test('stacked commands collapse to one counted headline', () => {
  const items = [
    command('c1', 't1', 'bash -lc "rg AGENTS.md"'),
    command('c2', 't1', `/bin/bash -lc 'rg src'`),
    command('c3', 't1', 'bash -lc "sed -n 1,20p package.json"')
  ] as Extract<ChatTranscriptItem, { type: 'command' }>[]
  assert.equal(activityHeadline(items), 'Ran 3 commands')
  assert.deepEqual(activityClusters(items).map((cluster) => cluster.title), ['Ran 3 commands'])
})

test('a single command keeps its short title instead of a count', () => {
  assert.equal(activityHeadline([command('c1', 't1', 'bash -lc "git status"') as Extract<ChatTranscriptItem, { type: 'command' }>]), 'Checked git status')
})
