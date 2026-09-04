import assert from 'node:assert/strict'
import test from 'node:test'
import { browserOccludedBounds, browserSurfaceVisibility } from './browser-surface-visibility.js'

const rect = { x: 20, y: 40, width: 800, height: 600 }

test('an ordinary browser surface keeps its pane and page visible', () => {
  assert.deepEqual(browserSurfaceVisibility(rect), { paneVisible: true, pageVisible: true })
})

test('a modal occludes page pixels without removing the browser pane', () => {
  assert.deepEqual(
    browserSurfaceVisibility({ ...rect, visible: true, occluded: true }),
    { paneVisible: true, pageVisible: false }
  )
})

test('a hidden workspace pane remains fully hidden regardless of modal state', () => {
  assert.deepEqual(
    browserSurfaceVisibility({ ...rect, visible: false, occluded: true }),
    { paneVisible: false, pageVisible: false }
  )
})

test('overlay occlusion keeps the compositor viewport intact outside the browser box', () => {
  const occluded = browserOccludedBounds(rect)
  assert.deepEqual(occluded, { x: 884, y: 40, width: 800, height: 600 })
  assert.ok(occluded.x > rect.x + rect.width)
})
