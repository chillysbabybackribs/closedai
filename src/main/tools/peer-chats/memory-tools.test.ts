import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMemoryCheckpoint } from '../../../shared/chat-memory.js'
import { validateMemoryState } from '../../chat-context/memory-checkpoint.js'
import { ToolRegistry } from '../registry.js'
import { peerChatTools } from './index.js'

const state = { goal: 'Ship memory', constraints: ['Keep history'], decisions: [], progress: [], nextSteps: [], files: [] }
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
      save: async (caller, revision, input) => {
        const normalized = validateMemoryState(input)
        calls.push({ caller, revision, state: normalized })
        return { version: 1, revision: revision + 1, threadId: caller.threadId!, throughItemId: 'u', createdAt: 1, state: normalized } satisfies ChatMemoryCheckpoint
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

test('checkpoint rejects malformed memory and responds with metadata rather than echoing the summary', async () => {
  const h = harness()
  const result = await h.call('checkpoint', { expected_revision: 0, state })
  assert.equal(result.isError, undefined)
  assert.equal(result.content[0]!.type, 'text')
  if (result.content[0]!.type === 'text') {
    assert.equal(JSON.parse(result.content[0]!.text).revision, 1)
    assert.doesNotMatch(result.content[0]!.text, /Keep history/)
  }
  for (const args of [{ state }, { expected_revision: -1, state }, { expected_revision: 0, state: { ...state, constraints: Array(13).fill('x') } }]) {
    assert.equal((await h.call('checkpoint', args)).isError, true)
  }
  assert.equal(h.calls.length, 1)
})

test('history discovery and targeted recall route through the existing namespace', async () => {
  const h = harness()
  assert.equal((await h.call('list', { scope: 'history', query: 'design', cwd: '/older', before_chat_id: 'previous', limit: 2 })).isError, undefined)
  assert.deepEqual(h.calls[0], { caller: { ...context, invocationSource: 'direct' }, request: {
    query: 'design', cwd: '/older', beforeChatId: 'previous', limit: 2
  } })
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
