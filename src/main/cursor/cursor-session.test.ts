import assert from 'node:assert/strict'
import test from 'node:test'

import { CursorSession, type CursorSessionDeps } from './cursor-session.js'

function session(overrides: Partial<CursorSessionDeps> = {}): { session: CursorSession; adopted: string[] } {
  const adopted: string[] = []
  const deps: CursorSessionDeps = {
    cwd: '/workspace',
    mcpServers: () => [],
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

test('closedai.instructions are delivered once until the thread changes', () => {
  const { session: thread } = session()
  assert.equal(thread.consumeInstructionsPending(), true)
  assert.equal(thread.consumeInstructionsPending(), false)
  thread.continueWith('other-session')
  assert.equal(thread.consumeInstructionsPending(), true)
})

test('a replayed session reuses its returned setup without another load before the next turn', async () => {
  const catalogs: string[] = []
  const { session: thread } = session({ onSetup: (setup) => catalogs.push(setup.sessionId) })
  thread.adoptSaved('history')
  const loads: string[] = []
  const setup = { sessionId: 'history', models: [], modes: [], currentModelId: 'model', currentModeId: null }
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
      return { sessionId: id, models: [], modes: [], currentModelId: null, currentModeId: null }
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
      return { sessionId: id, models: [], modes: [], currentModelId: null, currentModeId: null }
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
