import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDrawerSections,
  countLiveRows,
  groupByDirectory,
  rowIsCurrent,
  rowIsLive,
  splitChildren,
  subtreeIsLive
} from './drawer-sections.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { DrawerRowModel } from './drawer-types.js'

/** A detached chat record: it has no pane, but it is a full row like any other. */
function makeRow(
  id: string,
  overrides: Partial<DrawerRowModel> = {}
): DrawerRowModel {
  const chat: ChatRowSummary = {
    paneId: id,
    parentPaneId: null,
    kind: 'peer',
    provider: 'codex',
    modelId: null,
    threadId: id,
    title: `Chat ${id}`,
    preview: '',
    cwd: '/home/dp/Desktop/closedai',
    createdAt: 1000,
    lastTurnEndedAt: null,
    updatedAt: 1000,
    attached: overrides.paneId !== undefined,
    running: overrides.running ?? false,
    activity: null
  }
  return {
    id,
    threadId: id,
    title: `Chat ${id}`,
    cwd: '/home/dp/Desktop/closedai',
    createdAt: 1000,
    updatedAt: 1000,
    messageCount: 1,
    linesAdded: 0,
    linesRemoved: 0,
    running: false,
    status: 'chat',
    provider: 'codex',
    chat,
    children: [],
    ...overrides
  }
}

/** An attached chat: the same record with a live pane under its own id. */
function pane(id: string, overrides: Partial<DrawerRowModel> = {}): DrawerRowModel {
  return makeRow(id, { paneId: id, threadId: `thread-${id}`, status: 'done', ...overrides })
}

test('rowIsLive and subtreeIsLive identify active work', () => {
  const idleChild = makeRow('child-1', { running: false, status: 'chat' })
  const liveChild = makeRow('child-2', { running: true, status: 'running' })
  const parent = makeRow('parent', { running: false, status: 'chat', children: [idleChild, liveChild] })

  assert.equal(rowIsLive(parent), false)
  assert.equal(subtreeIsLive(parent), true)
  assert.equal(countLiveRows([parent]), 1)
})

test('splitChildren divides live vs settled sub-agents', () => {
  const liveChild = makeRow('live-1', { running: true, status: 'running' })
  const doneChild = makeRow('done-1', { running: false, status: 'done' })
  const parent = makeRow('parent', { children: [liveChild, doneChild] })

  const { live, settled } = splitChildren(parent)
  assert.equal(live.length, 1)
  assert.equal(live[0]?.id, 'live-1')
  assert.equal(settled.length, 1)
  assert.equal(settled[0]?.id, 'done-1')
})

test('groupByDirectory groups by cwd and puts No folder last', () => {
  const row1 = makeRow('1', { cwd: '/home/dp/Desktop/proj-a' })
  const row2 = makeRow('2', { cwd: null })
  const row3 = makeRow('3', { cwd: '/home/dp/Desktop/proj-b' })

  const groups = groupByDirectory([row1, row2, row3])
  assert.equal(groups.length, 3)
  assert.equal(groups[0]?.label, 'proj-a')
  assert.equal(groups[1]?.label, 'proj-b')
  assert.equal(groups[2]?.label, 'No folder')
})

test('Current contains only running work; idle and brand-new panes belong in History', () => {
  const fresh = pane('pane-new', { threadId: null, status: 'chat', updatedAt: 2000 })
  const running = pane('pane-run', { running: true, status: 'running', updatedAt: 3000 })
  const idle = pane('pane-idle', { updatedAt: 1500 })
  const record = makeRow('thread-old', { updatedAt: 1000 })

  const sections = buildDrawerSections([fresh, running, idle, record], {})
  assert.deepEqual(sections.current.map((row) => row.id), ['pane-run'])
  assert.deepEqual(sections.reviewQueue, [])
  assert.deepEqual(sections.history.map((row) => row.id), ['pane-new', 'pane-idle', 'thread-old'])
})

test('completed panes move to the recently completed section, newest completion first', () => {
  const rows = [pane('pane-a'), pane('pane-b'), pane('pane-c')]
  const queue = {
    'pane-a': { queuedAt: 100, viewedAt: null },
    'pane-c': { queuedAt: 300, viewedAt: 350 }
  }

  const sections = buildDrawerSections(rows, queue)
  assert.deepEqual(sections.current, [])
  assert.deepEqual(sections.reviewQueue.map((row) => row.id), ['pane-c', 'pane-a'])
  assert.deepEqual(sections.history.map((row) => row.id), ['pane-b'])
})

test('opening a completed chat leaves it there; only running again returns it to Current', () => {
  const queue = { 'pane-a': { queuedAt: 100, viewedAt: 150 } }

  const read = buildDrawerSections([pane('pane-a')], queue)
  assert.deepEqual(read.current, [])
  assert.deepEqual(read.reviewQueue.map((row) => row.id), ['pane-a'])

  const messaged = buildDrawerSections([pane('pane-a', { running: true, status: 'running' })], queue)
  assert.deepEqual(messaged.current.map((row) => row.id), ['pane-a'])
  assert.deepEqual(messaged.reviewQueue, [])
})

test('a queued pane that is running again is shown as current, not awaiting review', () => {
  const rows = [pane('pane-a', { running: true, status: 'running' })]
  const sections = buildDrawerSections(rows, { 'pane-a': { queuedAt: 1, viewedAt: null } })
  assert.deepEqual(sections.current.map((row) => row.id), ['pane-a'])
  assert.deepEqual(sections.reviewQueue, [])
})

test('a detached chat stays in the review queue: detaching its pane does not change its identity', () => {
  const sections = buildDrawerSections([makeRow('chat-1')], { 'chat-1': { queuedAt: 1, viewedAt: null } })
  assert.deepEqual(sections.reviewQueue.map((row) => row.id), ['chat-1'])
  assert.deepEqual(sections.history, [])
})

test('only the selected chat is current, even while no chat has a thread yet', () => {
  const selected = makeRow('pane-1', { paneId: 'pane-1', threadId: null })
  const otherFreshPane = makeRow('pane-2', { paneId: 'pane-2', threadId: null })

  assert.equal(rowIsCurrent(selected, 'pane-1'), true)
  assert.equal(rowIsCurrent(otherFreshPane, 'pane-1'), false)
  // The old thread comparison matched null against null and lit up every idle pane at once.
  assert.equal(rowIsCurrent(makeRow('pane-3', { paneId: 'pane-3', threadId: 'thread-9' }), 'pane-1'), false)
  assert.equal(rowIsCurrent(makeRow('detached'), null), false)
})

test('Current is ordered by when each chat was created, not by streaming activity', () => {
  const older = pane('pane-old', { running: true, status: 'running', createdAt: 100, updatedAt: 9000 })
  const newer = pane('pane-new', { running: true, status: 'running', createdAt: 200, updatedAt: 500 })

  const sections = buildDrawerSections([older, newer], {})
  assert.deepEqual(sections.current.map((row) => row.id), ['pane-new', 'pane-old'])
})

test('history section is sorted by updatedAt descending', () => {
  const older = makeRow('thread-older', { updatedAt: 1000 })
  const newer = makeRow('thread-newer', { updatedAt: 3000 })
  const middle = pane('pane-middle', { updatedAt: 2000 })

  const sections = buildDrawerSections([older, newer, middle], {})
  assert.deepEqual(sections.history.map((row) => row.id), ['thread-newer', 'pane-middle', 'thread-older'])
})
