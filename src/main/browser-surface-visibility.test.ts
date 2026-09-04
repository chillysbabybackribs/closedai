import assert from 'node:assert/strict'
import test from 'node:test'
import {
  browserOccludedBounds,
  browserPaneBounds,
  browserSurfaceVisibility,
  refreshVisibleBrowserSurface
} from './browser-surface-visibility.js'

const rect = { x: 20, y: 40, width: 800, height: 600 }

test('hide, collapsed reports, and reveal preserve the loaded viewport until layout returns', () => {
  let bounds = browserPaneBounds(rect, { ...rect, visible: false })
  bounds = browserPaneBounds(bounds, { x: 1000, y: 0, width: 0, height: 0, visible: false })
  assert.deepEqual(bounds, { ...rect, visible: false, occluded: undefined })
  bounds = browserPaneBounds(bounds, { x: 1000, y: 0, width: 0, height: 0, visible: true })
  assert.equal(browserSurfaceVisibility(bounds).pageVisible, false)
  const restored = { ...rect, width: 900, visible: true }
  assert.deepEqual(browserPaneBounds(bounds, restored), restored)
})

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

test('navigation refresh reasserts bounds and visibility only for an on-screen surface', () => {
  const calls: Array<{ kind: 'bounds'; value: typeof rect } | { kind: 'visible'; value: boolean }> = []
  const surface = {
    setBounds: (value: typeof rect) => calls.push({ kind: 'bounds', value }),
    setVisible: (value: boolean) => calls.push({ kind: 'visible', value })
  }

  assert.equal(refreshVisibleBrowserSurface(surface, rect, true), true)
  assert.deepEqual(calls, [
    { kind: 'bounds', value: rect },
    { kind: 'visible', value: true }
  ])

  calls.length = 0
  assert.equal(refreshVisibleBrowserSurface(surface, rect, false), false)
  assert.deepEqual(calls, [])
})
