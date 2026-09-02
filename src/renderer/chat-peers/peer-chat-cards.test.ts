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

const idle: ChatPeerSummary = { ...peer, paneId: 'peer-c', title: 'Style cleanup', running: false, activity: null, updatedAt: 2 }

const third: ChatPeerSummary = { ...peer, paneId: 'peer-d', title: 'DB migration', running: false, activity: null, updatedAt: 3 }

test('no peer bar renders for an empty background list', () => {
  assert.equal(renderToStaticMarkup(createElement(PeerChatCards, { peers: [], onSelect: () => {} })), '')
})

test('renders primary peers as floating pills with title, status, and retire button', () => {
  const html = renderToStaticMarkup(createElement(PeerChatCards, {
    peers: [peer, idle],
    onSelect: () => {},
    onClose: () => {}
  }))
  assert.match(html, /aria-label="Peer chats"/)
  assert.match(html, /Background research/)
  assert.match(html, /Style cleanup/)
  assert.match(html, /aria-label="Running"/)
  assert.match(html, /title="Background research — Web search"/)
  assert.match(html, /title="Style cleanup"/)
  assert.match(html, /aria-label="Retire Background research to history"/)
  assert.match(html, /aria-label="Retire Style cleanup to history"/)
})

test('clusters 3+ peers with the +N more overflow trigger', () => {
  const html = renderToStaticMarkup(createElement(PeerChatCards, {
    peers: [peer, idle, third],
    onSelect: () => {},
    onClose: () => {}
  }))
  assert.match(html, /aria-label="Peer chats"/)
  assert.match(html, /\+1 more/)
  assert.match(html, /aria-label="1 more peer chats"/)
})
