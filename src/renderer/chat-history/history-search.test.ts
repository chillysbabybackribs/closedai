import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { searchChats, segmentTitle, stepHighlight } from './history-search.js'

function chat(paneId: string, title: string, updatedAt = 100, cwd = '/projects/app'): ChatRowSummary {
  return {
    paneId, title, updatedAt, cwd, threadId: paneId, pinnedAt: null, parentPaneId: null,
    kind: 'peer', provider: 'codex', modelId: null, preview: '', createdAt: 1,
    lastTurnEndedAt: null, attached: false, running: false, activity: null
  }
}

test('title suggestions are case insensitive and favor consecutive word starts', () => {
  const hits = searchChats([
    chat('1', 'Inspect drawer design'), chat('2', 'Browser styles'), chat('3', 'Drawer animation')
  ], 'DRAW')
  assert.deepEqual(hits.map(hit => hit.row.paneId), ['3', '1'])
  assert.deepEqual(hits[0]?.titleRanges, [[0, 4]])
})

test('search uses titles rather than project names and includes child chats across projects', () => {
  const child = { ...chat('child', 'Search accessibility', 200, '/projects/other'), parentPaneId: 'parent' }
  assert.deepEqual(searchChats([chat('parent', 'Layout', 100, '/projects/search'), child], 'search')
    .map(hit => hit.row.paneId), ['child'])
})

test('empty input shows bounded recent history, excludes blank chats, and does not reorder input', () => {
  const rows = [chat('old', 'Older', 1), chat('new', 'Recent', 200),
    { ...chat('blank', 'New chat', 300), threadId: null }]
  assert.deepEqual(searchChats(rows, '  ', 1).map(hit => hit.row.paneId), ['new'])
  assert.equal(rows[0]?.paneId, 'old')
  assert.equal(searchChats(rows, '', 0).length, 0)
  assert.equal(searchChats(rows, 'zzzzzz').length, 0)
})

test('equal scores use recent activity and stable ids, with a bounded result count', () => {
  const rows = Array.from({ length: 12 }, (_, index) => chat(String(index), 'Shared title', index))
  assert.equal(searchChats(rows, 'shared').length, 8)
  assert.equal(searchChats(rows, 'shared')[0]?.row.paneId, '11')
})

test('highlight segments preserve the complete title and keyboard navigation wraps', () => {
  assert.deepEqual(segmentTitle('Side drawer', [[5, 9]]), [
    { text: 'Side ', matched: false }, { text: 'draw', matched: true }, { text: 'er', matched: false }
  ])
  assert.equal(stepHighlight(2, 1, 3), 0)
  assert.equal(stepHighlight(0, -1, 3), 2)
  assert.equal(stepHighlight(0, 1, 0), 0)
})
