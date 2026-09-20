import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChatRenameDialog, ChatRenameForm } from './chat-rename-dialog.tsx'

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

test('ChatRenameForm renders input and action buttons with values', () => {
  const html = renderToStaticMarkup(createElement(ChatRenameForm, {
    chatId: 'chat-1',
    currentTitle: 'My Project Chat',
    onClose: () => {},
    onSave: async () => {}
  }))
  assert.match(html, /data-ui="chat\.rename-input"/)
  assert.match(html, /value="My Project Chat"/)
  assert.match(html, /data-ui="chat\.rename-reset"/)
  assert.match(html, /Reset to default/)
  assert.match(html, /data-ui="chat\.rename-cancel"/)
  assert.match(html, /data-ui="chat\.rename-save"/)
})
