import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChatRenameDialog } from './chat-rename-dialog.tsx'

test('ChatRenameDialog renders nothing when closed', () => {
  const html = renderToStaticMarkup(createElement(ChatRenameDialog, {
    open: false,
    chatId: 'chat-1',
    currentTitle: 'My Project Chat',
    onClose: () => {},
    onSave: async () => {}
  }))
  assert.equal(html, '')
})

test('ChatRenameDialog renders form elements and controls when open', () => {
  const html = renderToStaticMarkup(createElement(ChatRenameDialog, {
    open: true,
    chatId: 'chat-1',
    currentTitle: 'My Project Chat',
    onClose: () => {},
    onSave: async () => {}
  }))
  assert.match(html, /data-ui="chat\.rename-dialog"/)
  assert.match(html, /Rename conversation/)
  assert.match(html, /data-ui="chat\.rename-input"/)
  assert.match(html, /value="My Project Chat"/)
  assert.match(html, /data-ui="chat\.rename-reset"/)
  assert.match(html, /Reset to default/)
  assert.match(html, /data-ui="chat\.rename-cancel"/)
  assert.match(html, /data-ui="chat\.rename-save"/)
})
