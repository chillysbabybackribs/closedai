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

test('in-memory store does not write disk', async () => {
  const store = ProjectStore.inMemory('/tmp/x', createDefaultProjectStoreFile())
  store.patch({ hive: defaultHiveConfig() })
  await store.flush()
  assert.equal(store.snapshot().projectPath, '/tmp/x')
})
