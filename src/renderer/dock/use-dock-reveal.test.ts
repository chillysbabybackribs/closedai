import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOCK_HEIGHT, HOLD_BAND } from './dock-model.js'
import { createDockReveal } from './use-dock-reveal.js'

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

test('starts hidden, reveals at the exact boundary, and cancels hiding on return', () => {
  const { dock, states, pending, flush } = fixture()
  dock.pointer(900 - DOCK_HEIGHT - 1, 900)
  assert.deepEqual(states, [])
  dock.pointer(900 - DOCK_HEIGHT, 900)
  assert.deepEqual(states, [true])
  dock.pointer(900 - HOLD_BAND, 900)
  assert.equal(pending.size, 0, 'small excursions above the dock stay open')
  dock.pointer(300, 900)
  dock.pointer(200, 900)
  assert.equal(pending.size, 1, 'leaving starts one hide delay')
  dock.pointer(899, 900)
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
  dock.pointer(100, 900)
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
  dock.pointer(899, 900)
  dock.hold(false)
  assert.equal(pending.size, 0)
  dock.leave()
  dock.dispose()
  flush()
  assert.deepEqual(states, [true])
})
