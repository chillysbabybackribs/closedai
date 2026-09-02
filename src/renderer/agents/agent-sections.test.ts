import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAgentSections,
  countLiveRows,
  groupByDirectory,
  rowIsLive,
  splitChildren,
  subtreeIsLive
} from './agent-sections.js'
import type { AgentRowModel } from './agents-types.js'

function makeRow(
  id: string,
  overrides: Partial<AgentRowModel> = {}
): AgentRowModel {
  return {
    id,
    threadId: id,
    title: `Chat ${id}`,
    cwd: '/home/dp/Desktop/closedai',
    updatedAt: 1000,
    messageCount: 1,
    linesAdded: 0,
    linesRemoved: 0,
    running: false,
    status: 'chat',
    completedUnviewed: false,
    children: [],
    ...overrides
  }
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

test('buildAgentSections partitions rows into the 5 sections', () => {
  const now = 100_000
  const runningRow = makeRow('running-1', { running: true, status: 'running' })
  const reviewRow = makeRow('review-1', { status: 'done' })
  const recentRow = makeRow('recent-1', { status: 'chat' })
  const completedRow = makeRow('completed-1', { status: 'done' })
  const historyRow = makeRow('history-1', { status: 'chat' })

  const reviewQueue = { 'review-1': now - 5000 }
  const recentlyCompleted = { 'recent-1': now - 1000 }

  const sections = buildAgentSections(
    [runningRow, reviewRow, recentRow, completedRow, historyRow],
    reviewQueue,
    recentlyCompleted,
    now
  )

  assert.equal(sections.running.length, 1)
  assert.equal(sections.running[0]?.id, 'running-1')

  assert.equal(sections.reviewQueue.length, 1)
  assert.equal(sections.reviewQueue[0]?.id, 'review-1')

  assert.equal(sections.recentlyCompleted.length, 1)
  assert.equal(sections.recentlyCompleted[0]?.id, 'recent-1')

  assert.equal(sections.completed.length, 1)
  assert.equal(sections.completed[0]?.id, 'completed-1')

  assert.equal(sections.history.length, 1)
  assert.equal(sections.history[0]?.id, 'history-1')
})
