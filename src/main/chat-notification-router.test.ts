import assert from 'node:assert/strict'
import test from 'node:test'
import { routeChatNotification, type ChatNotificationTarget } from './chat-notification-router.ts'

function target() {
  const log: unknown[] = []
  const stub: ChatNotificationTarget = {
    activeThreadId: () => 'thread-1',
    activeTurnId: () => null,
    setThreadName: (name) => log.push(['name', name]),
    setTurn: (turnId) => log.push(['turn', turnId]),
    consumeItem: (item, turnId, completed) => log.push(['item', item, turnId, completed]),
    appendDelta: () => {},
    addNotice: (text, tone) => log.push(['notice', text, tone]),
    resolveApproval: () => {},
    refreshSession: () => {},
    noteContextUsage: (usage) => log.push(['usage', usage]),
    contextCompacted: () => log.push(['compacted']),
    emit: () => {}
  }
  return { log, stub }
}

test('token usage updates reach the compactor and other threads are ignored', () => {
  const { log, stub } = target()
  const tokenUsage = { last: { totalTokens: 20_000, reasoningOutputTokens: 500 }, modelContextWindow: 100_000 }
  routeChatNotification({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', tokenUsage } }, stub)
  routeChatNotification({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-2', tokenUsage } }, stub)
  assert.deepEqual(log, [['usage', { usedTokens: 19_500, contextWindow: 100_000 }]])
})

test('compaction is reported by its notification or by the completed compaction item', () => {
  const { log, stub } = target()
  routeChatNotification({ method: 'thread/compacted', params: { threadId: 'thread-1' } }, stub)
  const item = { type: 'contextCompaction', id: 'c1' }
  routeChatNotification({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 't1', item } }, stub)
  assert.deepEqual(log, [['compacted'], ['item', item, 't1', true], ['compacted']])
})
