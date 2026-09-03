import assert from 'node:assert/strict'
import test from 'node:test'
import { searchChats, segmentTitle, stepHighlight } from './drawer-search.js'
import type { DrawerRowModel } from './drawer-types.js'

function makeRow(id: string, title: string, cwd: string | null = null, updatedAt = 1000): DrawerRowModel {
  return {
    id,
    threadId: id,
    title,
    cwd,
    updatedAt,
    messageCount: 1,
    linesAdded: 0,
    linesRemoved: 0,
    running: false,
    status: 'chat',
    children: []
  }
}

test('searchChats matches titles by subsequence and ranks appropriately', () => {
  const rows = [
    makeRow('1', 'Inspect side drawer design', '/home/dp/Desktop/closedai', 100),
    makeRow('2', 'Update browser styles', '/home/dp/Desktop/closedai', 200),
    makeRow('3', 'Drawer animation fixes', '/home/dp/Desktop/closedai', 300)
  ]

  const hits = searchChats(rows, 'draw')
  assert.equal(hits.length, 2)
  assert.equal(hits[0]?.row.id, '3')
  assert.equal(hits[1]?.row.id, '1')
})

test('searchChats falls back to folder matches when title does not match', () => {
  const rows = [
    makeRow('1', 'Fix CSS typography', '/home/dp/Desktop/cool-project', 100),
    makeRow('2', 'Unrelated work', '/home/dp/Desktop/other', 200)
  ]

  const hits = searchChats(rows, 'cool')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.row.id, '1')
  assert.equal(hits[0]?.folder, 'cool-project')
})

test('segmentTitle splits titles correctly into matched segments', () => {
  const title = 'Side drawer'
  const ranges: Array<[number, number]> = [[5, 9]]
  const segments = segmentTitle(title, ranges)
  assert.deepEqual(segments, [
    { text: 'Side ', matched: false },
    { text: 'draw', matched: true },
    { text: 'er', matched: false }
  ])
})

test('stepHighlight wraps around correctly', () => {
  assert.equal(stepHighlight(0, 1, 3), 1)
  assert.equal(stepHighlight(2, 1, 3), 0)
  assert.equal(stepHighlight(0, -1, 3), 2)
})
