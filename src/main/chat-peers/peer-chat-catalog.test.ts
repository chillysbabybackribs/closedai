import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChatSurface } from '../chat-hub.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { PeerChatCatalog } from './peer-chat-catalog.js'

const THREADS = [
  { id: 'claude:known', title: 'Renamed by the provider', preview: '', createdAt: 1, updatedAt: 50 },
  { id: 'claude:foreign', title: 'Another account', preview: '', createdAt: 2, updatedAt: 60 }
]

function catalogFor(store: ChatStore): PeerChatCatalog {
  const surface = { listThreads: async () => THREADS } as unknown as ChatSurface
  return new PeerChatCatalog(store, () => ({ cwd: '/work', projectPath: '/work' }), (action) => action(surface))
}

test('the account that owns the original data adopts provider threads', async () => {
  const store = ChatStore.inMemory()
  await catalogFor(store).reconcile()
  assert.deepEqual(store.list('/work', '/work').map((chat) => chat.id).sort(), ['claude:foreign', 'claude:known'])
})

test('another account refreshes its own threads and takes in no others', async () => {
  const store = ChatStore.inMemory()
  store.adopt('/work', '/work', { id: 'claude:known', title: 'Old title', preview: '', createdAt: 1, updatedAt: 10 }, null)
  store.adoptsProviderHistory = false
  await catalogFor(store).reconcile()
  assert.deepEqual(store.list('/work', '/work').map((chat) => chat.id), ['claude:known'])
  assert.equal(store.get('claude:known')?.title, 'Renamed by the provider')
})
