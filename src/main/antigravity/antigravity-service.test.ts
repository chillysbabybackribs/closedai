import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import type { ChatEvent } from '../../shared/chat.js'
import type { AntigravityToolBridge } from './antigravity-mcp.js'
import { ToolRegistry } from '../tools/registry.js'
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
  }, new ToolRegistry([]), { servers: () => [], setToolAdvertisement: () => {}, listening: false, start: async () => {}, ensureRegistered: async () => {} } as unknown as AntigravityToolBridge, '/tmp/antigravity-test-state')

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

test('retryOnAuthFailure ignores non-auth errors', () => {
  const { service } = createService()
  const retryOnAuthFailure = (service as unknown as { retryOnAuthFailure: (turnId: string, error: string) => boolean }).retryOnAuthFailure.bind(service)
  assert.equal(retryOnAuthFailure('turn-1', 'Random syntax error'), false)
})

test('retryOnAuthFailure prevents duplicate retry attempts on the same turn', () => {
  const { service } = createService()
  const retryOnAuthFailure = (service as unknown as { retryOnAuthFailure: (turnId: string, error: string) => boolean }).retryOnAuthFailure.bind(service)
  ;(service as unknown as { authRetrying: boolean }).authRetrying = true
  assert.equal(retryOnAuthFailure('turn-1', 'UNAUTHENTICATED (code 401): Request had invalid authentication credentials.'), false)
})


test('retryOnAuthFailure retries once per user turn and still records a turn whose retry fails', async () => {
  const { service } = createService()
  const internals = service as unknown as {
    authRetrying: boolean
    session: { conversationId: string; retire: () => Promise<void> } | null
    history: { saveTranscript: (id: string, items: unknown[]) => Promise<void>; recordThread: (id: string, cwd: string, items: unknown[]) => Promise<void>; threadName: () => Promise<string | null> }
    transcript: { addOptimisticUser: (id: string, text: string) => void }
    retryOnAuthFailure: (turnId: string, error: string) => boolean
  }
  const saved: string[] = []
  internals.history = {
    saveTranscript: async (id) => { saved.push(id) },
    recordThread: async () => {},
    threadName: async () => null
  }
  let retired = 0
  internals.session = { conversationId: 'conv-1', retire: async () => { retired += 1; throw new Error('CLI vanished') } }
  internals.transcript.addOptimisticUser('u1', 'hello')
  const authError = 'UNAUTHENTICATED (code 401): Request had invalid authentication credentials.'

  assert.equal(internals.retryOnAuthFailure('turn-1', authError), true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(retired, 1)
  assert.deepEqual(saved, ['conv-1'], 'the failed turn is persisted when the retry cannot resume it')
  assert.equal(internals.authRetrying, true, 'the retry budget stays spent until the next user turn')

  assert.equal(internals.retryOnAuthFailure('turn-2', authError), false, 'a resumed turn that fails the same way is not retried again')
  assert.equal(retired, 1)
  const failure = service.snapshot().items.find((item) => item.type === 'notice' && item.text === 'CLI vanished')
  assert.ok(failure, 'the retry error is surfaced as a notice')
})
