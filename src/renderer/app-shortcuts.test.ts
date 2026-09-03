import assert from 'node:assert/strict'
import test from 'node:test'

import { appShortcutForKey } from './app-shortcuts.ts'

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => appShortcutForKey({
  key, altKey: false, ctrlKey: false, metaKey: false, ...modifiers
} as KeyboardEvent)

test('ctrl and meta open settings and toggle chat history', () => {
  assert.equal(press(',', { ctrlKey: true }), 'settings')
  assert.equal(press('h', { ctrlKey: true }), 'history')
  assert.equal(press('H', { metaKey: true }), 'history')
})

test('unmodified and alt-modified keys are left to the focused control', () => {
  assert.equal(press('h'), null)
  assert.equal(press('h', { ctrlKey: true, altKey: true }), null)
  assert.equal(press('j', { ctrlKey: true }), null)
})
