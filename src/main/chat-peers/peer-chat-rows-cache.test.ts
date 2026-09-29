import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatPeerSummary, ChatRowSummary } from '../../shared/chat-peers.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { PeerChatRowsCache } from './peer-chat-rows-cache.js'
import { peerManagerChatRows, type PeerManagerSupportHost } from './peer-manager-support.js'
import { rowSummary } from './peer-events.js'

const seed = { cwd: '/w', projectPath: '/w', provider: 'codex' as const, modelId: 'gpt', reasoningEffort: null }

function stubHost(store: ChatStore, attached: Set<string>, liveById: Map<string, ChatPeerSummary | null>): PeerManagerSupportHost {
  return {
    lifecycle: {
      ids: () => [...attached],
      get: (id: string) => liveById.has(id) ? { display: { current: liveById.get(id)! } } : undefined
    } as PeerManagerSupportHost['lifecycle'],
    store,
    projectChanges: { selection: () => null } as unknown as PeerManagerSupportHost['projectChanges'],
    settings: { get: () => ({}) } as unknown as PeerManagerSupportHost['settings'],
    projectSwitch: {} as unknown as PeerManagerSupportHost['projectSwitch'],
    transcripts: {} as unknown as PeerManagerSupportHost['transcripts'],
    parking: {} as unknown as PeerManagerSupportHost['parking'],
    catalog: {} as unknown as PeerManagerSupportHost['catalog'],
    chatsEmit: {} as unknown as PeerManagerSupportHost['chatsEmit'],
    browserAssignmentIdle: null,
    paneOperations: new Map(),
    selectedPaneId: () => [...attached][0] ?? 'none',
    visiblePaneIds: () => new Set(),
    retainedTabIds: () => new Set(),
    stopped: () => false,
    emitWorkspaceEvent: () => {}
  }
}

test('PeerChatRowsCache reuses detached rows while only attached previews change', () => {
  const store = ChatStore.inMemory()
  const attached = store.create({ ...seed, title: 'Live', titleSource: 'generated', codexThreadId: 'live', messageSentAt: 1 })
  const detached = store.create({
    ...seed,
    title: 'Old',
    titleSource: 'generated',
    codexThreadId: 'old',
    updatedAt: 1,
    messageSentAt: 1
  })
  const attachedIds = new Set([attached.id])
  const live = new Map<string, ChatPeerSummary | null>([[attached.id, rowSummary(attached, null) as unknown as ChatPeerSummary]])
  const host = stubHost(store, attachedIds, live)
  const cache = new PeerChatRowsCache()
  host.chatRowsCache = cache

  const firstDetachedPreview = cache.rows(host).find((row) => row.paneId === detached.id)?.preview
  live.set(attached.id, { ...live.get(attached.id)!, preview: 'streaming', updatedAt: 99 } as ChatPeerSummary)
  const secondDetachedPreview = cache.rows(host).find((row) => row.paneId === detached.id)?.preview
  assert.equal(firstDetachedPreview, secondDetachedPreview)

  store.update(detached.id, { preview: 'history moved', updatedAt: 50 })
  cache.invalidateDetached()
  const thirdDetachedPreview = cache.rows(host).find((row) => row.paneId === detached.id)?.preview
  assert.equal(thirdDetachedPreview, 'history moved')
})

test('PeerChatRowsCache matches uncached peerManagerChatRows', () => {
  const store = ChatStore.inMemory()
  const attached = store.create({ ...seed, title: 'A', titleSource: 'generated', codexThreadId: 'a', messageSentAt: 1 })
  store.create({ ...seed, title: 'B', titleSource: 'generated', codexThreadId: 'b', updatedAt: 2, messageSentAt: 1 })
  const live = new Map([[attached.id, rowSummary(attached, null) as unknown as ChatPeerSummary]])
  const host = stubHost(store, new Set([attached.id]), live)
  host.chatRowsCache = new PeerChatRowsCache()
  const cached = peerManagerChatRows(host)
  delete host.chatRowsCache
  const direct = peerManagerChatRows(host)
  assert.deepEqual(cached.map(rowKey), direct.map(rowKey))
})

function rowKey(row: ChatRowSummary): string {
  return `${row.paneId}:${row.updatedAt}:${row.preview}:${row.attached}`
}
