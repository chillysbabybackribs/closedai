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

test('the continue action is offered on the latest completed response', () => {
  const html = render({
    item: answer,
    context: context({ continueInNewChat: async () => {} }),
    showContinue: true
  })

  assert.match(html, /data-ui="chat\.message-continue" data-ui-key="item-1"/)
  assert.doesNotMatch(html, /data-ui="chat\.message-continue"[^>]*disabled/)
  assert.match(html, /aria-label="Continue in new chat with fresh context"/)
})

test('the continue action is disabled while the chat is running', () => {
  const html = render({
    item: answer,
    context: context({ running: true, continueInNewChat: async () => {} }),
    showContinue: true
  })

  assert.match(html, /data-ui="chat\.message-continue"[^>]*disabled/)
})

test('earlier responses keep copy and branch without the continue action', () => {
  const html = render({
    item: answer,
    context: context({ continueInNewChat: async () => {} })
  })

  assert.match(html, /data-ui="chat\.message-copy"/)
  assert.match(html, /data-ui="chat\.message-branch"/)
  assert.doesNotMatch(html, /data-ui="chat\.message-continue"/)
})

// The regression this guards: the workspace stopped passing the continuation handler down, so the
// control silently disappeared from every response while the component itself still looked correct.
test('the continue action is absent when no continuation handler is wired in', () => {
  const html = render({ item: answer, context: context(), showContinue: true })

  assert.doesNotMatch(html, /data-ui="chat\.message-continue"/)
})
