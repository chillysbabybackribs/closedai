import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import {
  listableChat, openDeskSearchHits, rankChats, rankChatsExcluding, searchChats, segmentTitle, stepHighlight
} from './history-search.js'

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

test('search ranks titles above folders and includes child chats across projects', () => {
  const child = { ...chat('child', 'Search accessibility', 200, '/projects/other'), parentPaneId: 'parent' }
  assert.deepEqual(searchChats([chat('parent', 'Layout', 100, '/projects/search'), child], 'search')
    .map(hit => hit.row.paneId), ['child', 'parent'])
})

test('folder search is a case-insensitive basename substring with no title highlights', () => {
  const rows = [chat('folder', 'UI work', 100, '/home/me/projects/ClosedAI')]
  const hits = searchChats(rows, '  CLOSED  ')
  assert.deepEqual(hits.map(hit => hit.row.paneId), ['folder'])
  assert.equal(hits[0]!.folder, 'ClosedAI')
  assert.deepEqual(hits[0]!.titleRanges, [])
  assert.deepEqual(segmentTitle(hits[0]!.row.title, hits[0]!.titleRanges), [{ text: 'UI work', matched: false }])
  assert.equal(searchChats(rows, 'projects').length, 0)
  assert.equal(searchChats(rows, 'clai').length, 0) // Folders do not use fuzzy title matching.
})

test('title, preview-only, and folder-only matches rank in that order regardless of activity', () => {
  const rows = [
    chat('folder', 'UI work', 900, '/projects/ClosedAI'),
    { ...chat('preview', 'UI work', 500, '/projects/ClosedAI'), preview: 'Fix CLOSED rendering' },
    { ...chat('title', 'Closed issue', 1, '/projects/ClosedAI'), preview: 'closed rendering' }
  ]
  const hits = rankChats(rows, 'closed')
  assert.deepEqual(hits.map(hit => hit.row.paneId), ['title', 'preview', 'folder'])
  assert.deepEqual(hits.map(hit => hit.titleRanges), [[[0, 6]], [], []])
})

test('chats without a project folder still match titles and previews', () => {
  const rows = [chat('title', 'Closed issue', 1, ''),
    { ...chat('preview', 'UI work', 2, ''), preview: 'closed rendering' }, chat('other', 'UI work', 3, '')]
  assert.deepEqual(searchChats(rows, 'closed').map(hit => hit.row.paneId), ['title', 'preview'])
  assert.equal(searchChats(rows, '').length, 3)
})

test('folder matches preserve activity ties, result limits, and blank-chat visibility', () => {
  const rows = [
    { ...chat('touched', 'UI work', 900, '/projects/ClosedAI'), lastTurnEndedAt: 5 },
    { ...chat('b', 'UI work', 10, '/projects/ClosedAI'), lastTurnEndedAt: 100 },
    { ...chat('a', 'UI work', 1, '/projects/ClosedAI'), lastTurnEndedAt: 100 },
    { ...chat('blank', 'New chat', 1000, '/projects/ClosedAI'), threadId: null, attached: true },
    { ...chat('running', 'New chat', 50, '/projects/ClosedAI'), threadId: null, running: true },
    { ...chat('continued', 'New chat', 30, '/projects/ClosedAI'), threadId: null,
      continuedFrom: { paneId: 'prior', title: 'Prior work', handoff: null } }
  ]
  const ids = ['a', 'b', 'running', 'continued', 'touched']
  assert.deepEqual(rankChats(rows, 'closed').map(hit => hit.row.paneId), ids)
  assert.deepEqual(rankChats(rows, '  ').map(hit => hit.row.paneId), ids)
  assert.deepEqual(searchChats(rows, 'closed', 2).map(hit => hit.row.paneId), ids.slice(0, 2))
  assert.equal(searchChats(rows, 'closed', 0).length, 0)
  const many = Array.from({ length: 12 }, (_, i) => chat(String(i), 'UI work', i, '/projects/ClosedAI'))
  assert.equal(searchChats(many, 'closed').length, 8)
})

test('empty input shows bounded recent history, excludes blank chats, and does not reorder input', () => {
  const rows = [chat('old', 'Older', 1), chat('new', 'Recent', 200),
    { ...chat('blank', 'New chat', 300), threadId: null }]
  assert.deepEqual(searchChats(rows, '  ', 1).map(hit => hit.row.paneId), ['new'])
  assert.equal(rows[0]?.paneId, 'old')
  assert.equal(searchChats(rows, '', 0).length, 0)
  assert.equal(searchChats(rows, 'zzzzzz').length, 0)
})

test('one visibility rule: blank panes hide unless running or continuing another chat', () => {
  const blank = { ...chat('blank', 'New chat'), threadId: null, attached: true }
  assert.equal(listableChat(blank), false)
  assert.equal(listableChat({ ...blank, running: true }), true)
  assert.equal(listableChat({ ...blank, preview: 'hello' }), true)
  assert.equal(listableChat({ ...blank, continuedFrom: { paneId: 'p', title: 'Prior', handoff: null } }), true)
  assert.equal(listableChat(chat('threaded', 'Titled')), true)
  // A title query cannot surface what the rest view hides.
  assert.equal(searchChats([blank], 'new').length, 0)
})

test('a query also finds chats by preview, ranked below every title match', () => {
  const rows = [
    { ...chat('said', 'Unrelated title', 500), preview: 'please fix the drawer animation' },
    chat('titled', 'Long title where drawer appears at the very end of it all', 1)
  ]
  const hits = searchChats(rows, 'drawer')
  assert.deepEqual(hits.map(hit => [hit.row.paneId, hit.titleRanges.length]), [['titled', 1], ['said', 0]])
  assert.equal(searchChats(rows, 'DRAWER ANIM').map(hit => hit.row.paneId).join(), 'said')
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

test('open desk hits keep layout open order and stay out of the history section', () => {
  const rows = [
    { ...chat('a', 'Alpha', 100), lastTurnEndedAt: 500 },
    { ...chat('b', 'Beta', 200), lastTurnEndedAt: 50 },
    chat('c', 'Gamma', 300),
    { ...chat('blank', 'New chat', 1000), threadId: null, attached: true }
  ]
  assert.deepEqual(openDeskSearchHits(rows, ['b', 'a', 'blank'], '').map((hit) => hit.row.paneId), ['b', 'a'])
  const exclude = new Set(['b', 'a'])
  assert.deepEqual(rankChatsExcluding(rows, '', exclude).map((hit) => hit.row.paneId), ['c'])
  assert.deepEqual(openDeskSearchHits(rows, ['b', 'a'], 'alp').map((hit) => hit.row.paneId), ['a'])
})

test('rankChats orders by last turn end, then store touch', () => {
  const open = { ...chat('open', 'Still open', 500), attached: true, lastTurnEndedAt: 50 }
  const touched = { ...chat('touched', 'Touched later', 400), lastTurnEndedAt: 10 }
  const recentTurn = { ...chat('recent-turn', 'Older store row', 20), lastTurnEndedAt: 300 }
  assert.deepEqual(rankChats([open, touched, recentTurn], '').map(hit => hit.row.paneId),
    ['recent-turn', 'open', 'touched'])
})
