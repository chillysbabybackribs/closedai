import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatPeerSummary } from '../../shared/chat-peers.ts'
import { PeerChatCards } from './peer-chat-cards.tsx'

const peer: ChatPeerSummary = {
  paneId: 'peer-b',
  parentPaneId: null,
  kind: 'peer',
  provider: 'claude',
  threadId: 'claude:session',
  title: 'Background research',
  preview: 'Reading docs',
  running: true,
  activity: 'Web search',
  updatedAt: 1
}

test('no peer cards render for an empty background list', () => {
  assert.equal(renderToStaticMarkup(createElement(PeerChatCards, { peers: [], onSelect: () => {} })), '')
})

test('running peer cards expose their title and activity', () => {
  const html = renderToStaticMarkup(createElement(PeerChatCards, { peers: [peer], onSelect: () => {} }))
  assert.match(html, /aria-label="Peer chats"/)
  assert.match(html, /Background research/)
  assert.match(html, /Web search/)
  assert.match(html, /aria-label="Running"/)
})
