import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import type { AcpMcpServer } from './cursor-acp.js'
import type { CursorSession } from './cursor-session.js'
import type { CursorToolBridge } from './cursor-mcp.js'

/**
 * The real bridge serves no endpoints until its listener has a port (`endpoints()` returns `[]`
 * while `port === null`), and the agent is told about tools only when a session opens. This fake
 * keeps that shape so a test can tell "opened with tools" from "opened before the listener".
 */
function toolBridge(): CursorToolBridge & { listening: boolean; starts: number } {
  const bridge = {
    listening: false,
    starts: 0,
    async start() { bridge.starts += 1; bridge.listening = true },
    servers: (key: string): AcpMcpServer[] => bridge.listening
      ? [{ type: 'http', name: 'embedded_browser', url: `http://127.0.0.1:1/mcp/${key}/embedded_browser`, headers: [] }]
      : []
  }
  return bridge as unknown as CursorToolBridge & { listening: boolean; starts: number }
}

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
  let saved: typeof DEFAULT_APP_SETTINGS = { ...DEFAULT_APP_SETTINGS, chatCursorSessionId: 'saved' }
  const service = new CursorChatService('/workspace', {
    get: () => saved,
    set: async (patch) => { saved = { ...saved, ...patch }; return saved },
    checkpoint: () => null,
    sessionRotations: () => saved.chatSessionRotations ?? []
  }, toolBridge(), '/unused')
  const session = (service as unknown as { createSession(): CursorSession }).createSession()
  const loads: string[] = []
  Object.assign(session, { client: {
    connected: true,
    capabilities: { loadSession: true, image: false },
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
        currentModelId: 'default[]', currentModeId: null, modelConfigId: 'model', modeConfigId: 'mode'
      }
    }
  } })
  Object.assign(service, { session, readAccount: async () => {}, refreshPlanUsage: async () => {} })

  await service.start({ warm: true })
  const snapshot = service.snapshot()
  assert.equal(snapshot.connection.state, 'ready')
  assert.deepEqual(loads, ['saved'])
  assert.equal(snapshot.models.length, 1)
  assert.equal((service as unknown as { supportsImages: boolean }).supportsImages, false)
  assert.equal(snapshot.threadId, 'cursor:saved')
  assert.match(JSON.stringify(snapshot.items), /Earlier question/)
  assert.match(JSON.stringify(snapshot.items), /Earlier answer/)
  await session.warm()
  assert.deepEqual(loads, ['saved'])
})

test('a rejected live model change leaves the accepted selection in settings and UI', async () => {
  let saved: typeof DEFAULT_APP_SETTINGS = { ...DEFAULT_APP_SETTINGS, chatCursorSessionId: 'saved' }
  const service = new CursorChatService('/workspace', {
    get: () => saved,
    set: async (patch) => { saved = { ...saved, ...patch }; return saved },
    checkpoint: () => null,
    sessionRotations: () => []
  }, toolBridge(), '/unused')
  const session = (service as unknown as { createSession(): CursorSession }).createSession()
  const target = 'claude-opus-5[thinking=true,effort=high]'
  Object.assign(session, { client: {
    connected: true,
    capabilities: { loadSession: true, image: false },
    async loadSession(sessionId: string) {
      return {
        sessionId,
        models: [{ modelId: 'default[]', name: 'Auto' }, { modelId: target, name: 'Claude Opus 5' }],
        modes: [], currentModelId: 'default[]', currentModeId: null,
        modelConfigId: 'model', modeConfigId: 'mode'
      }
    }
  } })
  Object.assign(service, { session, readAccount: async () => {}, refreshPlanUsage: async () => {} })
  await service.start({ warm: true })
  Object.assign(session, { selectModel: async () => { throw new Error('Invalid params') } })

  await assert.rejects(service.selectModel(`cursor:${target}`), /Invalid params/)

  assert.equal(service.snapshot().selectedModel, 'cursor:default[]')
  assert.notEqual(saved.chatModelId, `cursor:${target}`)
  assert.match(JSON.stringify(service.snapshot().items), /Cursor did not accept that model/)
})

/**
 * The defect this covers: warming a pane opened its ACP session before anything had started the
 * tool bridge, so the agent was handed an empty `mcpServers` list and the session — cached for
 * the life of the pane — ran every later turn with no ClosedAI tools at all, while a pane whose
 * session happened to open during a turn had all of them.
 */
test('a session opens with the ClosedAI tool endpoints, whatever opened it first', async () => {
  let saved: typeof DEFAULT_APP_SETTINGS = { ...DEFAULT_APP_SETTINGS, chatCursorSessionId: 'saved' }
  const bridge = toolBridge()
  const service = new CursorChatService('/workspace', {
    get: () => saved,
    set: async (patch) => { saved = { ...saved, ...patch }; return saved },
    checkpoint: () => null,
    sessionRotations: () => saved.chatSessionRotations ?? []
  }, bridge, '/unused')
  const session = (service as unknown as { createSession(): CursorSession }).createSession()
  const attached: Array<readonly AcpMcpServer[]> = []
  Object.assign(session, { client: {
    connected: true,
    capabilities: { loadSession: true, image: true },
    async loadSession(sessionId: string, _cwd: string, mcpServers: readonly AcpMcpServer[]) {
      attached.push(mcpServers)
      return { sessionId, models: [{ modelId: 'default[]', name: 'Auto' }], modes: [],
        currentModelId: 'default[]', currentModeId: null, modelConfigId: 'model', modeConfigId: 'mode' }
    }
  } })
  Object.assign(service, { session, readAccount: async () => {}, refreshPlanUsage: async () => {} })

  await service.start({ warm: true })

  assert.equal(bridge.listening, true, 'warming starts the listener rather than waiting for a turn')
  assert.deepEqual(attached.map((servers) => servers.map((server) => server.name)), [['embedded_browser']])
  // A second open reuses the session: same endpoints, nothing to re-attach.
  await session.warm()
  assert.equal(attached.length, 1)
})

test('a session already open without tools is reopened once they exist', async () => {
  const bridge = toolBridge()
  const service = new CursorChatService('/workspace', {
    get: () => DEFAULT_APP_SETTINGS,
    set: async () => DEFAULT_APP_SETTINGS,
    checkpoint: () => null,
    sessionRotations: () => []
  }, bridge, '/unused')
  const session = (service as unknown as { createSession(): CursorSession }).createSession()
  const attached: string[][] = []
  Object.assign(session, { client: {
    connected: true,
    capabilities: { loadSession: true, image: true },
    async loadSession(sessionId: string, _cwd: string, mcpServers: readonly AcpMcpServer[]) {
      attached.push(mcpServers.map((server) => server.name))
      return { sessionId, models: [], modes: [], currentModelId: null, currentModeId: null,
        modelConfigId: null, modeConfigId: null }
    }
  } })
  session.adoptSaved('saved')
  // Stand in for the shipped defect: a session that opened while the listener was down.
  Object.assign(bridge, { servers: () => [] })
  await session.warm()
  assert.deepEqual(attached, [[]])

  Object.assign(bridge, { servers: () => [{ type: 'http', name: 'closedai_app', url: 'http://127.0.0.1:1/mcp/k/closedai_app', headers: [] }] })
  await session.warm()

  assert.deepEqual(attached, [[], ['closedai_app']], 'the pane repairs itself instead of staying toolless')
})
