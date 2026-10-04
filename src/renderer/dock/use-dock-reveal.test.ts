import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDockReveal } from './use-dock-reveal.js'

const bounds = { left: 400, top: 820, right: 800, bottom: 900 }

function fixture() {
  const states: boolean[] = []
  const pending = new Set<() => void>()
  const dock = createDockReveal((shown) => states.push(shown), (hide) => {
    pending.add(hide)
    return () => { pending.delete(hide) }
  })
  return { dock, states, pending, flush() {
    for (const hide of [...pending]) { pending.delete(hide); hide() }
  } }
}

test('starts hidden, reveals only over the dock box, and hides when the pointer leaves', () => {
  const { dock, states, pending, flush } = fixture()
  dock.pointer(600, 850, bounds)
  assert.deepEqual(states, [true])
  dock.pointer(900, 850, bounds)
  assert.equal(pending.size, 1, 'leaving the box starts one hide delay')
  dock.pointer(600, 850, bounds)
  flush()
  assert.deepEqual(states, [true], 're-entry cancels the pending hide')
  dock.leave()
  flush()
  assert.deepEqual(states, [true, false])
})

test('menus and keyboard focus hold the dock until released outside the band', () => {
  const { dock, states, pending, flush } = fixture()
  dock.hold(true)
  assert.deepEqual(states, [true], 'keyboard focus can reveal without pointer movement')
  dock.pointer(100, 100, bounds)
  dock.leave()
  assert.equal(pending.size, 0)
  dock.hold(false)
  assert.equal(pending.size, 1)
  dock.hold(true)
  flush()
  assert.deepEqual(states, [true], 'opening a menu cancels an existing delay')
  dock.hold(false)
  flush()
  assert.deepEqual(states, [true, false])
})

test('closing a menu over the dock keeps it visible; unmount cancels pending work', () => {
  const { dock, states, pending, flush } = fixture()
  dock.hold(true)
  dock.pointer(600, 850, bounds)
  dock.hold(false)
  assert.equal(pending.size, 0)
  dock.leave()
  dock.dispose()
  flush()
  assert.deepEqual(states, [true])
})
