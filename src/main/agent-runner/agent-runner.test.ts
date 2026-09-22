import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { applyProjectMutations, type ProjectMutation } from '../../shared/project/mutations.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import { createDefaultProjectStoreFile, type ProjectStoreFile } from '../../shared/project/store-file.js'
import { AgentRunner, type RunnerChat, type RunnerStore } from './agent-runner.js'
import type { PaneState } from './runner-plan.js'

const PATH = '/tmp/project'
const COORDINATOR = 'pane-coordinator'

class FakeStore implements RunnerStore {
  file: ProjectStoreFile
  constructor(patch: Partial<ProjectStoreFile> = {}) {
    this.file = { ...createDefaultProjectStoreFile(1), ...patch }
  }
  snapshot(): Promise<ProjectSnapshot> {
    return Promise.resolve({ projectPath: PATH, ...structuredClone(this.file) })
  }
  mutate(_path: string, mutations: readonly ProjectMutation[]): Promise<ProjectSnapshot> {
    this.file = applyProjectMutations(this.file, mutations, Date.now())
    return this.snapshot()
  }
  on(): () => void {
    return () => {}
  }
}

class FakeChat implements RunnerChat {
  readonly sent: Array<{ paneId: string; text: string }> = []
  readonly panes = new Map<string, PaneState>([[COORDINATOR, { exists: true, running: false, activity: null }]])
  private next = 0
  paneState(paneId: string): PaneState {
    return this.panes.get(paneId) ?? { exists: false, running: false, activity: null }
  }
  newWorker(): Promise<string> {
    this.next += 1
    const paneId = `pane-worker-${this.next}`
    this.panes.set(paneId, { exists: true, running: false, activity: null })
    return Promise.resolve(paneId)
  }
  send(paneId: string, text: string): Promise<void> {
    this.sent.push({ paneId, text })
    // A pane that was sent a message is running until the test says otherwise.
    this.panes.set(paneId, { exists: true, running: true, activity: 'Working' })
    return Promise.resolve()
  }
  on(_listener: (event: ChatWorkspaceEvent) => void): () => void {
    return () => {}
  }
  /** Stand in for a worker finishing its turn and recording the result. */
  finish(paneId: string): void {
    this.panes.set(paneId, { exists: true, running: false, activity: null })
  }
}

function building(tree: ProjectStoreFile['tree'] = []): Partial<ProjectStoreFile> {
  return {
    phase: 'building',
    tree,
    coordinator: { provider: 'claude', modelId: 'm', reasoningEffort: null, threadId: null, paneId: COORDINATOR }
  }
}

function makeRunner(store: FakeStore, chat: FakeChat): AgentRunner {
  const runner = new AgentRunner({ store: () => store, chat: () => chat })
  runner.start()
  return runner
}

test('an empty queue asks the coordinator once, not on every pass', async () => {
  const store = new FakeStore(building())
  const chat = new FakeChat()
  const runner = makeRunner(store, chat)
  try {
    await runner.runOnce(PATH)
    await runner.runOnce(PATH)
    const asks = chat.sent.filter((message) => message.paneId === COORDINATOR)
    assert.equal(asks.length, 1)
    assert.match(asks[0]!.text, /\[run loop\]/)
  } finally {
    runner.stop()
  }
})

test('a queued task is dispatched to a worker and the node records which one', async () => {
  const now = Date.now()
  const store = new FakeStore(building([
    { id: 'root', kind: 'root', state: 'anchored', title: 'Root', summary: '', detail: '', createdAt: now, updatedAt: now },
    { id: 't1', parent: 'root', kind: 'task', state: 'queued', title: 'First task', summary: 'do it', detail: 'ship it', createdAt: now, updatedAt: now }
  ]))
  const chat = new FakeChat()
  const runner = makeRunner(store, chat)
  try {
    await runner.runOnce(PATH)
    const node = store.file.tree.find((entry) => entry.id === 't1')!
    assert.equal(node.state, 'active')
    assert.equal(node.assignment?.paneId, 'pane-worker-1')
    const brief = chat.sent.find((message) => message.paneId === 'pane-worker-1')
    assert.ok(brief, 'the worker was briefed')
    assert.match(brief!.text, /closedai_project\.mutate/)
    assert.match(brief!.text, /"id": "t1"/)
    // The coordinator is not asked for anything while a task is in flight.
    assert.equal(chat.sent.filter((message) => message.paneId === COORDINATOR).length, 0)
  } finally {
    runner.stop()
  }
})

test('the next queued task goes out as soon as the first completes, with nobody asked to continue', async () => {
  const now = Date.now()
  const store = new FakeStore(building([
    { id: 'root', kind: 'root', state: 'anchored', title: 'Root', summary: '', detail: '', createdAt: now, updatedAt: now },
    { id: 't1', parent: 'root', kind: 'task', state: 'queued', title: 'One', summary: '', detail: '', paths: ['src/a.ts'], createdAt: now, updatedAt: now },
    { id: 't2', parent: 'root', kind: 'task', state: 'queued', title: 'Two', summary: '', detail: '', paths: ['src/a.ts'], createdAt: now, updatedAt: now }
  ]))
  const chat = new FakeChat()
  const runner = makeRunner(store, chat)
  try {
    await runner.runOnce(PATH)
    // Same file: the second task waits rather than racing the first.
    assert.equal(store.file.tree.find((node) => node.id === 't2')!.state, 'queued')

    // The worker records its result and ends its turn, exactly as the brief asks.
    await store.mutate(PATH, [{ type: 'tree', events: [{ update: { id: 't1', state: 'complete', summary: 'done' } }] }])
    chat.finish('pane-worker-1')

    await runner.runOnce(PATH)
    const second = store.file.tree.find((node) => node.id === 't2')!
    assert.equal(second.state, 'active')
    assert.equal(second.assignment?.paneId, 'pane-worker-2')
    assert.equal(chat.sent.filter((message) => message.paneId === COORDINATOR).length, 0)
  } finally {
    runner.stop()
  }
})

test('when the last task lands, the coordinator is asked to plan again', async () => {
  const now = Date.now()
  const store = new FakeStore(building([
    { id: 'root', kind: 'root', state: 'anchored', title: 'Root', summary: '', detail: '', createdAt: now, updatedAt: now },
    { id: 't1', parent: 'root', kind: 'task', state: 'queued', title: 'One', summary: '', detail: '', createdAt: now, updatedAt: now }
  ]))
  const chat = new FakeChat()
  const runner = makeRunner(store, chat)
  try {
    await runner.runOnce(PATH)
    await store.mutate(PATH, [{ type: 'tree', events: [{ update: { id: 't1', state: 'complete', summary: 'done' } }] }])
    chat.finish('pane-worker-1')
    await runner.runOnce(PATH)
    const asks = chat.sent.filter((message) => message.paneId === COORDINATOR)
    assert.equal(asks.length, 1)
    assert.match(asks[0]!.text, /Every task is complete/)
  } finally {
    runner.stop()
  }
})

test('a project that is not building is left alone', async () => {
  const store = new FakeStore({ phase: 'intake' })
  const chat = new FakeChat()
  const runner = makeRunner(store, chat)
  try {
    await runner.runOnce(PATH)
    assert.deepEqual(chat.sent, [])
  } finally {
    runner.stop()
  }
})
