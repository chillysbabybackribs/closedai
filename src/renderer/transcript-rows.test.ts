import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../shared/chat.ts'
import {
  activityHeadline,
  activityState,
  anchoredVisibleStart,
  clampVisibleStart,
  commandTitle,
  lastTurnRowStart,
  mountedTurnWindowStart,
  transcriptRows,
  transcriptRowKey
} from './transcript-rows.ts'
import { initialChatWorkspaceState, reduceChatWorkspaceEvent } from './chat-state.ts'

test('history trimming keeps the latest prompt and subsequent streamed response visible', () => {
  const items: ChatTranscriptItem[] = Array.from({ length: 12 }, (_, index) => ({
    type: 'user', id: `u${index}`, turnId: `t${index}`, text: `Prompt ${index}`
  }))
  const rows = transcriptRows(items)
  const anchor = transcriptRowKey(rows[lastTurnRowStart(rows)])
  const initial = initialChatWorkspaceState()
  let state = { ...initial, selectedPaneId: 'pane', selected: { ...initial.selected, threadId: 'thread', items } }
  state = reduceChatWorkspaceEvent(state, { type: 'trimMountedHistory', paneId: 'pane', threadId: 'thread' })
  assert.equal(state.selected.items.length, 1)
  for (const text of ['First token', 'First token and more']) {
    state = reduceChatWorkspaceEvent(state, { type: 'pane', paneId: 'pane', event: {
      type: 'item', item: { type: 'assistant', id: 'answer', turnId: 't11', text, phase: null, streaming: true }
    } })
    const current = transcriptRows(state.selected.items)
    const visible = current.slice(anchoredVisibleStart(anchor, current, 3))
    assert.deepEqual(visible.map(transcriptRowKey), ['item:u11', 'item:answer'])
    assert.equal(visible.at(-1)?.kind === 'item' && visible.at(-1)?.item.type === 'assistant' && visible.at(-1)?.item.text, text)
  }
})

test('display anchors survive prepends and recover when a replacement removes the anchor', () => {
  const items: ChatTranscriptItem[] = Array.from({ length: 5 }, (_, index) => ({
    type: 'user', id: `u${index}`, turnId: `t${index}`, text: `Prompt ${index}`
  }))
  const anchor = transcriptRowKey(transcriptRows(items.slice(2))[0])
  assert.equal(anchoredVisibleStart(anchor, transcriptRows(items), 3), 2)
  const replaced = transcriptRows(items.slice(3))
  assert.equal(anchoredVisibleStart(anchor, replaced, 3), 1)
  assert.equal(anchoredVisibleStart(anchor, [], 3), 0)
  assert.equal(anchoredVisibleStart(null, replaced, 3), 1)
  assert.equal(clampVisibleStart(50, replaced, 3), 1)
})

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
  assert.equal(activityState(activity.items), 'done')
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
})

test('one running step keeps the row live and one failure marks it failed', () => {
  const step = (id: string, status = 'completed'): Extract<ChatTranscriptItem, { type: 'command' }> => (
    command(id, 't1', 'ls', status) as Extract<ChatTranscriptItem, { type: 'command' }>
  )
  assert.equal(activityState([step('c1'), step('c2', 'inProgress')]), 'running')
  assert.equal(activityState([step('c1'), { ...step('c3', 'failed'), exitCode: 1 }]), 'failed')
  assert.equal(activityState([step('c1')]), 'done')
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


test('background tasks group at their first occurrence and replace linked launch calls', () => {
  const rows = transcriptRows([
    { type: 'tool', id: 'launch', turnId: 't', label: 'Agent', detail: '', status: 'completed' },
    { type: 'tool', id: 'task-a', turnId: 't', label: 'Review', detail: '', status: 'inProgress', background: { taskId: 'a', kind: 'agent', linkedToolId: 'launch' } },
    { type: 'assistant', id: 'answer', turnId: 't', text: 'Working', phase: 'commentary', streaming: false },
    { type: 'tool', id: 'task-b', turnId: 't', label: 'Inspect', detail: '', status: 'completed', background: { taskId: 'b', kind: 'task' } }
  ])
  assert.deepEqual(rows.map((row) => row.kind), ['background', 'item'])
  assert.equal(rows[0]?.kind === 'background' && rows[0].items.length, 2)
})

test('a lone command inside a mixed row still describes itself', () => {
  const rows = transcriptRows([
    command('c1', 't1', 'bash -lc "cd /repo; rg -c activity-card out/*.css"'),
    { type: 'tool', id: 's1', turnId: 't1', label: 'Web search', detail: 'q', status: 'completed' }
  ])
  const activity = rows[0]
  assert.equal(activity?.kind, 'activity')
  if (activity?.kind !== 'activity') return
  assert.equal(activityHeadline(activity.items), 'Searched for activity-card, Searched the web')
  assert.doesNotMatch(activityHeadline(activity.items), /1 times/)
})

test('mountedTurnWindowStart keeps only the newest three user turns', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'One' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'A1', phase: null, streaming: false },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Two' },
    { type: 'assistant', id: 'a2', turnId: 't2', text: 'A2', phase: null, streaming: false },
    { type: 'user', id: 'u3', turnId: 't3', text: 'Three' },
    { type: 'assistant', id: 'a3', turnId: 't3', text: 'A3', phase: null, streaming: false },
    { type: 'user', id: 'u4', turnId: 't4', text: 'Four' },
    { type: 'assistant', id: 'a4', turnId: 't4', text: 'A4', phase: null, streaming: false }
  ]
  const rows = transcriptRows(items)
  assert.equal(lastTurnRowStart(rows), 6)
  assert.equal(mountedTurnWindowStart(rows, 3), 2)
  assert.equal(clampVisibleStart(0, rows, 3), 2)
  assert.equal(clampVisibleStart(4, rows, 3), 4)
})
