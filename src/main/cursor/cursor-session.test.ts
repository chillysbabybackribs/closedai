import assert from 'node:assert/strict'
import test from 'node:test'

import { CursorSession, type CursorSessionDeps } from './cursor-session.js'

function session(overrides: Partial<CursorSessionDeps> = {}): { session: CursorSession; adopted: string[] } {
  const adopted: string[] = []
  const deps: CursorSessionDeps = {
    cwd: '/workspace',
    mcpServers: async () => [],
    modelId: () => null,
    apply: () => {},
    onTurn: () => {},
    onSessionId: (sessionId) => adopted.push(sessionId),
    onSetup: () => {},
    onTitle: () => {},
    onTurnEnd: () => {},
    ...overrides
  }
  return { session: new CursorSession(deps), adopted }
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
