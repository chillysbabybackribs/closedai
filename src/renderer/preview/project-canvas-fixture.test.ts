import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDirectionReady } from './project-discovery.ts'
import { buildProjectCanvasFixture, sampleDirectionRecord } from './project-canvas-fixture.ts'

test('sample direction satisfies readiness', () => {
  assert.equal(isDirectionReady(sampleDirectionRecord()), true)
})

test('canvas fixture seeds a map with scopes beyond the root', () => {
  const fixture = buildProjectCanvasFixture(1_700_000_000_000)
  assert.equal(fixture.discovery.asking, null)
  assert.ok(fixture.tree.length > 1)
  assert.ok(fixture.journal.length > 1)
})
