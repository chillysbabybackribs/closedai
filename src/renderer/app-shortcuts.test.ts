import assert from 'node:assert/strict'
import test from 'node:test'

import { appShortcutForKey, escapePausesTask, targetRunningPaneId, type EscapeContext } from './app-shortcuts.ts'

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => appShortcutForKey({
  key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers
} as KeyboardEvent)

test('ctrl and meta match the implemented application commands', () => {
  assert.equal(press(',', { ctrlKey: true }), 'settings')
  assert.equal(press('h', { ctrlKey: true }), 'history')
  assert.equal(press('H', { metaKey: true }), 'history')
  assert.equal(press('n', { ctrlKey: true }), 'new-chat')
  assert.equal(press('W', { metaKey: true }), 'close-tab')
  assert.equal(press('w', { ctrlKey: true, shiftKey: true }), 'close-window')
  assert.equal(press('F11'), 'toggle-fullscreen')
  assert.equal(press('Escape'), 'pause-task')
  assert.equal(press('F12'), 'toggle-devtools')
  assert.equal(press('r', { ctrlKey: true }), 'reload')
  assert.equal(press('T', { ctrlKey: true, shiftKey: true }), 'tools')
  assert.equal(press('I', { ctrlKey: true, shiftKey: true }), 'trace')
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
  assert.equal(press('r', { ctrlKey: true, shiftKey: true }), null)
  assert.equal(press('F12', { shiftKey: true }), null)
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

const focus = (tagName: string, attributes: Record<string, string> = {}, isContentEditable = false) => ({
  tagName, isContentEditable, getAttribute: (name: string) => attributes[name] ?? null
})
const escapeContext = (overrides: Partial<EscapeContext> = {}): EscapeContext => ({
  overlayOpen: false, activeElement: null, soloActive: false, layoutBusy: false, ...overrides
})

test('Escape pauses the task from the composer, the transcript, or nothing focused', () => {
  assert.equal(escapePausesTask(escapeContext()), true)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('BODY') })), true)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('BUTTON') })), true)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('textarea', { 'data-ui': 'composer.input' }) })), true)
})

test('Escape is left to every other editable control', () => {
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('INPUT', { 'data-ui': 'titlebar.chat-search' }) })), false)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('input', { class: 'browser-omnibox-input' }) })), false)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('TEXTAREA') })), false)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('SELECT') })), false)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('DIV', {}, true) })), false)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('DIV', { contenteditable: '' }) })), false)
  assert.equal(escapePausesTask(escapeContext({ activeElement: focus('DIV', { contenteditable: 'false' }) })), true)
})

test('Escape is left to overlays and layout modes that already answer it', () => {
  assert.equal(escapePausesTask(escapeContext({ overlayOpen: true })), false)
  assert.equal(escapePausesTask(escapeContext({ soloActive: true })), false)
  assert.equal(escapePausesTask(escapeContext({ layoutBusy: true })), false)
})
