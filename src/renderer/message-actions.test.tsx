import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageActions, type MessageActionContext } from './message-actions.tsx'
import type { ChatTranscriptItem } from '../shared/chat.ts'

const answer = {
  id: 'item-1',
  type: 'assistant',
  text: 'Done.',
  createdAt: 1_700_000_000_000
} as Extract<ChatTranscriptItem, { type: 'assistant' }>

function context(overrides: Partial<MessageActionContext> = {}): MessageActionContext {
  return { threadKey: 'thread-1', running: false, branch: async () => {}, ...overrides }
}

function render(props: Parameters<typeof MessageActions>[0]): string {
  return renderToStaticMarkup(createElement(MessageActions, props))
}

test('response actions offer copy and branch only', () => {
  const html = render({ item: answer, context: context() })
  assert.match(html, /data-ui="chat\.message-copy"/)
  assert.match(html, /data-ui="chat\.message-branch"/)
  assert.doesNotMatch(html, /data-ui="chat\.message-continue"/)
})

test('branch is disabled while the chat is running', () => {
  const html = render({ item: answer, context: context({ running: true }) })
  assert.match(html, /data-ui="chat\.message-branch"[^>]*disabled/)
})
