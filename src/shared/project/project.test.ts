import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultHiveConfig } from './coordinator.js'
import { emptyDirectionRecord } from './direction.js'
import type { ProjectRecord } from './record.js'

test('default hive config is versioned and rolling', () => {
  const hive = defaultHiveConfig()
  assert.equal(hive.version, 1)
  assert.equal(hive.dispatch.mode, 'rolling')
  assert.ok(hive.workers.roles.length >= 2)
})

test('project record shape accepts intake without coordinator', () => {
  const record: ProjectRecord = {
    projectPath: '/tmp/demo',
    phase: 'intake',
    direction: emptyDirectionRecord(),
    coordinator: null,
    hive: defaultHiveConfig(),
    startedAt: null,
    acceptedAt: null,
    tree: []
  }
  assert.equal(record.coordinator, null)
})
