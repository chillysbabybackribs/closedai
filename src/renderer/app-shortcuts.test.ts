import assert from 'node:assert/strict'
import test from 'node:test'

import { appShortcutForKey, targetRunningPaneId } from './app-shortcuts.ts'

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
  assert.equal(press('Escape'), 'pause-task')
})

test('unmodified and conflicting modified keys are left to the focused control', () => {
  assert.equal(press('h'), null)
  assert.equal(press('h', { ctrlKey: true, altKey: true }), null)
  assert.equal(press('n', { ctrlKey: true, shiftKey: true }), null)
  assert.equal(press('F11', { ctrlKey: true }), null)
  assert.equal(press('Escape', { ctrlKey: true }), null)
  assert.equal(press('Escape', { altKey: true }), null)
  assert.equal(press('Escape', { shiftKey: true }), null)
  assert.equal(press('Escape', { metaKey: true }), null)
  assert.equal(press('j', { ctrlKey: true }), null)
})

test('targetRunningPaneId identifies the running task to pause', () => {
  // Prefers currently selected pane when running
  assert.equal(targetRunningPaneId('pane-1', 'turn-1', { 'pane-2': { activeTurnId: 'turn-2' } }), 'pane-1')
  // Falls back to another running pane when selected pane is not running
  assert.equal(targetRunningPaneId('pane-1', null, { 'pane-1': { activeTurnId: null }, 'pane-2': { activeTurnId: 'turn-2' } }), 'pane-2')
  // Returns null when no pane has a running task
  assert.equal(targetRunningPaneId('pane-1', null, { 'pane-1': { activeTurnId: null }, 'pane-2': { activeTurnId: null } }), null)
  assert.equal(targetRunningPaneId('pane-1', null, null), null)
})
