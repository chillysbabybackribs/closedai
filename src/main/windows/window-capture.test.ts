import assert from 'node:assert/strict'
import test from 'node:test'
import { captureRect } from './window-capture.ts'

test('a page region is scaled by the page zoom into window coordinates', () => {
  assert.deepEqual(captureRect({ x: 0, y: 34.4, width: 1280, height: 700.2 }, 1), { x: 0, y: 34, width: 1280, height: 700 })
  assert.deepEqual(captureRect({ x: 10, y: 20, width: 100, height: 50 }, 1.25), { x: 13, y: 25, width: 125, height: 63 })
})

test('an empty or malformed region captures nothing', () => {
  assert.equal(captureRect({ x: 0, y: 0, width: 0, height: 10 }, 1), null)
  assert.equal(captureRect({ x: 0, y: 0, width: Number.NaN, height: 10 }, 1), null)
  assert.equal(captureRect(null as never, 1), null)
})
