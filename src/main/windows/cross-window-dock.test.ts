import assert from 'node:assert/strict'
import test from 'node:test'
import { pickCrossDockTarget, screenToCanvas } from './cross-window-dock.ts'

const surface = { x: 8, y: 72, width: 600, height: 400 }
const content = { x: 100, y: 50, width: 800, height: 600 }

test('screenToCanvas maps through content and surface offsets', () => {
  const point = screenToCanvas({ id: 'a', content, surface }, content.x + surface.x + 40, content.y + surface.y + 30)
  assert.deepEqual(point, { x: 40, y: 30 })
})

test('pickCrossDockTarget docks only where the pointer is over another window with nothing in front', () => {
  const back = { x: 100, y: 100, width: 400, height: 300 }
  const front = { x: 200, y: 100, width: 400, height: 300 }
  const inBoth = { x: front.x + surface.x + 50, y: front.y + surface.y + 20 }
  const onlyBack = { x: back.x + surface.x + 20, y: back.y + surface.y + 20 }
  const frames = [
    { id: 'a', content: back, surface },
    { id: 'b', content: front, surface }
  ]
  assert.equal(pickCrossDockTarget('b', frames, inBoth.x, inBoth.y), null)
  assert.deepEqual(pickCrossDockTarget('b', frames, onlyBack.x, onlyBack.y), { windowId: 'a', x: 20, y: 20 })
  assert.deepEqual(pickCrossDockTarget('a', frames, inBoth.x, inBoth.y), { windowId: 'b', x: 50, y: 20 })
})
