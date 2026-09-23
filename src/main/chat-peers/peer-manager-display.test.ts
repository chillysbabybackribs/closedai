import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatEvent } from '../../shared/chat.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { ChatTranscriptCache } from '../chat-store/chat-transcript-cache.js'
import { chatRecord, harness, harnessWith } from './peer-manager-harness.js'
import { rendererChatForwarder } from './peer-events.js'

test('first completed exchange names sidebar, renderer and history; later provider names cannot overwrite it', async () => {
  const { manager, surfaces, store } = harnessWith([
    chatRecord('pane-a', 'gpt', { codexThreadId: 'thread', threadId: 'thread' })
  ], 'pane-a')
  const surface = surfaces[0]!
  Object.assign(surface, { generateTitle: async () => 'Clickable Local File Previews' })
  const titles: string[] = []
  manager.on('event', (event: ChatWorkspaceEvent) => {
    if (event.type === 'pane' && event.event.type === 'title') titles.push(event.event.title)
  })
  surface.state.threadId = 'thread'
  surface.state.items = [
    { type: 'user', id: 'u', turnId: 't', text: 'can you add file previews' },
    { type: 'assistant', id: 'a', turnId: 't', text: 'Added file previews.', phase: 'final_answer', streaming: false }
  ]
  surface.state.activeTurnId = 't'
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  surface.state.activeTurnId = null
  surface.emit('event', { type: 'turn', turnId: null } satisfies ChatEvent)
  const activity = manager.snapshot().chats[0]!.updatedAt
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store.require('pane-a').titleSource, 'generated')
  assert.equal(titles.at(-1), 'Clickable Local File Previews')
  assert.equal(manager.snapshot().chats[0]!.title, 'Clickable Local File Previews')
  assert.equal(manager.snapshot().chats[0]!.updatedAt, activity)
  store.adopt('/workspace', '/workspace', { id: 'thread', title: 'Provider fallback', preview: '', createdAt: 1, updatedAt: 1 }, null)
  surface.emit('event', { type: 'thread', threadId: 'thread', threadName: 'Provider fallback' } satisfies ChatEvent)
  assert.equal(titles.at(-1), 'Clickable Local File Previews')
  assert.equal(manager.snapshot({ limit: 200 }).selected.displayTitle, 'Clickable Local File Previews')
  assert.equal((await manager.listThreads())[0]?.title, 'Clickable Local File Previews')
  manager.stop()
})

test('IPC skips background streams while main observers retain them and selection restores current text', async () => {
  const { manager, surfaces } = harnessWith([
    chatRecord('pane-a', 'gpt'), chatRecord('pane-b', 'gpt')
  ], 'pane-a')
  const observed: ChatWorkspaceEvent[] = []
  const delivered: ChatWorkspaceEvent[] = []
  const forward = rendererChatForwarder('pane-a', (event) => delivered.push(event))
  manager.on('event', (event: ChatWorkspaceEvent) => { observed.push(event); forward(event) })
  const background = surfaces[1]!
  const item = { type: 'assistant' as const, id: 'answer', turnId: 't', text: 'hello', phase: null, streaming: true }
  background.state.items = [item]
  background.emit('event', { type: 'item', item } satisfies ChatEvent)
  item.text += ' world'
  background.emit('event', { type: 'itemDelta', itemId: item.id, field: 'text', delta: ' world' } satisfies ChatEvent)
  assert.equal(observed.filter((event) => event.type === 'pane' && event.paneId === 'pane-b' &&
    (event.event.type === 'item' || event.event.type === 'itemDelta')).length, 2)
  assert.equal(delivered.filter((event) => event.type === 'pane' && event.paneId === 'pane-b').length, 0)
  assert.ok(delivered.some((event) => event.type === 'chats'))
  assert.equal(manager.snapshot().chats.find((chat) => chat.paneId === 'pane-b')?.preview, 'hello world')

  await manager.selectPane('pane-b')
  const selected = delivered.find((event) => event.type === 'workspace' && event.snapshot.selectedPaneId === 'pane-b')
  assert.ok(selected?.type === 'workspace')
  assert.equal(selected.snapshot.selected.items[0]?.type === 'assistant' && selected.snapshot.selected.items[0].text, 'hello world')
  delivered.length = 0
  background.emit('event', { type: 'itemDelta', itemId: item.id, field: 'text', delta: '!' } satisfies ChatEvent)
  surfaces[0]!.emit('event', { type: 'itemDelta', itemId: 'old', field: 'text', delta: 'hidden' } satisfies ChatEvent)
  const chunks = delivered.filter((event) => event.type === 'pane')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]?.type === 'pane' && chunks[0].paneId, 'pane-b')
  manager.stop()
})

// How a pane describes itself to the drawer: titles, persisted display fields, bounded summaries.

test('a pane persists its title and activity time so a parked pane keeps its name after relaunch', async () => {
  const { manager, surfaces, store } = harness()
  const surface = surfaces[0]!
  surface.state.items = [{ type: 'user', id: 'u1', turnId: 't1', text: 'Fix the sidebar' }]
  surface.emit('event', { type: 'item', item: surface.state.items[0]! } satisfies ChatEvent)
  await new Promise((resolve) => setImmediate(resolve))

  const record = store.require('pane-a')
  assert.equal(record.title, 'Fix the sidebar')
  assert.ok(record.updatedAt > 1)
  assert.equal(manager.snapshot().chats[0]!.title, 'Fix the sidebar')
})

test('streaming pane events update the drawer without cloning the transcript', () => {
  const { manager, surfaces } = harness()
  const surface = surfaces[0]!
  surface.state.items = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'A long request' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Answer so far', phase: null, streaming: true }
  ]
  const before = surface.snapshotCalls
  surface.emit('event', { type: 'item', item: surface.state.items[1]! } satisfies ChatEvent)
  surface.emit('event', { type: 'itemDelta', itemId: 'a1', field: 'text', delta: ' and more' } satisfies ChatEvent)
  assert.equal(surface.snapshotCalls, before)
  assert.equal(manager.snapshot().chats[0]!.preview, 'Answer so far and more')
  assert.equal(surface.snapshotCalls, before + 1)
})

test('renderer replacement and page requests are bounded while peer reads keep history', async () => {
  const { manager, surfaces } = harness()
  const surface = surfaces[0]!
  surface.state.items = Array.from({ length: 500 }, (_, i) => ({ type: 'user', id: `u${i}`, turnId: null, text: `message ${i}` }))
  const events: ChatWorkspaceEvent[] = []
  manager.on('event', (event: ChatWorkspaceEvent) => events.push(event))
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  const replacement = events.find((event) => event.type === 'pane' && event.event.type === 'replace')
  assert.ok(replacement?.type === 'pane' && replacement.event.type === 'replace')
  assert.equal(replacement.event.snapshot.items.length, 1)
  assert.equal(replacement.event.snapshot.items[0]?.id, 'u499')
  assert.equal(manager.snapshot({ limit: 200 }).selected.items.length, 1)
  assert.equal(manager.paneSnapshot('pane-a')!.items.length, 500)
  assert.equal((await manager.readHistoryPage('pane-a', null, 'u300')).items[0]?.id, 'u299')
  await assert.rejects(() => manager.readHistoryPage('pane-a', 'another-thread', 'u300'), /chat changed/)
  manager.stop()
})

test('leaving a chat clears the saved title so a parked pane does not wear the old name', async () => {
  const { manager, surfaces, store } = harness()
  const surface = surfaces[0]!
  surface.state.threadId = 'thread-1'
  surface.state.items = [{ type: 'user', id: 'u1', turnId: 't1', text: 'Fix the sidebar' }]
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  surface.emit('event', { type: 'turn', turnId: null } satisfies ChatEvent)
  await new Promise((resolve) => setImmediate(resolve))
  store.update('pane-a', { codexThreadId: 'thread-1' })
  assert.equal(store.require('pane-a').title, 'Fix the sidebar')

  // A new chat: the provider clears its thread in settings, then replays an empty pane.
  store.update('pane-a', { codexThreadId: null })
  surface.state.threadId = null
  surface.state.items = []
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(manager.snapshot().chats[0]!.title, 'New chat')
  assert.equal(manager.snapshot().chats[0]!.threadId, null)
})

test('a wake that replays through an empty snapshot does not rename a chat that has a thread', async () => {
  const { manager, surfaces, store } = harnessWith([
    chatRecord('pane-a', 'gpt', { codexThreadId: 'thread-1', threadId: 'thread-1', title: 'Fix the sidebar' })
  ], 'pane-a')
  const surface = surfaces[0]!
  // The provider's first replace, before its store has been read, holds nothing yet.
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(store.require('pane-a').title, 'Fix the sidebar')
  assert.equal(manager.snapshot().chats[0]!.title, 'Fix the sidebar')
})

test('a persisted pane that has not been woken still shows its saved title and thread', () => {
  const { manager } = harnessWith([
    chatRecord('pane-cold', 'claude:opus', {
      provider: 'claude', claudeSessionId: 's1', threadId: 'claude:s1', title: 'Agent sidebar bugs', updatedAt: 1234
    })
  ], 'pane-cold')
  const [peer] = manager.snapshot().chats
  assert.equal(peer!.title, 'Agent sidebar bugs')
  assert.equal(peer!.threadId, 'claude:s1')
  assert.equal(peer!.updatedAt, 1234)
  assert.equal(peer!.attached, true)
})

test('a chat opens on its saved view and hands over to the provider replay', async () => {
  const transcripts = ChatTranscriptCache.inMemory([['pane-b', {
    version: 1,
    threadId: 'thread-b',
    threadName: 'Saved chat',
    items: [{ type: 'user', id: 'saved', turnId: null, text: 'Earlier question' }],
    hasEarlier: true,
    contextUsage: { usedTokens: 2_000, contextWindow: 10_000, percent: 20 },
    updatedAt: 1
  }]])
  const { manager, surfaces } = harnessWith([
    chatRecord('pane-a', 'gpt'),
    chatRecord('pane-b', 'gpt', { codexThreadId: 'thread-b', threadId: 'thread-b', title: 'Saved chat' })
  ], 'pane-a', undefined, ['pane-a'], transcripts)

  await manager.openChat('pane-b')
  const opened = manager.snapshot({ limit: 200 }).selected
  assert.equal(opened.items[0]?.id, 'saved')
  assert.equal(opened.threadId, 'thread-b')
  assert.equal(opened.threadName, 'Saved chat')
  assert.equal(opened.contextUsage?.percent, 20)
  assert.equal(opened.history?.hasEarlier, true)

  // The provider's own transcript wins the moment it lands, and is saved for the next open.
  const surface = surfaces.at(-1)!
  surface.state.threadId = 'thread-b'
  surface.state.items = [{ type: 'user', id: 'live', turnId: 't1', text: 'Earlier question' }]
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  assert.equal(manager.snapshot({ limit: 200 }).selected.items[0]?.id, 'live')
  assert.equal(transcripts.peek('pane-b')?.items[0]?.id, 'live')
})

test('a saved view is left alone once the chat no longer holds that thread', async () => {
  const transcripts = ChatTranscriptCache.inMemory([['pane-b', {
    version: 1,
    threadId: 'thread-old',
    threadName: 'Old chat',
    items: [{ type: 'user', id: 'saved', turnId: null, text: 'Earlier question' }],
    hasEarlier: false,
    contextUsage: null,
    updatedAt: 1
  }]])
  const { manager } = harnessWith([
    chatRecord('pane-a', 'gpt'),
    chatRecord('pane-b', 'gpt', { codexThreadId: 'thread-b', threadId: 'thread-b' })
  ], 'pane-a', undefined, ['pane-a'], transcripts)

  await manager.openChat('pane-b')
  assert.deepEqual(manager.snapshot({ limit: 200 }).selected.items, [])
})

test('a rotated chat paints and saves its last session view while its active thread is released', async () => {
  const transcripts = ChatTranscriptCache.inMemory([['pane-a', {
    version: 1, threadId: 'last-session', threadName: 'Saved conversation',
    items: [{ type: 'user', id: 'saved', turnId: null, text: 'Keep my conversation' }],
    hasEarlier: false, contextUsage: null, updatedAt: 1
  }]])
  const { manager, surfaces, store } = harnessWith([chatRecord('pane-a', 'gpt', {
    continuation: { sourcePaneId: 'pane-a', sourceThreadId: 'first-session', sourceProvider: 'codex',
      sourceTitle: 'Saved conversation', handoff: 'Continue', createdAt: 1 },
    sessionRotations: [{ epoch: 2, providerThreadId: 'last-session', sourceThroughItemId: 'saved', at: 2 }]
  })], 'pane-a', undefined, undefined, transcripts)
  await manager.start()
  assert.equal(manager.snapshot({ limit: 60 }).selected.items[0]?.id, 'saved')
  assert.equal(manager.snapshot().selected.threadId, null)
  surfaces[0]!.state.items = [{ type: 'user', id: 'live', turnId: null, text: 'Retained transcript' }]
  store.update('pane-a', { continuation: null })
  surfaces[0]!.state.items = []
  assert.deepEqual(manager.snapshot({ limit: 60 }).selected.items, [])
  store.update('pane-a', { continuation: { sourcePaneId: 'pane-a', sourceThreadId: 'first-session',
    sourceProvider: 'codex', sourceTitle: 'Saved conversation', handoff: 'Continue', createdAt: 1 } })
  surfaces[0]!.state.items = [{ type: 'user', id: 'live', turnId: null, text: 'Retained transcript' }]
  manager.stop()
  assert.equal(transcripts.peek('pane-a')?.items[0]?.id, 'live')
})
