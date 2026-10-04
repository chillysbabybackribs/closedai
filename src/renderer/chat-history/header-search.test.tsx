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

test('card thread search shows its title trigger without a native tooltip or an idle search field', () => {
  const html = renderToStaticMarkup(createElement(HeaderChatSearch, {
    chats: [],
    controller,
    activeChatId: null,
    variant: 'card',
    paneKey: 'pane-a',
    title: 'Full chat title'
  }))
  assert.match(html, /data-ui="titlebar\.chat-history-toggle"/)
  assert.match(html, /<span>Full chat title<\/span>/)
  assert.match(html, /aria-label="Search chats and open chat history: Full chat title"/)
  assert.doesNotMatch(html, / title=/)
  assert.doesNotMatch(html, /placeholder="Search chats"/)
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
