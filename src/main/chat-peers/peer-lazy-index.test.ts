import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { ChatPaneLexicalIndex } from '../chat-store/chat-pane-lexical-index.js'
import { ChatPeerManager } from './peer-manager.js'
import { chatRecord, FakeSurface, MemorySettings, HARNESS_CWD } from './peer-manager-harness.js'

test('pane events are lazy, concurrent searches share backfill, and later events refresh', async (t) => {
  const settings = new MemorySettings({ ...DEFAULT_APP_SETTINGS, chatMemoryIndexEnabled: true,
    chatWorkspacePath: HARNESS_CWD, chatProjectPath: HARNESS_CWD, chatOpenIds: ['a'], chatSelectedPaneId: 'a' })
  const record = chatRecord('a', 'gpt', { threadId: 'live', codexThreadId: 'live',
    continuation: { sourcePaneId: 'a', sourceThreadId: 'old', sourceCwd: HARNESS_CWD,
      checkpoint: null, sourceProvider: 'codex' } })
  const store = ChatStore.inMemory([record])
  const index = ChatPaneLexicalIndex.inMemory(settings.get())
  const surface = new FakeSurface('gpt')
  let reads = 0
  let release!: () => void
  surface.readThread = async () => {
    reads++
    await new Promise<void>((resolve) => { release = resolve })
    return { threadId: 'old', threadName: null, items: [
      { type: 'user', id: 'old-u', turnId: 'old-t', text: 'retired purple tokens' }
    ] }
  }
  const manager = new ChatPeerManager(settings, store, () => surface, undefined, undefined,
    undefined, null, undefined, null, index)
  t.after(() => manager.stop())
  surface.state.items = [{ type: 'user', id: 'new-u', turnId: 'new-t', text: 'live green tokens' }]
  for (let i = 0; i < 30; i++) surface.emit('event', { type: 'replace', snapshot: surface.snapshot() })
  await Promise.resolve()
  assert.equal(reads, 0, 'events must not read retired transcripts')
  assert.equal(index.getRecord('a'), undefined)
  const first = manager.searchIndex('a', { scope: 'chat', query: 'retired purple' })
  const second = manager.searchIndex('a', { scope: 'chat', query: 'live green' })
  assert.equal(reads, 1, 'concurrent searches share the pending refresh')
  release()
  assert.equal((await first).hits[0]?.itemId, 'old-u')
  assert.equal((await second).hits[0]?.itemId, 'new-u')
  assert.ok((await manager.searchIndex('a', { scope: 'chat', query: 'purple' })).hits.length)
  assert.equal(reads, 1, 'unchanged searches reuse the index')
  surface.state.items = [{ type: 'user', id: 'next-u', turnId: 'next-t', text: 'changed orange tokens' }]
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() })
  const next = manager.searchIndex('a', { scope: 'chat', query: 'orange' })
  assert.equal(reads, 2)
  release()
  assert.equal((await next).hits[0]?.itemId, 'next-u')
})
