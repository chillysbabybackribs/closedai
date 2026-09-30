import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { peerChatTools } from './index.js'

const context = { paneId: 'p', threadId: 'thread', turnId: 't', callId: 'call' }

function harness() {
  const calls: unknown[] = []
  const registry = new ToolRegistry([peerChatTools(() => ({
    listReadable: () => [], readReadable: async () => null,
    memory: {
      history: (caller, request) => {
        calls.push({ caller, request })
        return { chats: [], nextBeforeChatId: null, trust: 'historical-data' }
      },
      recall: async (caller, request) => {
        calls.push({ caller, request })
        return { threadId: caller.threadId!, checkpoint: null, matches: [], hasMore: false,
          nextBeforeItemId: null, throughItemId: null, trust: 'historical-data' }
      },
      spine: async (caller, request) => {
        calls.push({ caller, request })
        return {
          threadId: caller.threadId!,
          title: null,
          cwd: '/w',
          lastActivityAt: 1,
          turns: [],
          hasMore: false,
          nextBeforeUserItemId: null,
          provenance: 'transcript',
          trust: 'historical-data'
        }
      }
    }
  }))])
  const call = (tool: string, args: Record<string, unknown>) => registry.call({ namespace: 'peer_chats', tool, arguments: args }, context)
  return { calls, call }
}

test('recall is scoped by trusted call context, with bounded query and paging arguments', async () => {
  const h = harness()
  const result = await h.call('recall', { scope: 'source', query: 'old decision', limit: 2 })
  assert.equal(result.isError, undefined)
  const recorded = h.calls[0] as { caller: typeof context; request: { scope: string; query: string } }
  assert.equal(recorded.caller.paneId, 'p')
  assert.equal(recorded.request.scope, 'source')
  assert.equal(recorded.request.query, 'old decision')
  for (const args of [{ scope: 'current', pane_id: 'other' }, { scope: 'current', thread_id: 'other' },
    { scope: 'current', query: 'x'.repeat(201) }, { scope: 'current', limit: 100 }, { scope: 'current', offset: 10 }]) {
    assert.equal((await h.call('recall', args)).isError, true)
  }
  assert.equal(h.calls.length, 1)
})

test('history discovery and targeted recall route through the existing namespace', async () => {
  const h = harness()
  assert.equal((await h.call('list', { scope: 'history', query: 'design', cwd: '/older', before_chat_id: 'previous', limit: 2 })).isError, undefined)
  const discovery = h.calls[0] as { caller: typeof context; request: unknown }
  assert.equal(discovery.caller.paneId, context.paneId)
  assert.deepEqual(discovery.request, {
    query: 'design', cwd: '/older', beforeChatId: 'previous', limit: 2
  })
  assert.equal((await h.call('recall', { scope: 'history', chat_id: 'older-chat', query: 'design' })).isError, undefined)
  const recorded = h.calls[1] as { request: { scope: string; chatId: string } }
  assert.equal(recorded.request.scope, 'history')
  assert.equal(recorded.request.chatId, 'older-chat')
  for (const args of [{ scope: 'open', query: 'ignored' }, { scope: 'history', limit: 9 }]) {
    assert.equal((await h.call('list', args)).isError, true)
  }
  assert.equal((await h.call('recall', { scope: 'current', chat_id: 'older-chat' })).isError, true)
  assert.equal(h.calls.length, 2)
})
