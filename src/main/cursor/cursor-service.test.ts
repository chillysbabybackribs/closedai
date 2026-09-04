import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import type { CursorSession } from './cursor-session.js'
import type { CursorToolBridge } from './cursor-mcp.js'

// These startup tests never touch images; the Electron-only import is unavailable in Node.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'electron'
      ? { url: 'data:text/javascript,export const nativeImage = {}', shortCircuit: true }
      : next(specifier, context)
  }
})
const { CursorChatService } = await import('./cursor-service.js')
hooks.deregister()

test('cold catalog startup loads saved history once and obtains its models from that replay', async () => {
  let saved = { ...DEFAULT_APP_SETTINGS, chatCursorSessionId: 'saved' }
  const service = new CursorChatService('/workspace', {
    get: () => saved,
    set: async (patch) => { saved = { ...saved, ...patch }; return saved }
  }, { servers: () => [] } as unknown as CursorToolBridge, '/unused')
  const session = (service as unknown as { createSession(): CursorSession }).createSession()
  const loads: string[] = []
  Object.assign(session, { client: {
    connected: true,
    capabilities: { loadSession: true, image: true },
    async loadSession(sessionId: string) {
      loads.push(sessionId)
      const update = (session as unknown as { onUpdate(params: unknown): void }).onUpdate.bind(session)
      update({ sessionId, update: {
        sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Earlier question' }
      } })
      update({ sessionId, update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Earlier answer' }
      } })
      return {
        sessionId, models: [{ modelId: 'default[]', name: 'Auto' }], modes: [],
        currentModelId: 'default[]', currentModeId: null
      }
    }
  } })
  Object.assign(service, { session, readAccount: async () => {}, refreshPlanUsage: async () => {} })

  await service.start({ warm: true })
  const snapshot = service.snapshot()
  assert.equal(snapshot.connection.state, 'ready')
  assert.deepEqual(loads, ['saved'])
  assert.equal(snapshot.models.length, 1)
  assert.equal(snapshot.threadId, 'cursor:saved')
  assert.match(JSON.stringify(snapshot.items), /Earlier question/)
  assert.match(JSON.stringify(snapshot.items), /Earlier answer/)
  await session.warm()
  assert.deepEqual(loads, ['saved'])
})
