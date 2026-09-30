import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import type { AcpMcpServer } from './cursor-acp.js'
import { JsonRpcPeerError } from '../stdio-json-rpc.js'
import type { CursorSession } from './cursor-session.js'
import type { CursorToolBridge } from './cursor-mcp.js'
import { createToolRegistry } from '../tools/index.ts'
import type { TurnSurfaceContext } from '../chat-context/turn-context.js'

const emptyTools = createToolRegistry([])

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
    bind: () => {},
    takeCallId: () => null,
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
  }, emptyTools, toolBridge(), '/unused')
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
  }, emptyTools, toolBridge(), '/unused')
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
  }, emptyTools, bridge, '/unused')
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
  }, emptyTools, bridge, '/unused')
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

function historyClient(session: CursorSession, fail: () => Error | null, prompts: string[]) {
  return {
    connected: true,
    capabilities: { loadSession: true, image: false },
    stop() {},
    async loadSession(sessionId: string) {
      const error = fail()
      if (error) throw error
      const update = (session as unknown as { onUpdate(params: unknown): void }).onUpdate.bind(session)
      update({ sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Earlier question' } } })
      update({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Earlier answer' } } })
      return { sessionId, models: [{ modelId: 'default[]', name: 'Auto' }], modes: [],
        currentModelId: 'default[]', currentModeId: null, modelConfigId: 'model', modeConfigId: 'mode' }
    },
    async newSession() {
      return { sessionId: 'fresh', models: [{ modelId: 'default[]', name: 'Auto' }], modes: [],
        currentModelId: 'default[]', currentModeId: null, modelConfigId: 'model', modeConfigId: 'mode' }
    },
    async prompt(_sessionId: string, blocks: Array<{ type: string; text?: string }>) {
      prompts.push(blocks.map((block) => block.text ?? '').join('\n'))
      return 'end_turn'
    }
  }
}

function serviceWith(chatCursorSessionId: string | null, surfaceContext?: () => TurnSurfaceContext | null) {
  const state: { saved: typeof DEFAULT_APP_SETTINGS } = { saved: { ...DEFAULT_APP_SETTINGS, chatCursorSessionId } }
  const service = new CursorChatService('/workspace', {
    get: () => state.saved,
    set: async (patch) => { state.saved = { ...state.saved, ...patch }; return state.saved },
    checkpoint: () => null,
    sessionRotations: () => state.saved.chatSessionRotations ?? []
  }, emptyTools, toolBridge(), '/unused', surfaceContext)
  const session = (service as unknown as { createSession(): CursorSession }).createSession()
  Object.assign(service, { session, readAccount: async () => {}, refreshPlanUsage: async () => {} })
  return { service, session, state }
}

test('a relaunch keeps the saved session through a failed load unless the agent says it is gone', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    const transient = serviceWith('saved')
    Object.assign(transient.session, { client: historyClient(transient.session, () => new Error('Cursor ACP request timed out: session/load'), []) })
    await transient.service.start({ warm: true })
    assert.equal(transient.state.saved.chatCursorSessionId, 'saved')

    const gone = serviceWith('saved')
    const notFound = new JsonRpcPeerError('Invalid params', -32602, { message: 'Session "saved" not found' })
    Object.assign(gone.session, { client: historyClient(gone.session, () => notFound, []) })
    await gone.service.start({ warm: true })
    assert.equal(gone.state.saved.chatCursorSessionId, null)
  } finally {
    console.warn = warn
  }
})

test('a conversation whose session the agent lost reaches the replacement as a handoff', async () => {
  const { service, session, state } = serviceWith('saved')
  let gone = false
  const prompts: string[] = []
  Object.assign(session, { client: historyClient(session, () => gone
    ? new JsonRpcPeerError('Invalid params', -32602, { message: 'Session "saved" not found' })
    : null, prompts) })
  await service.start({ warm: true })
  // The idle process closed; the agent that answers next no longer holds the session.
  gone = true
  Object.assign(session, { loadedSessionId: null })
  const warn = console.warn
  console.warn = () => {}
  try {
    await service.send('Next question')
  } finally {
    console.warn = warn
  }
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(prompts.length, 1)
  assert.match(prompts[0]!, /Earlier question/)
  assert.match(prompts[0]!, /Next question/)
  assert.equal(state.saved.chatCursorSessionId, 'fresh')
  assert.equal(state.saved.chatContinuation?.handoff ?? null, null)
  assert.match(JSON.stringify(service.snapshot().items), /continues in a new session/)
  assert.doesNotMatch(prompts[0]!, /closedai\.guide|closedai\.workspace\.ledger/)
})

test('fresh Cursor turns keep the clock and full tools without guide or ledger injection', async () => {
  const { service, session, state } = serviceWith(null)
  state.saved = { ...state.saved, chatToolSliceEnabled: true, chatWorkspaceLedgerEnabled: true }
  const prompts: string[] = []
  const attached: string[][] = []
  const client = historyClient(session, () => null, prompts)
  Object.assign(session, { client: {
    ...client,
    async newSession(_cwd: string, servers: readonly AcpMcpServer[]) {
      attached.push(servers.map((server) => server.name))
      return client.newSession()
    }
  } })
  await service.start({ warm: true })
  await service.send('Fix src/main/cursor/cursor-service.ts')
  await new Promise((resolve) => setImmediate(resolve))
  await service.send('Research the latest browser release')
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(attached, [['embedded_browser']], 'a slice change keeps the full attached catalog and session')
  assert.equal(prompts.length, 2)
  for (const prompt of prompts) {
    assert.match(prompt, /name="closedai.clock" kind="application"/)
    assert.match(prompt, /name="closedai.runtime" kind="application"/)
    assert.match(prompt, /"host":"closedai"/)
    assert.doesNotMatch(prompt, /closedai\.guide|closedai\.workspace\.ledger|closedai\.chat\.handoff/)
  }
  assert.equal(service.snapshot().threadId, 'cursor:fresh')
})

test('Cursor keeps its native session past idle item pressure while other-lane rotation settings stay enabled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { service, session, state } = serviceWith('saved')
  state.saved = { ...state.saved, chatSeamlessRotation: true, chatRotateAtItems: 1 }
  const prompts: string[] = []
  Object.assign(session, { client: historyClient(session, () => null, prompts) })
  await service.start({ warm: true })
  await service.send('Find the implementation')
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(60_000)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(service.snapshot().threadId, 'cursor:saved')
  assert.equal(state.saved.chatCursorSessionId, 'saved')
  assert.equal(state.saved.chatContinuation, null)
  assert.deepEqual(state.saved.chatSessionRotations ?? [], [])
  assert.equal(state.saved.chatSeamlessRotation, true)
  assert.equal(state.saved.chatRotateAtItems, 1)
  await service.send('Continue editing in the same session')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(service.snapshot().threadId, 'cursor:saved')
  assert.equal(prompts.length, 2)
})

test('explicit Cursor compact still carries history once and preserves relevant surface context', async () => {
  const { service, session, state } = serviceWith('saved', () => ({
    tabId: 'tab-1', url: 'https://example.com/', title: 'Example', isLoading: false
  }))
  state.saved = { ...state.saved, chatSeamlessRotation: true }
  const prompts: string[] = []
  const client = historyClient(session, () => null, prompts)
  Object.assign(session, { client })
  await service.start({ warm: true })
  await service.compactConversation()
  assert.equal(state.saved.chatSessionRotations?.at(-1)?.reason, 'manual')
  assert.ok(state.saved.chatContinuation?.handoff)
  // Compact retired the process; use the same fake ACP transport for its replacement.
  Object.assign(session, { client })
  await service.send('Summarize this page')
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(prompts[0]!, /name="closedai.chat.handoff" kind="untrusted"/)
  assert.match(prompts[0]!, /Earlier question/)
  assert.match(prompts[0]!, /closedai.browser.active-tab/)
  assert.doesNotMatch(prompts[0]!, /closedai\.guide|closedai\.workspace\.ledger/)
  assert.equal(state.saved.chatContinuation?.handoff, null)
  await service.send('Continue')
  await new Promise((resolve) => setImmediate(resolve))
  assert.doesNotMatch(prompts[1]!, /closedai\.chat\.handoff|closedai\.browser\.active-tab/)
})
