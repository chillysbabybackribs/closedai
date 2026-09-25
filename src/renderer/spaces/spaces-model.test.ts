import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IDENTITY_CAMERA, LABEL_HEIGHT, anchorChat, createZoomGesture, dropMissingStops, focusCamera, liveTransform, overviewSlots,
  newSpace, readSpaces, resolveCurrent, saveSpaces, slotAt, spaceName, stepStop, visitStop, type Space, type SpaceHistory
} from './spaces-model.ts'

const size = { width: 1200, height: 800 }

const a: Space = { id: '/p/a', cwd: '/p/a', projectPath: '/p/a', name: 'a' }
const a2: Space = { id: 'space:2', cwd: '/p/a', projectPath: '/p/a', name: 'a 2' }
const b: Space = { id: '/p/b', cwd: '/p/b', projectPath: '/p/b', name: 'b' }

test('the current space is the remembered one in main\'s folder, else the first there, else a new one', () => {
  assert.equal(resolveCurrent([a, a2, b], 'space:2', { cwd: '/p/a', projectPath: '/p/a' }).current, a2)
  // A remembered space in another folder than main shows is not current (main switched project).
  assert.equal(resolveCurrent([a, a2, b], 'space:2', { cwd: '/p/b', projectPath: '/p/b' }).current, b)
  assert.equal(resolveCurrent([a, a2, b], null, { cwd: '/p/a', projectPath: '/p/a' }).current, a)
  // A first launch, or a switch into a folder no space uses, adds a space named after the folder.
  const fresh = resolveCurrent([a], null, { cwd: '/p/c', projectPath: '/p/c' })
  assert.deepEqual(fresh.current, { id: '/p/c', cwd: '/p/c', projectPath: '/p/c', name: 'c' })
  assert.deepEqual(fresh.spaces.map((space) => space.id), ['/p/a', '/p/c'])
})

test('a new space takes its folder\'s name, numbered when that name is taken', () => {
  const workspace = { cwd: '/p/a', projectPath: '/p/a' }
  assert.equal(newSpace([b], workspace, 'x').name, 'a')
  assert.equal(newSpace([a, b], workspace, 'x').name, 'a 2')
  assert.deepEqual(newSpace([a, a2], workspace, 'x'), { id: 'x', cwd: '/p/a', projectPath: '/p/a', name: 'a 3' })
})

test('a space is entered on a chat of its own: one in front of a tile, else one behind', () => {
  const tree = { kind: 'split' as const, id: 's', axis: 'horizontal' as const, ratio: 0.5,
    first: { kind: 'pane' as const, id: 'closedai:view:history:1', tabs: ['closedai:view:history:1', 'c1'] },
    second: { kind: 'pane' as const, id: 'c2', tabs: ['c2', 'c3'] } }
  assert.equal(anchorChat(tree, new Set(['c1', 'c2', 'c3'])), 'c2')
  assert.equal(anchorChat(tree, new Set(['c1', 'c3'])), 'c1')
  assert.equal(anchorChat(tree, new Set()), null)
  assert.equal(anchorChat(null, new Set(['c1'])), null)
})

test('space names use the folder name, and the home workspace is Home', () => {
  assert.equal(spaceName('/home/dp/Desktop/closedai/', '/home/dp/Desktop/closedai'), 'closedai')
  assert.equal(spaceName('/home/dp', null), 'Home')
})

test('saved spaces survive a round trip, and entries from before ids use their folder', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  saveSpaces(storage, { spaces: [a, a2], current: 'space:2' })
  assert.deepEqual(readSpaces(storage), { spaces: [a, a2], current: 'space:2' })
  store.set('closedai.spaces.v2', '{"spaces":[1,{"cwd":"/p/x","projectPath":"/p/x"},{"cwd":""},null,{"cwd":"/p/x"}]}')
  assert.deepEqual(readSpaces(storage), { spaces: [{ id: '/p/x', cwd: '/p/x', projectPath: '/p/x', name: 'x' }], current: null })
  store.set('closedai.spaces.v2', 'not json')
  assert.deepEqual(readSpaces(storage), { spaces: [], current: null })
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
