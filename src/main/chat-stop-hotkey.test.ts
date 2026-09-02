import assert from 'node:assert/strict'
import test from 'node:test'
import { isStopHotkey } from './chat-stop-hotkey.js'

const escapeKeyDown = {
  type: 'keyDown',
  key: 'Escape',
  isAutoRepeat: false,
  isComposing: false
}

test('recognizes a single Escape keydown as the stop hotkey', () => {
  assert.equal(isStopHotkey(escapeKeyDown), true)
})

test('ignores keyup, held keys, composition, and other keys', () => {
  assert.equal(isStopHotkey({ ...escapeKeyDown, type: 'keyUp' }), false)
  assert.equal(isStopHotkey({ ...escapeKeyDown, isAutoRepeat: true }), false)
  assert.equal(isStopHotkey({ ...escapeKeyDown, isComposing: true }), false)
  assert.equal(isStopHotkey({ ...escapeKeyDown, key: 'Enter' }), false)
})
