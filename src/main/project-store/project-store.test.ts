import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { defaultHiveConfig } from '../../shared/project/coordinator.js'
import { createDefaultProjectStoreFile } from '../../shared/project/store-file.ts'
import { normalizeProjectStoreFile } from './normalize.ts'
import { ProjectStore } from './project-store.ts'

test('normalize rejects unknown versions and accepts a minimal v1 file', () => {
  assert.equal(normalizeProjectStoreFile({ version: 2 }), null)
  const file = createDefaultProjectStoreFile(1)
  file.direction.idea = 'Ship a tool'
  assert.deepEqual(normalizeProjectStoreFile(file)?.direction.idea, 'Ship a tool')
})

test('project store persists under .closedai/project.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-project-store-'))
  try {
    const store = await ProjectStore.open(dir)
    assert.equal(store.snapshot().phase, 'intake')
    store.patch({ phase: 'building', direction: { ...store.snapshot().direction, idea: 'Build it' }, startedAt: 10 })
    await store.flush()
    const text = await readFile(join(dir, '.closedai', 'project.json'), 'utf8')
    const parsed = normalizeProjectStoreFile(JSON.parse(text))
    assert.equal(parsed?.phase, 'building')
    assert.equal(parsed?.direction.idea, 'Build it')
    const reopened = await ProjectStore.open(dir)
    assert.equal(reopened.snapshot().phase, 'building')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('project store keeps its directory out of version control', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-project-store-'))
  try {
    await ProjectStore.open(dir)
    assert.equal(await readFile(join(dir, '.closedai', '.gitignore'), 'utf8'), '*\n')
    await writeFile(join(dir, '.closedai', '.gitignore'), 'project.json\n')
    await ProjectStore.open(dir)
    assert.equal(await readFile(join(dir, '.closedai', '.gitignore'), 'utf8'), 'project.json\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('mutate applies verbs as one change and persists them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-project-store-'))
  try {
    const store = await ProjectStore.open(dir)
    let events = 0
    store.on('change', () => { events += 1 })
    const snapshot = store.mutate([
      { type: 'direction', direction: { ...store.snapshot().direction, idea: 'Build it' }, asking: 'user' },
      { type: 'start', root: { id: 'root', kind: 'root', state: 'anchored', title: 'Root', summary: '', detail: '' }, note: 'Started.' },
      { type: 'tree', events: [{ add: { id: 't1', parent: 'root', kind: 'task', state: 'queued', title: 'Task', summary: '', detail: '' } }], note: 'Queued.' }
    ])
    assert.equal(events, 1)
    assert.equal(snapshot.phase, 'building')
    assert.deepEqual(snapshot.tree.map((node) => node.id), ['root', 't1'])
    assert.deepEqual(snapshot.journal.map((line) => line.text), ['Started.', 'Queued.'])
    assert.equal(store.mutate([]).updatedAt, snapshot.updatedAt, 'an empty batch changes nothing')
    await store.flush()
    const reopened = await ProjectStore.open(dir)
    assert.equal(reopened.snapshot().journal.length, 2)
    assert.equal(reopened.snapshot().direction.idea, 'Build it')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('in-memory store does not write disk', async () => {
  const store = ProjectStore.inMemory('/tmp/x', createDefaultProjectStoreFile())
  store.patch({ hive: defaultHiveConfig() })
  await store.flush()
  assert.equal(store.snapshot().projectPath, '/tmp/x')
})
