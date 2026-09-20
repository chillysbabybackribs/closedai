import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import type { ChatEvent } from '../../shared/chat.js'
import type { AntigravityToolBridge } from './antigravity-mcp.js'
import { antigravityModelCatalog } from './antigravity-models.js'

const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'electron'
      ? { url: 'data:text/javascript,export const nativeImage = {}', shortCircuit: true }
      : next(specifier, context)
  }
})
const { AntigravityChatService } = await import('./antigravity-service.js')
hooks.deregister()

function createService(initialSettings: Partial<typeof DEFAULT_APP_SETTINGS> = {}) {
  let saved: typeof DEFAULT_APP_SETTINGS = {
    ...DEFAULT_APP_SETTINGS,
    chatModelId: 'agy:gemini-3.8-flash',
    chatReasoningEffort: 'high',
    ...initialSettings
  }
  const events: ChatEvent[] = []
  const service = new AntigravityChatService('/workspace', {
    get: () => saved,
    set: async (patch) => { saved = { ...saved, ...patch }; return saved },
    checkpoint: () => null,
    sessionRotations: () => saved.chatSessionRotations ?? []
  }, { servers: () => [] } as unknown as AntigravityToolBridge, '/tmp/antigravity-test-state')

  service.on('event', (e: ChatEvent) => events.push(e))
  const catalog = antigravityModelCatalog([
    { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-low', displayName: 'Gemini 3.8 Flash (Low)' },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }
  ], saved.chatModelId, saved.chatReasoningEffort)
  ;(service as unknown as { modelState: { load: (c: typeof catalog) => void } }).modelState.load(catalog)
  return { service, events }
}

test('noteTokenUsage updates contextUsage and emits a context event with capacity calculated from the active model', () => {
  const { service, events } = createService()
  assert.equal(service.snapshot().contextUsage, null)

  const noteTokenUsage = (service as unknown as { noteTokenUsage: (usage: { inputTokens: number; cacheAnomaly: boolean }) => void }).noteTokenUsage.bind(service)

  noteTokenUsage({ inputTokens: 50_000, cacheAnomaly: false })

  assert.deepEqual(service.snapshot().contextUsage, {
    usedTokens: 50_000,
    contextWindow: 1_000_000,
    percent: 5
  })

  const contextEvents = events.filter((e) => e.type === 'context')
  assert.equal(contextEvents.length, 1)
  assert.deepEqual(contextEvents[0], {
    type: 'context',
    usage: { usedTokens: 50_000, contextWindow: 1_000_000, percent: 5 }
  })
})

test('selectModel updates context capacity and re-emits the adjusted usage percentage when contextUsage exists', async () => {
  const { service, events } = createService()
  const noteTokenUsage = (service as unknown as { noteTokenUsage: (usage: { inputTokens: number; cacheAnomaly: boolean }) => void }).noteTokenUsage.bind(service)

  noteTokenUsage({ inputTokens: 50_000, cacheAnomaly: false })
  assert.equal(service.snapshot().contextUsage?.percent, 5)

  // Switch to Claude Sonnet (200k context window)
  await service.selectModel('agy:claude-sonnet-4-6')

  assert.deepEqual(service.snapshot().contextUsage, {
    usedTokens: 50_000,
    contextWindow: 200_000,
    percent: 25
  })

  const contextEvents = events.filter((e) => e.type === 'context')
  assert.equal(contextEvents.length, 2)
  assert.deepEqual(contextEvents[1], {
    type: 'context',
    usage: { usedTokens: 50_000, contextWindow: 200_000, percent: 25 }
  })
})

test('detachThread resets contextUsage to null', async () => {
  const { service } = createService()
  const noteTokenUsage = (service as unknown as { noteTokenUsage: (usage: { inputTokens: number; cacheAnomaly: boolean }) => void }).noteTokenUsage.bind(service)
  const detachThread = (service as unknown as { detachThread: () => Promise<void> }).detachThread.bind(service)

  noteTokenUsage({ inputTokens: 10_000, cacheAnomaly: false })
  assert.notEqual(service.snapshot().contextUsage, null)

  await detachThread()
  assert.equal(service.snapshot().contextUsage, null)
})

test('compactConversation resets contextUsage to null', async () => {
  const { service } = createService({ chatSeamlessRotation: false })
  const noteTokenUsage = (service as unknown as { noteTokenUsage: (usage: { inputTokens: number; cacheAnomaly: boolean }) => void }).noteTokenUsage.bind(service)
  const transcript = (service as unknown as { transcript: { addOptimisticUser: (id: string, text: string) => void } }).transcript

  transcript.addOptimisticUser('u1', 'hello')
  noteTokenUsage({ inputTokens: 10_000, cacheAnomaly: false })
  assert.notEqual(service.snapshot().contextUsage, null)

  await service.compactConversation()
  assert.equal(service.snapshot().contextUsage, null)
})
