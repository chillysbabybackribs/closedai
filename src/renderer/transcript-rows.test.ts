import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../shared/chat.ts'
import type { ChatWorkspaceSnapshot } from '../shared/chat-peers.ts'
import {
  activityHeadline,
  activityState,
  anchoredVisibleStart,
  clampVisibleStart,
  commandTitle,
  lastTurnRowStart,
  mountedTurnWindowStart,
  turnLayout,
  dedupeAssistantSegments,
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
  let state: ChatWorkspaceSnapshot = { ...initial, selectedPaneId: 'pane', selected: { ...initial.selected, threadId: 'thread', items } }
  state = reduceChatWorkspaceEvent(state, { type: 'trimMountedHistory', paneId: 'pane', threadId: 'thread' })
  assert.equal(state.selected.items.length, 1)
  state = reduceChatWorkspaceEvent(state, { type: 'pane', paneId: 'pane', event: {
    type: 'item', item: { type: 'assistant', id: 'answer', turnId: 't11', text: '', phase: null, streaming: true }
  } })
  let text = ''
  for (const delta of ['First token', ' and more']) {
    text += delta
    state = reduceChatWorkspaceEvent(state, { type: 'pane', paneId: 'pane', event: {
      type: 'itemDelta', itemId: 'answer', field: 'text', delta
    } })
    const current = transcriptRows(state.selected.items)
    const visible = current.slice(anchoredVisibleStart(anchor, current, 3))
    assert.deepEqual(visible.map(transcriptRowKey), ['item:u11', 'item:answer'])
    const answer = visible.at(-1)
    assert.equal(answer?.kind === 'item' && answer.item.type === 'assistant' && answer.item.text, text)
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

test('duplicate assistant text after a tool in the same turn is shown once', () => {
  const question = 'For the fourth piece, what should this agent never do on its own?'
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'boundaries' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: question, phase: null, streaming: false },
    { type: 'tool', id: 'tool1', turnId: 't1', label: 'closedai_app · state', detail: 'state', status: 'completed' },
    { type: 'assistant', id: 'a2', turnId: 't1', text: question, phase: null, streaming: false }
  ]
  const rows = transcriptRows(items)
  const assistants = rows.flatMap((row) => row.kind === 'item' && row.item.type === 'assistant' ? [row.item.text] : [])
  assert.deepEqual(assistants, [question])
  assert.deepEqual(dedupeAssistantSegments(items).map((item) => item.id), ['u1', 'a1', 'tool1'])
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

test('file-bearing tool titles collapse to a short phrase in mixed headlines', () => {
  const items = [
    {
      type: 'fileChange', id: 'f1', turnId: 't1', status: 'completed',
      changes: [
        { path: '/home/dp/Desktop/closedai/src/a.ts', kind: 'update', diff: '+a' },
        { path: '/home/dp/Desktop/closedai/src/b.ts', kind: 'update', diff: '+b' }
      ]
    },
    {
      type: 'tool', id: 'r1', turnId: 't1', label: 'Read src/renderer/titlebar-menu.tsx (79 - 103)',
      detail: '/home/dp/Desktop/closedai/src/renderer/titlebar-menu.tsx', status: 'inProgress'
    }
  ] as Extract<ChatTranscriptItem, { type: 'fileChange' | 'tool' }>[]
  assert.equal(activityHeadline(items, true), 'Editing 2 files, Reading file')
  assert.doesNotMatch(activityHeadline(items, true), /src\/renderer|home\/dp/)
})

test('reads of different files still count as one compacted action', () => {
  const items = [
    { type: 'tool', id: 'r1', turnId: 't1', label: 'Read src/a.ts', detail: 'src/a.ts', status: 'completed' },
    { type: 'tool', id: 'r2', turnId: 't1', label: 'Read src/b.ts (1 - 20)', detail: 'src/b.ts', status: 'completed' }
  ] as Extract<ChatTranscriptItem, { type: 'tool' }>[]
  assert.equal(activityHeadline(items), 'Read 2 files')
  assert.equal(activityHeadline(items, true), 'Reading 2 files')
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

test('continuation notices are filtered out from transcript rows', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    { type: 'notice', id: 'n1', turnId: null, tone: 'info', text: 'Continuing from “old chat”. A short summary...' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Hi', phase: null, streaming: false }
  ]
  const rows = transcriptRows(items)
  assert.deepEqual(rows.map((row) => row.kind === 'item' ? row.item.id : row.id), ['u1', 'a1'])
})

test('rotation schedule notices are filtered out from transcript rows', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    { type: 'notice', id: 'n1', turnId: null, tone: 'info', text: 'Transcript has 466 items; provider context will rotate while idle' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Hi', phase: null, streaming: false }
  ]
  const rows = transcriptRows(items)
  assert.deepEqual(rows.map((row) => row.kind === 'item' ? row.item.id : row.id), ['u1', 'a1'])
})

test('a capture joins the step group that took it; a generated image stays its own row', () => {
  const shot = (id: string, surface: 'app_window' | 'generated_image'): ChatTranscriptItem => (
    { type: 'screenshot', id, turnId: 't1', imageUrl: 'data:,', surface, caption: '' }
  )
  const rows = transcriptRows([
    command('c1', 't1', 'npm run build'),
    shot('s1', 'app_window'),
    command('c2', 't1', 'npm test'),
    shot('g1', 'generated_image')
  ])
  assert.deepEqual(rows.map((row) => row.kind), ['activity', 'item'])
  const activity = rows[0] as Extract<(typeof rows)[0], { kind: 'activity' }>
  assert.deepEqual(activity.items.map((item) => item.id), ['c1', 'c2'])
  assert.deepEqual(activity.shots.map((item) => item.id), ['s1'])
})

test('a settled turn folds its steps and commentary under the header; the live turn folds nothing', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Fix it' },
    { type: 'assistant', id: 'n1', turnId: 't1', text: 'Running the tests first.', phase: null, streaming: false },
    { ...command('c1', 't1', 'npm test'), startedAt: 1_000, finishedAt: 4_000 } as ChatTranscriptItem,
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Fixed.', phase: null, streaming: false },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Again' },
    command('c2', 't2', 'npm test')
  ]
  const rows = transcriptRows(items)
  const { heads, folds } = turnLayout(rows, true)
  assert.deepEqual([...heads.keys()], [0, 4])
  assert.deepEqual(heads.get(0), { key: 't1', live: false, foldable: true, stage: null, steps: 1, startedAt: 1_000, endedAt: 4_000 })
  assert.equal(heads.get(4)?.live, true)
  assert.deepEqual([...folds.entries()], [[1, 't1'], [2, 't1'], [5, 't2']])
  // A settled turn without steps keeps no header; one that ended on a step has nothing to fold.
  const plain = turnLayout(transcriptRows([items[0]!, items[3]!]), false)
  assert.equal(plain.heads.size, 0)
  const unanswered = turnLayout(transcriptRows(items.slice(0, 3)), false)
  assert.equal(unanswered.heads.get(0)?.foldable, false)
  assert.equal(unanswered.folds.size, 0)
})

test('a live turn folds into its stage: the newest step group and the newest text', () => {
  const rows = transcriptRows([
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    { type: 'assistant', id: 'n1', turnId: 't', text: 'First I will look.', phase: null, streaming: false },
    command('c1', 't', 'ls'),
    { type: 'assistant', id: 'n2', turnId: 't', text: 'Now the tests.', phase: null, streaming: false },
    command('c2', 't', 'npm test')
  ])
  const { heads, folds } = turnLayout(rows, true)
  assert.deepEqual(heads.get(0)?.stage, { step: 4, text: 3, textOpen: false })
  assert.equal(heads.get(0)?.foldable, true)
  assert.deepEqual([...folds.keys()], [1, 2, 3, 4])
  // Text before any step is open: it may be the whole answer.
  const fresh = turnLayout(rows.slice(0, 2), true)
  assert.deepEqual(fresh.heads.get(0)?.stage, { step: -1, text: 1, textOpen: true })
  assert.equal(fresh.heads.get(0)?.foldable, false)
})

test('text after the newest step stays open until a step follows it', () => {
  const base: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    { type: 'assistant', id: 'n1', turnId: 't', text: 'Looking first.', phase: null, streaming: false },
    command('c1', 't', 'ls'),
    { type: 'assistant', id: 'a', turnId: 't', text: 'Here is the answer', phase: null, streaming: true }
  ]
  assert.deepEqual(turnLayout(transcriptRows(base), true).heads.get(0)?.stage, { step: 2, text: 3, textOpen: true })
  // Labelled commentary never counts as the answer.
  const labelled = [...base.slice(0, 3), { ...base[3]!, phase: 'commentary' } as ChatTranscriptItem]
  assert.deepEqual(turnLayout(transcriptRows(labelled), true).heads.get(0)?.stage, { step: 2, text: 3, textOpen: false })
  const followed = turnLayout(transcriptRows([...base, command('c2', 't', 'npm test')]), true)
  assert.deepEqual(followed.heads.get(0)?.stage, { step: 4, text: 3, textOpen: false })
})
