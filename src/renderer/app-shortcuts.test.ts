import assert from 'node:assert/strict'
import test from 'node:test'

import { appShortcutForKey } from './app-shortcuts.ts'

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => appShortcutForKey({
  key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers
} as KeyboardEvent)

test('ctrl and meta match the implemented application commands', () => {
  assert.equal(press(',', { ctrlKey: true }), 'settings')
  assert.equal(press('h', { ctrlKey: true }), 'history')
  assert.equal(press('H', { metaKey: true }), 'history')
  assert.equal(press('n', { ctrlKey: true }), 'new-chat')
  assert.equal(press('W', { metaKey: true }), 'close-window')
  assert.equal(press('F11'), 'toggle-fullscreen')
})

test('unmodified and conflicting modified keys are left to the focused control', () => {
  assert.equal(press('h'), null)
  assert.equal(press('h', { ctrlKey: true, altKey: true }), null)
  assert.equal(press('n', { ctrlKey: true, shiftKey: true }), null)
  assert.equal(press('F11', { ctrlKey: true }), null)
  assert.equal(press('j', { ctrlKey: true }), null)
})
