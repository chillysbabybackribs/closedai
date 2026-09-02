import assert from 'node:assert/strict'
import test from 'node:test'
import { boundsEqual } from './native-view-bounds.js'

const rect = { x: 20, y: 40, width: 800, height: 600, visible: true }

test('native bounds equality includes modal occlusion state', () => {
  assert.equal(boundsEqual(rect, { ...rect, occluded: true }), false)
  assert.equal(boundsEqual({ ...rect, occluded: true }, { ...rect, occluded: true }), true)
})
