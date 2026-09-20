import assert from 'node:assert/strict'
import test from 'node:test'
import { PeerLifecycle } from './peer-lifecycle.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { chatRecord } from './peer-manager-harness.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { ChatSurface } from '../chat-hub.js'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { PeerIdleParking } from './peer-idle-parking.js'
import type { AppSettingsAccess } from '../app-settings-store.js'

function fakeSurface(overrides: { activeTurnId?: string | null; runningBackground?: boolean } = {}): ChatSurface {
  return {
    snapshot: () => ({ activeTurnId: overrides.activeTurnId ?? null, items: [] } as unknown as ChatSnapshot),
    hasRunningBackground: () => overrides.runningBackground ?? false,
    start: async () => {},
    stop: () => {},
    dispose: () => {},
    send: async () => {},
    interrupt: async () => {},
    selectModel: async () => {},
    selectReasoningEffort: async () => {},
    refreshPlanUsage: async () => {},
    listThreads: async () => [],
    readThread: async () => ({ threadId: '1', threadName: null, items: [] }),
    newThread: async () => {},
    continueInNewThread: async () => {},
    openThread: async () => {},
    archiveThread: async () => {},
    compactConversation: async () => {},
    beginLogin: async () => null,
    on: () => {}
  }
}

function makeLifecycle(initialRecords: ChatRecord[] = []): { lifecycle: PeerLifecycle; store: ChatStore; surfaces: Map<string, ChatSurface> } {
  const surfaces = new Map<string, ChatSurface>()
  const store = ChatStore.inMemory(initialRecords)
  const settings: Partial<AppSettingsAccess> = {
    get: () => ({ chatModelId: 'gpt' } as any),
    set: async () => ({} as any)
  }
  const parking: Partial<PeerIdleParking> = {
    schedule: () => {},
    cancel: () => {},
    stop: () => {}
  }
  const factory = (_settings: any, record: ChatRecord) => {
    const surface = surfaces.get(record.id) ?? fakeSurface()
    surfaces.set(record.id, surface)
    return surface
  }

  const lifecycle = new PeerLifecycle(
    store,
    settings as AppSettingsAccess,
    factory,
    parking as PeerIdleParking,
    () => {},
    () => {}
  )
  return { lifecycle, store, surfaces }
}

test('isRunning returns true if activeTurnId is present or background tasks are active', () => {
  const rec1 = chatRecord('chat-turn', 'gpt', { title: 'T' })
  const rec2 = chatRecord('chat-bg', 'gpt', { title: 'B' })
  const rec3 = chatRecord('chat-idle', 'gpt', { title: 'I' })

  const { lifecycle, surfaces } = makeLifecycle([rec1, rec2, rec3])

  surfaces.set(rec1.id, fakeSurface({ activeTurnId: 'turn-123', runningBackground: false }))
  surfaces.set(rec2.id, fakeSurface({ activeTurnId: null, runningBackground: true }))
  surfaces.set(rec3.id, fakeSurface({ activeTurnId: null, runningBackground: false }))

  lifecycle.attach(rec1)
  lifecycle.attach(rec2)
  lifecycle.attach(rec3)

  assert.equal(lifecycle.isRunning('chat-turn'), true)
  assert.equal(lifecycle.isRunning('chat-bg'), true)
  assert.equal(lifecycle.isRunning('chat-idle'), false)
})

test('trim protects chats with active background tasks from being detached', () => {
  const initialRecords = Array.from({ length: 10 }, (_, i) => chatRecord(`chat-${i}`, 'gpt', { title: `Title ${i}`, updatedAt: i }))
  const { lifecycle, surfaces } = makeLifecycle(initialRecords)

  for (let i = 0; i < 10; i++) {
    const id = `chat-${i}`
    // chat-2 has background tasks running
    const bg = i === 2
    surfaces.set(id, fakeSurface({ activeTurnId: null, runningBackground: bg }))
    lifecycle.attach(initialRecords[i]!)
  }

  // Trim attached down to 5
  const detached = lifecycle.trim(['chat-9'], 5)
  // chat-2 must NOT be in detached
  assert.equal(detached.includes('chat-2'), false, 'chat with running background tasks must remain attached')
  assert.equal(lifecycle.peers.has('chat-2'), true)
})
