import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatTranscriptItem } from '../shared/chat.ts'
import { ChatTranscript } from './chat-transcript.tsx'

test('thinking is a chevron-free process line and stays collapsed while streaming', () => {
  const html = renderToStaticMarkup(createElement(ChatTranscript, {
    items: [
      { type: 'user', id: 'u', turnId: 't', text: 'Hi' },
      { type: 'reasoning', id: 'r', turnId: 't', text: 'secret plan', streaming: true }
    ],
    activeTurnId: 't'
  }))
  assert.match(html, /Thinking/)
  assert.doesNotMatch(html, /Thinking…/)
  assert.doesNotMatch(html, /lucide-chevron-down/)
  assert.doesNotMatch(html, /secret plan/)
})

test('an active turn without model output still shows the merged thinking line', () => {
  const html = renderToStaticMarkup(createElement(ChatTranscript, {
    items: [{ type: 'user', id: 'u', turnId: 't', text: 'Hi' }],
    activeTurnId: 't'
  }))
  assert.match(html, /Thinking/)
  assert.doesNotMatch(html, /lucide-chevron-down/)
})

test('consecutive commands collapse to a counted headline', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    {
      type: 'command', id: 'c1', turnId: 't', command: 'bash -lc "rg AGENTS.md"',
      cwd: '/', status: 'completed', output: '', exitCode: 0
    },
    {
      type: 'command', id: 'c2', turnId: 't', command: 'bash -lc "rg src"',
      cwd: '/', status: 'completed', output: '', exitCode: 0
    }
  ]
  const html = renderToStaticMarkup(createElement(ChatTranscript, { items, activeTurnId: null }))
  assert.match(html, /Ran 2 commands/)
  assert.match(html, /aria-label="Ran 2 commands, completed"/)
})
