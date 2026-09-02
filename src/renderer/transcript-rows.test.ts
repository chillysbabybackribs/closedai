import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../shared/chat.ts'
import {
  activityClusters,
  activityHeadline,
  commandTitle,
  transcriptRows
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

test('different activity kinds in one turn consolidate into one counted row', () => {
  const rows = transcriptRows([
    command('c1', 't1', 'bash -lc "sed -n 1,20p file"'),
    { type: 'tool', id: 's1', turnId: 't1', label: 'Web search', detail: 'q1', status: 'completed' },
    { type: 'tool', id: 's2', turnId: 't1', label: 'Web search', detail: 'q2', status: 'completed' }
  ])
  assert.deepEqual(rows.map((row) => row.kind), ['activity'])
  const activity = rows[0] as Extract<(typeof rows)[0], { kind: 'activity' }>
  assert.equal(activityHeadline(activity.items), 'Read file, Searched the web 2 times')
  assert.deepEqual(
    activityClusters(activity.items).map((c) => c.title),
    ['Read file', 'Searched the web 2 times']
  )
})

test('tool activity never consolidates across a visible turn break', () => {
  const rows = transcriptRows([
    command('a', 'turn-a', 'a'),
    { type: 'user', id: 'u', turnId: 'turn-b', text: 'next' },
    command('b', 'turn-b', 'b')
  ])
  assert.deepEqual(rows.map((row) => row.kind), ['activity', 'item', 'activity'])
})

test('reasoning and plan items produce no rows and do not split activity', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 'turn-a', text: 'Go' },
    { type: 'reasoning', id: 'r1', turnId: 'turn-a', text: 'First thought', streaming: true },
    command('c1', 'turn-a', 'ls'),
    { type: 'plan', id: 'p1', turnId: 'turn-a', text: 'Implementation plan', streaming: false },
    command('c2', 'turn-a', 'pwd'),
    { type: 'assistant', id: 'a1', turnId: 'turn-a', text: 'Done', phase: 'final_answer', streaming: false }
  ]
  const rows = transcriptRows(items)
  assert.deepEqual(rows.map((row) => row.kind), ['item', 'activity', 'item'])
  assert.deepEqual(
    rows[1]?.kind === 'activity' ? rows[1].items.map((item) => item.id) : [],
    ['c1', 'c2']
  )
})

test('a turn carrying nothing but reasoning renders only the user prompt', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    { type: 'reasoning', id: 'r1', turnId: 't1', text: 'Thinking it over', streaming: true },
    { type: 'assistant', id: 'a1', turnId: 't1', text: '', phase: null, streaming: true }
  ]
  assert.deepEqual(transcriptRows(items).map((row) => row.kind), ['item'])
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
  assert.equal(activityHeadline(items, true), 'Running 3 commands')
  assert.deepEqual(activityClusters(items).map((cluster) => cluster.title), ['Ran 3 commands'])
  assert.deepEqual(activityClusters(items, true).map((cluster) => cluster.title), ['Running 3 commands'])
})

test('a single command keeps its short title instead of a count', () => {
  const item = command('c1', 't1', 'bash -lc "git status"') as Extract<ChatTranscriptItem, { type: 'command' }>
  assert.equal(activityHeadline([item]), 'Checked git status')
  assert.equal(activityHeadline([item], true), 'Checking git status')
})

test('tool activity headlines dynamically reflect running and completed state', () => {
  const readTool = { type: 'tool', id: 't1', turnId: 'turn-1', label: 'Read page', detail: '', status: 'inProgress' } as const
  assert.equal(activityHeadline([readTool], true), 'Reading page')
  assert.equal(activityHeadline([readTool], false), 'Read page')

  const analyzeTool = { type: 'tool', id: 't2', turnId: 'turn-1', label: 'Analyze workspace', detail: '', status: 'inProgress' } as const
  assert.equal(activityHeadline([analyzeTool], true), 'Analyzing workspace')
  assert.equal(activityHeadline([analyzeTool], false), 'Analyzed workspace')
})

test('multiple read commands display file names in headline', () => {
  const items = [
    command('c1', 't1', 'cat file1.ts'),
    command('c2', 't1', 'cat file2.ts'),
    command('c3', 't1', 'cat file3.ts'),
    command('c4', 't1', 'cat file4.ts')
  ] as Extract<ChatTranscriptItem, { type: 'command' }>[]
  assert.equal(activityHeadline(items), 'Read file1.ts, file2.ts, file3.ts (+1 more)')
  assert.equal(activityHeadline(items, true), 'Reading file1.ts, file2.ts, file3.ts (+1 more)')
})

