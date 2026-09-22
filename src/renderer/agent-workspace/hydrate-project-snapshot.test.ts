import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createDefaultProjectStoreFile } from '../../shared/project/store-file.js'
import { hydrateFromSnapshot, shouldHydrateFromSnapshot } from './hydrate-project-snapshot.ts'

test('empty intake snapshot does not hydrate the prototype', () => {
  const snapshot = { projectPath: '/tmp/p', ...createDefaultProjectStoreFile() }
  assert.equal(shouldHydrateFromSnapshot(snapshot), false)
})

test('building phase hydrates canvas state', () => {
  const base = createDefaultProjectStoreFile()
  base.phase = 'building'
  base.direction.idea = 'Ship'
  const hydration = hydrateFromSnapshot({ projectPath: '/tmp/p', ...base })
  assert.equal(hydration.phase, 'canvas')
  assert.equal(hydration.discovery.record.idea, 'Ship')
})
