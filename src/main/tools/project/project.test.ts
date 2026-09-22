import assert from 'node:assert/strict'
import test from 'node:test'

import { ProjectStore } from '../../project-store/project-store.js'
import { ToolRegistry } from '../registry.js'
import { projectTools, type ProjectToolHost } from './index.js'
import { parseProjectMutations } from './mutation-parser.js'

function harness(paneProject: Record<string, string | null> = { coordinator: '/work/app', worker: '/work/app' }) {
  const stores = new Map<string, ProjectStore>()
  const store = (path: string): ProjectStore => {
    let entry = stores.get(path)
    if (!entry) { entry = ProjectStore.inMemory(path); stores.set(path, entry) }
    return entry
  }
  const host: ProjectToolHost = {
    snapshot: async (path) => store(path).snapshot(),
    mutate: async (path, mutations) => store(path).mutate(mutations)
  }
  const registry = new ToolRegistry([projectTools(() => host, (paneId) => paneProject[paneId] ?? null)])
  const call = async (tool: string, args: Record<string, unknown>, paneId: string | null = 'coordinator') => {
    const result = await registry.call({ namespace: 'closedai_project', tool, arguments: args }, { threadId: null, turnId: null, callId: 'c', paneId, source: 'model' })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    return { result, text, json: result.isError ? null : JSON.parse(text) as Record<string, unknown> }
  }
  return { call, registry, store }
}

test('snapshot reads the calling chat\'s project and bounds the journal', async () => {
  const { call, store } = harness()
  store('/work/app').mutate([{ type: 'journal', text: 'one' }, { type: 'journal', text: 'two' }, { type: 'journal', text: 'three' }])
  const { json } = await call('snapshot', { journal_lines: 2 })
  assert.equal(json?.projectPath, '/work/app')
  assert.equal(json?.phase, 'intake')
  assert.equal(json?.journalTotal, 3)
  assert.deepEqual((json?.journal as Array<{ text: string }>).map((line) => line.text), ['two', 'three'])
})

test('a chat without a project must pass project_path', async () => {
  const { call } = harness({ lost: null })
  const missing = await call('snapshot', {}, 'lost')
  assert.equal(missing.result.isError, true)
  assert.equal(missing.result.errorKind, 'usage')
  const explicit = await call('snapshot', { project_path: '/work/other' }, 'lost')
  assert.equal(explicit.json?.projectPath, '/work/other')
})

test('mutate plans tasks, a worker in the same project completes one, and the pane sees both', async () => {
  const { call, store } = harness()
  store('/work/app').mutate([{ type: 'start', root: { id: 'root', kind: 'root', state: 'anchored', title: 'Root', summary: '', detail: '' }, note: 'Started' }])
  const planned = await call('mutate', { mutations: [
    { type: 'tree', events: [
      { add: { id: 'shell', parent: 'root', title: 'Runnable shell', summary: 'Queued', detail: 'Create index.html that renders the title.' } }
    ], note: 'Planned the first task.' }
  ] })
  assert.equal(planned.result.isError, undefined, planned.text)
  assert.equal(planned.json?.applied, 1)
  const tree = planned.json?.tree as Array<Record<string, unknown>>
  assert.deepEqual(tree.map((node) => [node.id, node.kind, node.state]), [['root', 'root', 'anchored'], ['shell', 'task', 'queued']])

  const done = await call('mutate', { project_path: '/work/app', mutations: [
    { type: 'tree', events: [{ update: { id: 'shell', state: 'complete', summary: 'index.html added' } }] },
    { type: 'journal', text: 'Worker finished the shell.' }
  ] }, 'worker')
  assert.equal(done.result.isError, undefined, done.text)
  const snapshot = store('/work/app').snapshot()
  assert.equal(snapshot.tree.find((node) => node.id === 'shell')?.state, 'complete')
  assert.deepEqual(snapshot.journal.map((line) => line.text), ['Started', 'Planned the first task.', 'Worker finished the shell.'])
})

test('mutate refuses malformed input with the path to each problem, and applies nothing', async () => {
  const { call, store } = harness()
  const bad = await call('mutate', { mutations: [
    { type: 'journal', text: 'fine' },
    { type: 'tree', events: [{ add: { id: 'x', title: 'No parent' } }, { replace: [] }] },
    { type: 'reset' }
  ] })
  assert.equal(bad.result.errorKind, 'usage')
  assert.match(bad.text, /mutations\[1\]\.events\[0\]\.add\.parent is required/)
  assert.match(bad.text, /mutations\[1\]\.events\[1\]\.replace is not accepted/)
  assert.match(bad.text, /mutations\[2\]\.type "reset"/)
  assert.equal(store('/work/app').snapshot().journal.length, 0, 'a batch with any problem applies nothing')
})

test('parser normalises node defaults and rejects unknown kinds, states, and phases', () => {
  const ok = parseProjectMutations([
    { type: 'tree', events: [{ add: { id: ' t1 ', parent: 'root', title: 'Task' } }] },
    { type: 'phase', phase: 'closing', note: 'Wrapping up' },
    { type: 'caughtUp' }
  ])
  assert.deepEqual(ok.problems, [])
  const tree = ok.mutations[0]
  assert.ok(tree && tree.type === 'tree' && 'add' in tree.events[0]!)
  assert.deepEqual(tree.events[0], { add: { id: 't1', parent: 'root', kind: 'task', state: 'queued', title: 'Task', summary: '', detail: '' } })

  const bad = parseProjectMutations([
    { type: 'tree', events: [{ add: { id: 't', parent: 'root', title: 'T', kind: 'epic', state: 'done' } }] },
    { type: 'phase', phase: 'launched' },
    { type: 'coordinator', coordinator: null }
  ])
  assert.equal(bad.mutations.length, 0)
  assert.match(bad.problems.join('\n'), /kind must be one of/)
  assert.match(bad.problems.join('\n'), /state must be one of/)
  assert.match(bad.problems.join('\n'), /phase must be one of/)
  assert.match(bad.problems.join('\n'), /"coordinator" is written by the workspace pane/)
})

test('registry advertises both verbs and neither is deferred', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['closedai_project.snapshot', 'closedai_project.mutate'])
  for (const tool of registry.namespaces[0]!.tools) assert.notEqual(tool.deferLoading, true, tool.name)
})
