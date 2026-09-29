import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { menuItemByKey, recentChatsForStart, searchStartMenu, startPins } from './dock-start-model.ts'
import type { ChatRowSummary } from '../../shared/chat-peers.ts'

describe('startPins', () => {
  it('lists pinned menu rows in tray order', () => {
    const keys = startPins().map((row) => row.key)
    assert.deepEqual(keys, [
      'new-chat', 'search-chats', 'manage-chat-history', 'toggle-browser-pane', 'agents', 'tools', 'settings'
    ])
  })
})

describe('searchStartMenu', () => {
  it('returns nothing without a query', () => {
    assert.deepEqual(searchStartMenu('  '), [])
  })

  it('finds rows across menus', () => {
    const hits = searchStartMenu('devtools')
    assert.ok(hits.some((hit) => hit.row.key === 'toggle-devtools'))
    assert.ok(hits.every((hit) => hit.menu.length > 0))
  })
})

describe('menuItemByKey', () => {
  it('resolves stable menu keys', () => {
    assert.equal(menuItemByKey('new-chat')?.label, 'New chat')
    assert.equal(menuItemByKey('missing'), undefined)
  })
})

describe('recentChatsForStart', () => {
  const row = (paneId: string, patch: Partial<ChatRowSummary> = {}): ChatRowSummary => ({
    paneId,
    updatedAt: 1,
    title: paneId,
    preview: 'hello',
    running: false,
    activity: null,
    attached: true,
    pinnedAt: null,
    cwd: '/projects/app',
    kind: 'peer',
    parentPaneId: null,
    provider: 'codex',
    modelId: null,
    threadId: 'thread',
    createdAt: 1,
    lastTurnEndedAt: null,
    ...patch
  })

  it('sorts by last activity descending', () => {
    assert.deepEqual(
      recentChatsForStart([row('b', { updatedAt: 2 }), row('a', { updatedAt: 5, lastTurnEndedAt: 5 })], 2)
        .map((hit) => hit.row.paneId),
      ['a', 'b']
    )
  })

  it('omits blank detached chats', () => {
    assert.deepEqual(recentChatsForStart([
      row('keep'),
      row('skip', { preview: '', threadId: null, attached: false })
    ]).map((hit) => hit.row.paneId), ['keep'])
  })
})
