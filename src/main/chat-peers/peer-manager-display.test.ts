import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatEvent } from '../../shared/chat.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import { ChatPeerManager } from './peer-manager.js'
import { FakeSurface, MemorySettings, harness } from './peer-manager-harness.js'

// How a pane describes itself to the drawer: titles, persisted display fields, bounded summaries.

test('a pane persists its title and activity time so a parked pane keeps its name after relaunch', async () => {
  const { manager, surfaces, settings } = harness()
  const surface = surfaces[0]!
  surface.state.items = [{ type: 'user', id: 'u1', turnId: 't1', text: 'Fix the sidebar' }]
  surface.emit('event', { type: 'item', item: surface.state.items[0]! } satisfies ChatEvent)
  await new Promise((resolve) => setImmediate(resolve))

  const record = settings.get().chatPeers.find((peer) => peer.paneId === 'pane-a')!
  assert.equal(record.title, 'Fix the sidebar')
  assert.ok((record.updatedAt ?? 0) > 0)
  assert.equal(manager.snapshot().peers[0]!.title, 'Fix the sidebar')
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
  assert.equal(manager.snapshot().peers[0]!.preview, 'Answer so far and more')
  assert.equal(surface.snapshotCalls, before + 1)
})

test('renderer replacement and page requests are bounded while peer reads keep history', () => {
  const { manager, surfaces } = harness()
  const surface = surfaces[0]!
  surface.state.items = Array.from({ length: 500 }, (_, i) => ({ type: 'user', id: `u${i}`, turnId: null, text: `message ${i}` }))
  const events: ChatWorkspaceEvent[] = []
  manager.on('event', (event: ChatWorkspaceEvent) => events.push(event))
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  const replacement = events.find((event) => event.type === 'pane' && event.event.type === 'replace')
  assert.ok(replacement?.type === 'pane' && replacement.event.type === 'replace')
  assert.equal(replacement.event.snapshot.items.length, 200)
  assert.equal(replacement.event.snapshot.items[0]?.id, 'u300')
  assert.equal(manager.snapshot({ limit: 200 }).selected.items.length, 200)
  assert.equal(manager.paneSnapshot('pane-a')!.items.length, 500)
  assert.equal(manager.readHistoryPage('pane-a', null, 'u300').items[0]?.id, 'u100')
  assert.throws(() => manager.readHistoryPage('pane-a', 'another-thread', 'u300'), /chat changed/)
  manager.stop()
})

test('leaving a chat clears the saved title so a parked pane does not wear the old name', async () => {
  const { manager, surfaces, settings } = harness()
  const surface = surfaces[0]!
  surface.state.threadId = 'thread-1'
  surface.state.items = [{ type: 'user', id: 'u1', turnId: 't1', text: 'Fix the sidebar' }]
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  surface.emit('event', { type: 'turn', turnId: null } satisfies ChatEvent)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settings.get().chatPeers[0]!.title, 'Fix the sidebar')

  // A new chat: the provider clears its thread in settings, then replays an empty pane.
  const peer = settings.get().chatPeers[0]!
  await settings.set({ chatPeers: [{ ...peer, threadId: null, codexThreadId: null }] })
  surface.state.threadId = null
  surface.state.items = []
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(manager.snapshot().peers[0]!.title, 'New chat')
  assert.equal(manager.snapshot().peers[0]!.threadId, null)
  assert.equal(settings.get().chatPeers[0]!.title, null)
})

test('a persisted pane that has not been woken still shows its saved title and thread', () => {
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: [{
      paneId: 'pane-cold',
      provider: 'claude',
      threadId: 'claude:s1',
      codexThreadId: null,
      claudeSessionId: 's1',
      modelId: 'claude:opus',
      reasoningEffort: null,
      title: 'Agent sidebar bugs',
      updatedAt: 1234
    }],
    chatSelectedPaneId: 'pane-cold'
  })
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => new FakeSurface(modelId))
  const [peer] = manager.snapshot().peers
  assert.equal(peer!.title, 'Agent sidebar bugs')
  assert.equal(peer!.threadId, 'claude:s1')
  assert.equal(peer!.updatedAt, 1234)
})
