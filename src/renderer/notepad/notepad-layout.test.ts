import assert from 'node:assert/strict'
import test from 'node:test'

import { BROWSER_PANE_ID, type ChatLayout } from '../chat-layout/layout-tree.js'
import { tabIds, tabOwner } from '../chat-layout/layout-tabs.js'
import { findWindow } from '../chat-layout/floating/window-layout.js'
import { noteIdOfTab, noteTabId, notepadChats, openNoteInTree, tileNoteIds, tileNotepadChat, withNotepadChat } from './notepad-layout.js'

const chatTile: ChatLayout = { kind: 'pane', id: 'chat-a', tabs: ['chat-a', 'chat-b'] }

test('the first note opens when every content window has been closed', () => {
  const tree = openNoteInTree({ kind: 'pane', id: BROWSER_PANE_ID }, 'n1', null, 'split-1')
  assert.deepEqual(tabIds(tree), [noteTabId('n1')])
  assert.ok(findWindow(tree, BROWSER_PANE_ID))
  assert.equal(findWindow(tree, noteTabId('n1'))?.float, undefined)
})

test('the first note opens in a floating window of its own and the chat tile keeps its front tab', () => {
  const tree = openNoteInTree(chatTile, 'n1', null, 'split-1')
  const tab = noteTabId('n1')
  assert.equal(noteIdOfTab(tab), 'n1')
  assert.equal(tabOwner(tree, 'chat-a'), 'chat-a')
  assert.equal(tabOwner(tree, tab), tab)
  assert.ok(findWindow(tree, tab)?.float)
})

test('later notes join the notepad window, and an open note is only selected', () => {
  let tree = openNoteInTree(chatTile, 'n1', null, 'split-1')
  tree = openNoteInTree(tree, 'n2', 'chat-a', 'split-2')
  assert.equal(tabOwner(tree, noteTabId('n2')), noteTabId('n2'))
  assert.deepEqual(tileNoteIds(tree, noteTabId('n1')), ['n1', 'n2'])
  tree = openNoteInTree(tree, 'n1', null, 'split-3')
  assert.equal(tabOwner(tree, noteTabId('n1')), noteTabId('n1'))
  assert.equal(tabIds(tree).length, 4)
})

test('the window keeps its chat while its notes change', () => {
  let tree = openNoteInTree(chatTile, 'n1', null, 'split-1')
  tree = withNotepadChat(tree, noteTabId('n1'), 'pad-chat')
  tree = openNoteInTree(tree, 'n2', noteTabId('n1'), 'split-2')
  assert.equal(tileNotepadChat(tree, noteTabId('n2')), 'pad-chat')
  assert.equal(tileNotepadChat(tree, noteTabId('n1')), 'pad-chat')
  assert.deepEqual(notepadChats(tree), ['pad-chat'])
  assert.deepEqual(notepadChats(withNotepadChat(tree, noteTabId('n2'), null)), [])
})

test('a new notepad window takes the tile `place` finds, and floats only when it finds none', () => {
  const placed = openNoteInTree(chatTile, 'n1', null, 'split-1', false,
    (tree, id) => ({ kind: 'split', id: 'auto', axis: 'vertical', ratio: 0.5, first: tree, second: { kind: 'pane', id } }))
  assert.equal(tabOwner(placed, noteTabId('n1')), noteTabId('n1'))
  assert.equal(findWindow(placed, noteTabId('n1'))?.float, undefined)
  assert.ok(findWindow(openNoteInTree(chatTile, 'n1', null, 'split-1', false, () => null), noteTabId('n1'))?.float)
})
