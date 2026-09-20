import assert from 'node:assert/strict'
import test from 'node:test'
import { PeerLifecycle, MAX_ATTACHED_CHATS } from './peer-lifecycle.js'
import type { ChatStore } from '../chat-store/chat-store.js'
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

function makeLifecycle(): { lifecycle: PeerLifecycle; records: Map<string, ChatRecord>; surfaces: Map<string, ChatSurface> } {
  const records = new Map<string, ChatRecord>()
  const surfaces = new Map<string, ChatSurface>()
  const store: Partial<ChatStore> = {
    get: (id: string) => records.get(id),
    update: () => {},
    remove: (id: string) => { records.delete(id) }
  }
  const settings: Partial<AppSettingsAccess> = {
    get: () => ({} as any),
    set: async () => {}
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
    store as ChatStore,
    settings as AppSettingsAccess,
    factory,
    parking as PeerIdleParking,
    () => {},
    () => {}
  )
  return { lifecycle, records, surfaces }
}

test('isRunning returns true if activeTurnId is present or background tasks are active', () => {
  const { lifecycle, records, surfaces } = makeLifecycle()

  const rec1: ChatRecord = { id: 'chat-turn', cwd: '/w', modelId: 'm', threadId: 't1', title: 'T', preview: '', createdAt: 1, updatedAt: 1 }
  const rec2: ChatRecord = { id: 'chat-bg', cwd: '/w', modelId: 'm', threadId: 't2', title: 'B', preview: '', createdAt: 2, updatedAt: 2 }
  const rec3: ChatRecord = { id: 'chat-idle', cwd: '/w', modelId: 'm', threadId: 't3', title: 'I', preview: '', createdAt: 3, updatedAt: 3 }

  records.set(rec1.id, rec1)
  records.set(rec2.id, rec2)
  records.set(rec3.id, rec3)

  surfaces.set(rec1.id, fakeSurface({ activeTurnId: 'turn-123', runningBackground: false }))
  surfaces.set(rec2.id, fakeSurface({ activeTurnId: null, runningBackground: true }))
  surfaces.set(rec3.id, fakeSurface({ activeTurnId: null, runningBackground: false }))

  lifecycle.attach(rec1.id)
  lifecycle.attach(rec2.id)
  lifecycle.attach(rec3.id)

  assert.equal(lifecycle.isRunning('chat-turn'), true)
  assert.equal(lifecycle.isRunning('chat-bg'), true)
  assert.equal(lifecycle.isRunning('chat-idle'), false)
})

test('trim protects chats with active background tasks from being detached', () => {
  const { lifecycle, records, surfaces } = makeLifecycle()

  for (let i = 0; i < 10; i++) {
    const id = `chat-${i}`
    const rec: ChatRecord = { id, cwd: '/w', modelId: 'm', threadId: `t${i}`, title: `Title ${i}`, preview: '', createdAt: i, updatedAt: i }
    records.set(id, rec)
    // chat-2 has background tasks running
    const bg = i === 2
    surfaces.set(id, fakeSurface({ activeTurnId: null, runningBackground: bg }))
    lifecycle.attach(id)
  }

  // Trim attached down to 5
  const detached = lifecycle.trim(['chat-9'], 5)
  // chat-2 must NOT be in detached
  assert.equal(detached.includes('chat-2'), false, 'chat with running background tasks must remain attached')
  assert.equal(lifecycle.has('chat-2'), true)
})
