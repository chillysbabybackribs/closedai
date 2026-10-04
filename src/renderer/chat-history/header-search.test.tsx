import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'

import { HeaderChatSearch } from './header-search.tsx'
import type { HistoryController } from './history-controller.js'

const controller = {
  reviewQueue: { queue: [], dismiss: () => {}, promote: () => {} },
  error: null
} as unknown as HistoryController

test('card thread search shows the full centred field', () => {
  const html = renderToStaticMarkup(createElement(HeaderChatSearch, {
    chats: [],
    controller,
    activeChatId: null,
    variant: 'card',
    paneKey: 'pane-a'
  }))
  assert.match(html, /placeholder="Search chats"/)
  assert.match(html, /data-ui="titlebar\.chat-search"/)
  assert.doesNotMatch(html, /header-chat-search-reveal/)
})

test('titlebar thread search keeps the full field visible', () => {
  const html = renderToStaticMarkup(createElement(HeaderChatSearch, {
    chats: [],
    controller,
    activeChatId: null,
    variant: 'titlebar'
  }))
  assert.match(html, /placeholder="Search chats"/)
  assert.doesNotMatch(html, /header-chat-search-reveal/)
})
