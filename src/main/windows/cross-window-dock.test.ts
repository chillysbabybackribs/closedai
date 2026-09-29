import assert from 'node:assert/strict'
import test from 'node:test'
import { pickDockTarget, screenToCanvas } from './cross-window-dock.ts'

const surface = { x: 8, y: 72, width: 600, height: 400 }
const content = { x: 100, y: 50, width: 800, height: 600 }

test('screenToCanvas maps through content and surface offsets', () => {
  const point = screenToCanvas({ id: 'a', content, surface }, content.x + surface.x + 40, content.y + surface.y + 30)
  assert.deepEqual(point, { x: 40, y: 30 })
})

test('pickDockTarget prefers the last frame in z-order', () => {
  const point = { x: content.x + surface.x + 10, y: content.y + surface.y + 10 }
  const frames = [
    { id: 'a', content, surface },
    { id: 'b', content, surface }
  ]
  const hit = pickDockTarget(frames, point.x, point.y)
  assert.deepEqual(hit, { windowId: 'b', x: 10, y: 10 })
})
