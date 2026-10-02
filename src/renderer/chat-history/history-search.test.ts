import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import {
  chatSearchFooter, chatSearchMeta, chatSearchView, listableChat, MS_DAY, rankChats, REST_CLOSED_LIMIT, searchChats,
  segmentTitle, stepHighlight, threadRecencyGroup
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
  const view = chatSearchView(rows, 'closed', {}, { query: 2 })
  assert.deepEqual(view.sections[0]!.hits.map(hit => hit.row.paneId), ids.slice(0, 2))
  assert.equal(view.sections[0]!.total, 5)
  assert.equal(view.total, 5)
  assert.equal(view.runningCount, 1)
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

test('activity groups are exclusive and precede recent history without hiding older running chats', () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => chat(`history-${i}`, 'History', 1000 + i)),
    { ...chat('running', 'Active task', 1), running: true },
    chat('finished', 'Finished task', 2), chat('newly-finished', 'Another finish', 1),
    chat('viewed', 'Already read', 2000)
  ]
  const view = chatSearchView(rows, '', {
    running: { queuedAt: 1, viewedAt: null },
    finished: { queuedAt: 50, viewedAt: null },
    'newly-finished': { queuedAt: 100, viewedAt: null },
    viewed: { queuedAt: 100, viewedAt: 101 },
    deleted: { queuedAt: 100, viewedAt: null }
  })
  assert.deepEqual(view.sections.map(section => section.label), ['Running', 'Recently completed', 'Earlier'])
  assert.deepEqual(view.sections[0]!.hits.map(hit => hit.row.paneId), ['running'])
  assert.deepEqual(view.sections[1]!.hits.map(hit => hit.row.paneId), ['newly-finished', 'finished'])
  assert.equal(view.sections[2]!.hits.length, 13)
  assert.equal(view.sections[2]!.total, 13)
  assert.equal(view.total, 16)
  assert.equal(view.sections[2]!.hits[0]!.row.paneId, 'viewed')
  const ids = view.sections.flatMap(section => section.hits.map(hit => hit.row.paneId))
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(view.runningCount, 1)
  assert.equal(view.unreadCount, 2)
})

test('search flattens activity into title-ranked results and keeps global activity counts', () => {
  const rows = [chat('history', 'Browser', 1),
    { ...chat('running', 'Investigate browser memory', 100), running: true },
    chat('finished', 'Finished task', 200)]
  const reviews = { finished: { queuedAt: 200, viewedAt: null } }
  const view = chatSearchView(rows, 'browser', reviews)
  const one = chatSearchView(rows, 'browser', reviews, { query: 1 })
  assert.equal(one.sections[0]!.hits.length, 1)
  assert.equal(one.sections[0]!.total, 2)
  assert.equal(one.total, 2)
  assert.deepEqual(view.sections.map(section => section.label), ['Earlier'])
  assert.deepEqual(view.sections[0]!.hits.map(hit => [hit.row.paneId, hit.status]),
    [['running', 'running'], ['history', 'closed']])
  assert.equal(view.runningCount, 1)
  assert.equal(view.unreadCount, 1)
  assert.deepEqual(chatSearchView(rows, 'zzzzz', reviews).sections, [])
  assert.equal(chatSearchView(rows, 'zzzzz', reviews).unreadCount, 1)
})

test('paused chats stay visible outside bounded history and are not unread completions', () => {
  const paused = { ...chat('paused', 'Paused task', 1), attached: true, paused: true }
  const rows = [paused, ...Array.from({ length: 12 }, (_, i) => chat(`old-${i}`, 'History', 100 + i))]
  const reviews = { paused: { queuedAt: 100, viewedAt: null } }
  const view = chatSearchView(rows, '', reviews)
  assert.deepEqual(view.sections.map(section => section.label), ['Paused', 'Earlier'])
  assert.equal(view.sections[0]!.hits[0]!.row.paneId, 'paused')
  assert.equal(view.runningCount, 0)
  assert.equal(view.unreadCount, 0)
  assert.equal(chatSearchView(rows, 'paused', reviews).sections[0]!.hits[0]!.status, 'paused')
  assert.equal(chatSearchView([{ ...paused, running: true, paused: false }], '', {}).sections[0]!.label, 'Running')
})

test('opening a completion moves it into history and empty sections disappear', () => {
  const rows = [chat('finished', 'Finished task')]
  assert.deepEqual(chatSearchView(rows, '', { finished: { queuedAt: 1, viewedAt: null } })
    .sections.map(section => section.label), ['Recently completed'])
  const viewed = chatSearchView(rows, '', { finished: { queuedAt: 1, viewedAt: 2 } })
  assert.deepEqual(viewed.sections.map(section => section.label), ['Earlier'])
  assert.equal(viewed.unreadCount, 0)
  assert.deepEqual(chatSearchView([], '', {}).sections, [])
})

test('a tab close marks a completion reviewed the same way opening it does', () => {
  const rows = [{ ...chat('finished', 'Finished task', 5), attached: false }]
  const unread = chatSearchView(rows, '', { finished: { queuedAt: 1, viewedAt: null } })
  assert.deepEqual(unread.sections.map(section => section.label), ['Recently completed'])
  const reviewed = chatSearchView(rows, '', { finished: { queuedAt: 1, viewedAt: 50 } })
  assert.deepEqual(reviewed.sections.map(section => section.label), ['Earlier'])
  assert.equal(reviewed.unreadCount, 0)
})

test('open tabs stay out of recency history and closed chats sort by last turn, not store touch', () => {
  const open = { ...chat('open', 'Still open', 500), attached: true, lastTurnEndedAt: 50 }
  const touched = { ...chat('touched', 'Touched later', 400), lastTurnEndedAt: 10 }
  const recentTurn = { ...chat('recent-turn', 'Older store row', 20), lastTurnEndedAt: 300 }
  const view = chatSearchView([open, touched, recentTurn], '', {})
  assert.deepEqual(view.sections.map(section => section.label), ['Open', 'Earlier'])
  assert.deepEqual(view.sections[0]!.hits.map(hit => hit.row.paneId), ['open'])
  assert.deepEqual(view.sections[1]!.hits.map(hit => hit.row.paneId), ['recent-turn', 'touched'])
})

test('row meta names closed chats and uses last-turn time', () => {
  const closed = chatSearchView([{ ...chat('old', 'Prior work', 10), lastTurnEndedAt: 80 }], '', {})
    .sections[0]!.hits[0]!
  assert.equal(closed.status, 'closed')
  assert.equal(chatSearchMeta(closed, () => '2h ago'), 'app · Closed · 2h ago')
  const open = chatSearchView([{ ...chat('live', 'Current tab', 10), attached: true }], '', {})
    .sections[0]!.hits[0]!
  assert.equal(chatSearchMeta(open, () => 'Just now'), 'app · Open · Just now')
})

test('thread search bounds closed history while live groups and older search remain complete', () => {
  const rows = [
    ...Array.from({ length: REST_CLOSED_LIMIT + 30 }, (_, i) => chat(`closed-${i}`, 'Closed', 1000 + i)),
    ...Array.from({ length: 25 }, (_, i) => ({ ...chat(`open-${i}`, 'Open', i), attached: true })),
    { ...chat('running', 'Running', 1), running: true }
  ]
  const view = chatSearchView(rows, '', {})
  const earlier = view.sections.find(section => section.label === 'Earlier')!
  assert.equal(earlier.hits.length, REST_CLOSED_LIMIT)
  assert.equal(earlier.total, REST_CLOSED_LIMIT + 30)
  assert.equal(view.sections.find(section => section.label === 'Open')!.hits.length, 25)
  assert.equal(view.total, rows.length)
  assert.equal(rankChats(rows, 'closed').length, REST_CLOSED_LIMIT + 30)
  assert.equal(chatSearchView(rows, 'closed', {}, { query: 40 }).sections[0]!.hits.length, 40)
})

test('activity grouping still windows Closed for legacy surfaces', () => {
  const rows = Array.from({ length: REST_CLOSED_LIMIT + 5 }, (_, i) => chat(`closed-${i}`, 'Closed', 1000 + i))
  const closed = chatSearchView(rows, '', {}, { grouping: 'activity' }).sections.find(section => section.label === 'Closed')!
  assert.equal(closed.hits.length, REST_CLOSED_LIMIT)
  assert.equal(closed.total, REST_CLOSED_LIMIT + 5)
})

test('thread recency groups decay by day buckets', () => {
  const now = 1_700_000_000_000
  assert.equal(threadRecencyGroup(now - MS_DAY / 2, now), 'Today')
  assert.equal(threadRecencyGroup(now - MS_DAY * 1.5, now), 'Yesterday')
  assert.equal(threadRecencyGroup(now - MS_DAY * 5, now), 'Earlier')
  const pinned = { ...chat('pin', 'Pinned', now - MS_DAY * 10), pinnedAt: now }
  const view = chatSearchView([pinned, chat('today', 'Today chat', now - 1000)], '', {}, { now })
  assert.deepEqual(view.sections.map(section => section.label), ['Pinned', 'Today'])
})

test('the footer says how much of history is listed and how to reach the rest', () => {
  assert.equal(chatSearchFooter(1, 1, false), '1 chat')
  assert.equal(chatSearchFooter(3, 3, false), '3 chats')
  assert.equal(chatSearchFooter(1, 1, true), '1 match')
  assert.equal(chatSearchFooter(24, 850, false), '24 of 850 chats · type to search older')
  assert.equal(chatSearchFooter(40, 120, true), '40 of 120 matches')
})
