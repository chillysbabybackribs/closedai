import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatPeerSummary, PeerChatReadOptions } from '../../../shared/chat-peers.js'
import { PEER_READ_DEFAULT_CHARS } from '../../../shared/chat-peers.js'
import { ToolRegistry } from '../registry.js'
import { peerChatTools, type PeerChatDirectory } from './index.js'

const peer: ChatPeerSummary = {
  paneId: 'peer-b',
  parentPaneId: null,
  kind: 'peer',
  provider: 'codex',
  modelId: 'gpt-5.6-sol',
  threadId: 'thread-b',
  title: 'Research',
  preview: 'working',
  running: true,
  activity: 'Searching',
  updatedAt: 10
}

const directory: PeerChatDirectory = {
  listReadable: (caller) => caller === 'peer-b' ? [] : [peer],
  readReadable: (chatId, caller, options) => {
    if (chatId !== peer.paneId || caller === peer.paneId) return null
    lastOptions = options
    const all = [
      { type: 'user' as const, id: 'u', turnId: 't', text: 'Investigate peers' },
      { type: 'assistant' as const, id: 'a', turnId: 't', text: 'Working', phase: 'commentary' as const, streaming: true }
    ]
    const items = options.order === 'oldest'
      ? all.slice(options.cursor, options.cursor + options.limit)
      : all.slice(Math.max(0, all.length - options.cursor - options.limit), all.length - options.cursor)
    return { ...peer, items, totalItems: all.length, nextCursor: options.cursor + items.length < 2 ? options.cursor + items.length : null }
  }
}

let lastOptions: PeerChatReadOptions | null = null

function text(result: Awaited<ReturnType<ToolRegistry['call']>>): string {
  return result.content[0]?.type === 'text' ? result.content[0].text : ''
}

test('peer reads exclude the caller; memory read and write are separate tools', async () => {
  const registry = new ToolRegistry([peerChatTools(() => directory)])
  assert.deepEqual(registry.names(), ['peer_chats.list', 'peer_chats.read', 'peer_chats.recall', 'peer_chats.checkpoint'])
  const listed = await registry.call(
    { namespace: 'peer_chats', tool: 'list', arguments: {} },
    { paneId: 'peer-a', threadId: null, turnId: null, callId: 'list' }
  )
  assert.equal(JSON.parse(text(listed)).chats[0].paneId, 'peer-b')
  const self = await registry.call(
    { namespace: 'peer_chats', tool: 'list', arguments: {} },
    { paneId: 'peer-b', threadId: null, turnId: null, callId: 'self' }
  )
  assert.deepEqual(JSON.parse(text(self)).chats, [])
})

test('reading a peer is bounded and unknown chats fail clearly', async () => {
  const registry = new ToolRegistry([peerChatTools(() => directory)])
  const read = await registry.call(
    { namespace: 'peer_chats', tool: 'read', arguments: { chat_id: 'peer-b', limit: 1 } },
    { paneId: 'peer-a', threadId: null, turnId: null, callId: 'read' }
  )
  const parsed = JSON.parse(text(read))
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.nextCursor, 1)
  assert.equal(parsed.totalItems, 2)
  // The default page is the live end of the chat, inside a budget the serializer will not have to cut.
  assert.equal(parsed.items[0].id, 'a')
  assert.deepEqual(lastOptions, { cursor: 0, limit: 1, order: 'newest', types: undefined, maxChars: PEER_READ_DEFAULT_CHARS })
  const missing = await registry.call(
    { namespace: 'peer_chats', tool: 'read', arguments: { chat_id: 'gone' } },
    { paneId: 'peer-a', threadId: null, turnId: null, callId: 'missing' }
  )
  assert.equal(missing.isError, true)
  assert.match(text(missing), /Unknown or unavailable/)
})
