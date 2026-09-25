import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IDENTITY_CAMERA, LABEL_HEIGHT, createZoomGesture, dropMissingStops, focusCamera, liveTransform, orderedSpaces,
  overviewSlots, readSpaceOrder, saveSpaceOrder, slotAt, spaceName, stepStop, visitStop, type SpaceHistory
} from './spaces-model.ts'

const size = { width: 1200, height: 800 }

test('spaces keep the order they were first seen in, whichever project is current', () => {
  const recent = [{ cwd: '/p/b', projectPath: '/p/b' }, { cwd: '/p/c', projectPath: '/p/c' }]
  const first = orderedSpaces({ cwd: '/p/a', projectPath: '/p/a' }, recent, [])
  assert.deepEqual(first.map((space) => space.id), ['/p/a', '/p/b', '/p/c'])
  // Main lists recent projects newest first and without the current one; the saved order wins.
  const after = orderedSpaces({ cwd: '/p/c', projectPath: '/p/c' }, [{ cwd: '/p/a', projectPath: '/p/a' }, { cwd: '/p/b', projectPath: '/p/b' }],
    first.map((space) => space.id))
  assert.deepEqual(after.map((space) => space.id), ['/p/a', '/p/b', '/p/c'])
  // A project main forgot drops out; a new one joins at the end.
  const next = orderedSpaces({ cwd: '/p/d', projectPath: '/p/d' }, [{ cwd: '/p/a', projectPath: '/p/a' }], ['/p/a', '/p/b', '/p/c'])
  assert.deepEqual(next.map((space) => space.id), ['/p/a', '/p/d'])
})

test('space names use the folder name, and the home workspace is Home', () => {
  assert.equal(spaceName('/home/dp/Desktop/closedai/', '/home/dp/Desktop/closedai'), 'closedai')
  assert.equal(spaceName('/home/dp', null), 'Home')
})

test('the saved order survives a round trip and ignores junk', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  saveSpaceOrder(storage, ['/p/a', '/p/b'])
  assert.deepEqual(readSpaceOrder(storage), ['/p/a', '/p/b'])
  store.set('closedai.spaces.v1', '{"order":[1,"/p/x",""]}')
  assert.deepEqual(readSpaceOrder(storage), ['/p/x'])
  store.set('closedai.spaces.v1', 'not json')
  assert.deepEqual(readSpaceOrder(storage), [])
})

test('overview slots keep the window shape, fit inside it and never overlap', () => {
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const slots = overviewSlots(count, size)
    assert.equal(slots.length, count)
    for (const slot of slots) {
      assert.ok(Math.abs(slot.width / slot.height - size.width / size.height) < 1e-9)
      assert.ok(slot.x >= 0 && slot.y - LABEL_HEIGHT >= 0)
      assert.ok(slot.x + slot.width <= size.width && slot.y + slot.height <= size.height)
    }
    for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
      const [p, q] = [slots[a]!, slots[b]!]
      assert.ok(p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y - LABEL_HEIGHT || q.y + q.height <= p.y - LABEL_HEIGHT)
    }
  }
  // A lone space still visibly shrinks and sits in the middle.
  const [only] = overviewSlots(1, size)
  assert.ok(only!.width <= size.width * 0.6 + 1e-9)
  assert.ok(Math.abs(only!.x + only!.width / 2 - size.width / 2) < 1e-9)
})

test('a reserved strip under the grid stays clear of every slot', () => {
  for (const count of [1, 3, 6]) {
    for (const slot of overviewSlots(count, size, 40)) assert.ok(slot.y + slot.height <= size.height - 40)
  }
})

test('a short last row is centred', () => {
  const slots = overviewSlots(3, size)
  const last = slots[2]!
  if (last.y !== slots[0]!.y) assert.ok(Math.abs(last.x + last.width / 2 - size.width / 2) < 1e-9)
})

test('focusing a slot fills the stage, and the live space is then untransformed', () => {
  const slot = overviewSlots(4, size)[3]!
  const camera = focusCamera(slot, size)
  assert.ok(Math.abs(camera.x + slot.x * camera.k) < 1e-9 && Math.abs(slot.width * camera.k - size.width) < 1e-9)
  const [tx, ty, scale] = liveTransform(camera, slot, size).match(/-?\d[\d.e+-]*/g)!.map(Number)
  assert.ok(Math.abs(tx!) < 1e-6 && Math.abs(ty!) < 1e-6 && Math.abs(scale! - 1) < 1e-9)
  // At the overview camera the live space sits exactly in its slot.
  assert.equal(liveTransform(IDENTITY_CAMERA, slot, size), `translate(${slot.x}px, ${slot.y}px) scale(${slot.width / size.width})`)
})

test('slotAt includes a slot label and misses the gaps', () => {
  const slots = overviewSlots(2, size)
  const first = slots[0]!
  assert.equal(slotAt(slots, { x: first.x + 4, y: first.y - LABEL_HEIGHT + 2 }), 0)
  assert.equal(slotAt(slots, { x: 1, y: 1 }), -1)
})

test('history steps back and forward, and a new visit drops the forward stops', () => {
  let history: SpaceHistory = { stops: [{ kind: 'space', id: 'a' }], index: 0 }
  history = visitStop(history, { kind: 'overview' })
  history = visitStop(history, { kind: 'space', id: 'b' })
  assert.equal(visitStop(history, { kind: 'space', id: 'b' }), history)
  const back = stepStop(history, -1)!
  assert.deepEqual(back.stops[back.index], { kind: 'overview' })
  assert.equal(stepStop({ ...history, index: 0 }, -1), null)
  const branched = visitStop(back, { kind: 'space', id: 'c' })
  assert.deepEqual(branched.stops, [{ kind: 'space', id: 'a' }, { kind: 'overview' }, { kind: 'space', id: 'c' }])
  assert.equal(stepStop(branched, 1), null)
})

test('stops for vanished spaces are dropped without moving the current position', () => {
  const history: SpaceHistory = { stops: [{ kind: 'space', id: 'gone' }, { kind: 'overview' }, { kind: 'space', id: 'a' }], index: 2 }
  const next = dropMissingStops(history, new Set(['a']))
  assert.deepEqual(next, { stops: [{ kind: 'overview' }, { kind: 'space', id: 'a' }], index: 1 })
})

test('zoom gestures step once per notch or pinch, then rest until the glide lands', () => {
  const gesture = createZoomGesture(40, 380)
  assert.equal(gesture(12, 0), null)
  assert.equal(gesture(12, 10), null)
  assert.equal(gesture(20, 20), 'out')
  assert.equal(gesture(-120, 100), null)
  assert.equal(gesture(-120, 500), 'in')
})
