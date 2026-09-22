import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyProjectMutation } from '../../shared/project/mutations.ts'
import { createDefaultProjectStoreFile } from '../../shared/project/store-file.ts'
import { buildProjectCanvasFixture } from './project-canvas-fixture.ts'
import { fixtureStoreFile, projectView } from './project-view.ts'

test('a fresh store file is an empty intake view', () => {
  const view = projectView(createDefaultProjectStoreFile(1))
  assert.equal(view.phase, 'intake')
  assert.equal(view.discovery.asking, 'idea')
  assert.equal(view.confirmedAt, 0)
  assert.deepEqual(view.tree, [])
})

test('building, closing, and complete phases render the canvas', () => {
  const base = createDefaultProjectStoreFile(1)
  for (const phase of ['building', 'closing', 'complete'] as const) {
    assert.equal(projectView({ ...base, phase }).phase, 'canvas', phase)
  }
  assert.equal(projectView({ ...base, phase: 'confirm' }).phase, 'intake')
})

test('start moves the view from intake to canvas with the root and opening line', () => {
  const started = applyProjectMutation(createDefaultProjectStoreFile(1), {
    type: 'start', root: { id: 'root', kind: 'root', state: 'anchored', title: 'Root', summary: '', detail: '' }, note: 'Go.'
  }, 40)
  const view = projectView(started)
  assert.equal(view.phase, 'canvas')
  assert.equal(view.confirmedAt, 40)
  assert.equal(view.journal[0]?.text, 'Go.')
})

test('the canvas fixture round-trips through a store file', () => {
  const fixture = buildProjectCanvasFixture(1_700_000_000_000)
  const view = projectView(fixtureStoreFile(fixture, 1))
  assert.equal(view.phase, 'canvas')
  assert.equal(view.tree.length, fixture.tree.length)
  assert.equal(view.journal.length, fixture.journal.length)
  assert.equal(view.confirmedAt, fixture.confirmedAt)
  assert.equal(view.discovery.record.idea, fixture.discovery.record.idea)
})
