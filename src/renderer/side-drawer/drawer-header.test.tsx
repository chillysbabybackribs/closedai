import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChatController } from '../chat-controller.ts'
import { DrawerHeader } from './drawer-header.tsx'

test('new agent shortcut exposes the same accessible and visible label', () => {
  const chat = { newThread: async () => {} } as ChatController
  const html = renderToStaticMarkup(createElement(DrawerHeader, { chat, rows: [] }))
  assert.match(html, /aria-label="New Agent"/)
  assert.match(html, /<span>New Agent<\/span>/)
  assert.doesNotMatch(html, /aria-label="New agent chat"/)
})
