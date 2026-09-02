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

const idle: ChatPeerSummary = { ...peer, paneId: 'peer-c', title: 'Style cleanup', running: false, activity: null }

test('no peer bar renders for an empty background list', () => {
  assert.equal(renderToStaticMarkup(createElement(PeerChatCards, { peers: [], onSelect: () => {} })), '')
})

test('the collapsed bar summarizes peer and running counts', () => {
  const html = renderToStaticMarkup(createElement(PeerChatCards, { peers: [peer, idle], onSelect: () => {} }))
  assert.match(html, /aria-label="Peer chats"/)
  assert.match(html, /2 peer chats/)
  assert.match(html, /1 running/)
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /Background research/)
})

test('the expanded bar lists each peer with its title and activity', () => {
  const html = renderToStaticMarkup(createElement(PeerChatCards, { peers: [peer, idle], onSelect: () => {}, defaultOpen: true }))
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /Background research/)
  assert.match(html, /Web search/)
  assert.match(html, /Style cleanup/)
  assert.match(html, /Claude Code/)
  assert.match(html, /aria-label="Running"/)
})
