import assert from 'node:assert/strict'
import test from 'node:test'

import { JsonRpcPeerError } from '../stdio-json-rpc.js'
import { isAcpSessionNotFound } from './cursor-acp.js'
import type { AcpMcpServer } from './cursor-acp.js'
import { CursorSession, type CursorSessionDeps } from './cursor-session.js'

function session(overrides: Partial<CursorSessionDeps> = {}): { session: CursorSession; adopted: string[]; saved: string[] } {
  const adopted: string[] = []
  const saved: string[] = []
  const deps: CursorSessionDeps = {
    cwd: '/workspace',
    mcpServers: async () => [],
    modelId: () => null,
    apply: () => {},
    onTurn: () => {},
    onSessionId: (sessionId) => adopted.push(sessionId),
    onSessionSaved: (sessionId) => saved.push(sessionId),
    onSetup: () => {},
    onTurnEnd: () => {},
    ...overrides
  }
  return { session: new CursorSession(deps), adopted, saved }
}

test('a pane opens on the session it saved rather than minting one beside it', () => {
  const { session: thread, adopted } = session()
  thread.adoptSaved('saved-session')
  assert.equal(thread.sessionId, 'saved-session')
  // Seeding is not a thread change: the pane already knew this id, so nothing is announced.
  assert.deepEqual(adopted, [])
})

test('seeding never overwrites the session the pane is already on', () => {
  const { session: thread } = session()
  thread.adoptSaved('first')
  thread.adoptSaved('second')
  assert.equal(thread.sessionId, 'first')
})

test('no saved session leaves the thread to open a fresh one', () => {
  const { session: thread } = session()
  thread.adoptSaved(null)
  assert.equal(thread.sessionId, null)
})

test('continuing a replayed session announces the change and keeps the process', () => {
  const { session: thread, adopted } = session()
  thread.adoptSaved('saved-session')
  thread.continueWith('opened-from-history')
  assert.equal(thread.sessionId, 'opened-from-history')
  assert.deepEqual(adopted, ['opened-from-history'])
  thread.continueWith('opened-from-history')
  assert.deepEqual(adopted, ['opened-from-history'])
})

test('a replayed session reuses its returned setup without another load before the next turn', async () => {
  const catalogs: string[] = []
  const { session: thread } = session({ onSetup: (setup) => catalogs.push(setup.sessionId) })
  thread.adoptSaved('history')
  const loads: string[] = []
  const setup = { sessionId: 'history', models: [], modes: [], currentModelId: 'model', currentModeId: null,
    modelConfigId: 'model', modeConfigId: 'mode' }
  Object.assign(thread, { client: {
    connected: true,
    capabilities: { loadSession: true },
    async loadSession(id: string) { loads.push(id); return { ...setup, sessionId: id } }
  } })
  await thread.replay('history')
  assert.deepEqual(catalogs, [])
  thread.continueWith('history')
  assert.deepEqual(catalogs, ['history'])
  assert.deepEqual(await thread.warm(), setup)
  assert.deepEqual(loads, ['history'])
  // Reading another history must not make its setup stand in for the current chat.
  await thread.replay('other')
  assert.equal((await thread.warm()).sessionId, 'history')
  assert.deepEqual(loads, ['history', 'other', 'history'])
})

test('history replay uses the source project without changing the active session', async () => {
  const { session: thread, adopted } = session()
  thread.adoptSaved('current')
  const loads: Array<{ id: string; cwd: string }> = []
  Object.assign(thread, { client: {
    connected: true, capabilities: { loadSession: true },
    async loadSession(id: string, cwd: string) {
      loads.push({ id, cwd })
      return { sessionId: id, models: [], modes: [], currentModelId: null, currentModeId: null,
        modelConfigId: null, modeConfigId: null }
    }
  } })
  await thread.replay('older', '/other-project')
  assert.equal(thread.sessionId, 'current')
  assert.deepEqual(adopted, [])
  await thread.warm()
  assert.deepEqual(loads, [{ id: 'older', cwd: '/other-project' }, { id: 'current', cwd: '/workspace' }])
})

test('concurrent history reads serialize the shared collector and a failed read releases the next', async () => {
  const { session: thread } = session()
  const loads: string[] = []
  let rejectFirst!: (error: Error) => void
  let started!: () => void
  const firstStarted = new Promise<void>((resolve) => { started = resolve })
  Object.assign(thread, { client: {
    connected: true, capabilities: { loadSession: true },
    async loadSession(id: string) {
      loads.push(id)
      if (id === 'first') {
        started()
        await new Promise((_resolve, reject) => { rejectFirst = reject })
      }
      return { sessionId: id, models: [], modes: [], currentModelId: null, currentModeId: null,
        modelConfigId: null, modeConfigId: null }
    }
  } })
  const first = thread.replay('first')
  const second = thread.replay('second')
  await firstStarted
  assert.deepEqual(loads, ['first'])
  const failure = assert.rejects(first, /unavailable/)
  rejectFirst(new Error('unavailable'))
  await failure
  assert.deepEqual(await second, [])
  assert.deepEqual(loads, ['first', 'second'])
})

test('a live model change uses the advertised stable config option', async () => {
  const { session: thread } = session()
  thread.adoptSaved('active')
  const calls: Array<{ sessionId: string; configId: string; value: string }> = []
  Object.assign(thread, {
    client: {
      connected: true,
      async setConfigOption(sessionId: string, configId: string, value: string) {
        calls.push({ sessionId, configId, value })
      }
    },
    setup: {
      sessionId: 'active', models: [], modes: [], currentModelId: 'old', currentModeId: null,
      modelConfigId: 'model', modeConfigId: 'mode'
    }
  })

  await thread.selectModel('claude-opus-5[effort=high]')

  assert.deepEqual(calls, [{
    sessionId: 'active', configId: 'model', value: 'claude-opus-5[effort=high]'
  }])
})

test('send announces the turn before opening the agent session', async () => {
  const turns: Array<string | null> = []
  const { session: thread } = session({ onTurn: (turnId) => turns.push(turnId) })
  let releaseSession!: () => void
  const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve })
  Object.assign(thread, { client: {
    connected: true,
    capabilities: {},
    async newSession() {
      await sessionGate
      return { sessionId: 'live', models: [], modes: [], currentModelId: null, currentModeId: null,
        modelConfigId: null, modeConfigId: null }
    },
    prompt() { return Promise.resolve('end_turn') }
  } })
  const turnId = 'cursor-turn-test'
  thread.beginTurn(turnId)
  const send = thread.send([{ type: 'text', text: 'hi' }], turnId)
  await Promise.resolve()
  assert.equal(thread.activeTurnId, turnId)
  releaseSession()
  await send
  assert.equal(thread.activeTurnId, null)
})

test('a session reopens when the MCP server list changes', async () => {
  let servers: readonly AcpMcpServer[] = [{
    type: 'http', name: 'closedai_app', url: 'http://127.0.0.1:1/a', headers: []
  }]
  const { session: thread } = session({ mcpServers: async () => servers })
  const loads: string[] = []
  Object.assign(thread, { client: {
    connected: true,
    capabilities: { loadSession: true },
    async loadSession(id: string, _cwd: string, mcp: readonly AcpMcpServer[]) {
      loads.push(`${id}:${mcp.map((server) => server.name).join(',')}`)
      return setupFor(id)
    },
    async newSession(_cwd: string, mcp: readonly AcpMcpServer[]) {
      loads.push(`new:${mcp.map((server) => server.name).join(',')}`)
      return setupFor('fresh')
    }
  } })
  await thread.warm()
  servers = [{ type: 'http', name: 'search', url: 'http://127.0.0.1:1/b', headers: [] }]
  await thread.warm()
  assert.equal(loads.length, 2)
  assert.notEqual(loads[0], loads[1])
})

test('a new chat warming while its first message is sent opens one session and prompts it', async () => {
  const { session: thread, adopted } = session()
  const created: string[] = []
  const prompted: string[] = []
  Object.assign(thread, { client: {
    connected: true, capabilities: { loadSession: true },
    async newSession() {
      const sessionId = `new-${created.length + 1}`
      created.push(sessionId)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { sessionId, models: [], modes: [], currentModelId: null, currentModeId: null, modelConfigId: null, modeConfigId: null }
    },
    async loadSession(id: string) {
      return { sessionId: id, models: [], modes: [], currentModelId: null, currentModeId: null, modelConfigId: null, modeConfigId: null }
    },
    prompt(sessionId: string) { prompted.push(sessionId); return new Promise(() => {}) }
  } })
  const warming = thread.warm()
  thread.beginTurn('turn-1')
  await thread.send([{ type: 'text', text: 'hello' }], 'turn-1')
  await warming
  assert.deepEqual(created, ['new-1'])
  assert.deepEqual(prompted, ['new-1'])
  assert.equal(thread.sessionId, 'new-1')
  assert.deepEqual(adopted, ['new-1'])
})

function setupFor(sessionId: string) {
  return { sessionId, models: [], modes: [], currentModelId: null, currentModeId: null, modelConfigId: null, modeConfigId: null }
}

function notFound(id: string): Error {
  return new JsonRpcPeerError('Invalid params', -32602, { message: `Session "${id}" not found` })
}

test('a new session is saved only once it has taken a turn, since the agent drops unprompted ones', async () => {
  const { session: thread, adopted, saved } = session()
  let finish!: (reason: string) => void
  let notify!: (params: unknown) => void
  Object.assign(thread, { client: {
    connected: true, capabilities: { loadSession: true },
    async newSession() { return setupFor('fresh') },
    prompt() { return new Promise((resolve) => { finish = resolve }) }
  } })
  await thread.warm()
  assert.deepEqual(adopted, ['fresh'])
  assert.deepEqual(saved, [])
  thread.beginTurn('turn-1')
  await thread.send([{ type: 'text', text: 'hi' }], 'turn-1')
  notify = (params) => (thread as unknown as { onUpdate(params: unknown): void }).onUpdate(params)
  notify({ sessionId: 'fresh', update: { sessionUpdate: 'available_commands_update' } })
  assert.deepEqual(saved, [])
  notify({ sessionId: 'fresh', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } } })
  assert.deepEqual(saved, ['fresh'])
  finish('end_turn')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(saved, ['fresh'])
})

test('a saved session the agent no longer holds is replaced and reported, with the reason', async () => {
  const lost: Array<{ id: string; reason: string }> = []
  const { session: thread, saved } = session({ onSessionLost: (id, reason) => { lost.push({ id, reason }) } })
  thread.adoptSaved('gone')
  Object.assign(thread, { client: {
    connected: true, capabilities: { loadSession: true },
    async loadSession(id: string) { throw notFound(id) },
    async newSession() { return setupFor('replacement') }
  } })
  const warn = console.warn
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  try {
    assert.equal((await thread.warm()).sessionId, 'replacement')
  } finally {
    console.warn = warn
  }
  assert.equal(thread.sessionId, 'replacement')
  assert.deepEqual(lost.map((entry) => entry.id), ['gone'])
  assert.equal(warnings.length, 1)
  assert.deepEqual(saved, [])
  assert.ok(isAcpSessionNotFound(notFound('gone')))
})

test('a reserved id that was never saved is replaced without reporting a lost conversation', async () => {
  const lost: string[] = []
  const { session: thread, saved } = session({ onSessionLost: (id) => { lost.push(id) } })
  const created: string[] = []
  Object.assign(thread, { client: {
    connected: true, capabilities: { loadSession: true },
    async loadSession(id: string) { throw notFound(id) },
    async newSession() {
      created.push(`new-${created.length + 1}`)
      return setupFor(created.at(-1)!)
    }
  } })
  await thread.warm()
  // A later process no longer holds the reserved id; that is expected, not a lost conversation.
  Object.assign(thread, { loadedSessionId: null })
  assert.equal((await thread.warm()).sessionId, 'new-2')
  assert.deepEqual(lost, [])
  assert.deepEqual(saved, [])
})
