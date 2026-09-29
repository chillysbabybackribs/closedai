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
  it('sorts by updatedAt descending', () => {
    const row = (paneId: string, updatedAt: number): ChatRowSummary => ({
      paneId, updatedAt, title: paneId, preview: '', running: false, activity: null, attached: true,
      pinnedAt: null, cwd: '/a', kind: 'peer', parentPaneId: null, provider: 'codex', modelId: null, threadId: null,
      createdAt: updatedAt, lastTurnEndedAt: null
    })
    assert.deepEqual(recentChatsForStart([row('b', 2), row('a', 5)], 2).map((chat) => chat.paneId), ['a', 'b'])
  })
})
