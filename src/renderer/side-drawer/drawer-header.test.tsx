import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { DrawerController } from './drawer-controller.ts'
import { DrawerHeader } from './drawer-header.tsx'

test('new agent shortcut exposes the same accessible and visible label', () => {
  const controller = {
    rows: [],
    newChat: () => {},
    openRow: async () => {},
    reportError: () => {}
  } as unknown as DrawerController
  const html = renderToStaticMarkup(createElement(DrawerHeader, { controller }))
  assert.match(html, /aria-label="New Agent"/)
  assert.match(html, /<span>New Agent<\/span>/)
  assert.doesNotMatch(html, /aria-label="New agent chat"/)
})
