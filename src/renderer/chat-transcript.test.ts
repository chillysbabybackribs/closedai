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

test('thinking stays visible while tool calls stream on the same turn', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    {
      type: 'command', id: 'c1', turnId: 't', command: 'bash -lc "rg AGENTS.md"',
      cwd: '/', status: 'inProgress', output: '', exitCode: null
    }
  ]
  const html = renderToStaticMarkup(createElement(ChatTranscript, { items, activeTurnId: 't' }))
  assert.match(html, /Thinking/)
  assert.match(html, /rg AGENTS.md/)
})
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    { type: 'tool', id: 's1', turnId: null, label: 'Web search', detail: 'q1', status: 'completed' },
    { type: 'assistant', id: 'a0', turnId: 't', text: '', phase: null, streaming: true },
    { type: 'tool', id: 's2', turnId: 't', label: 'Web search', detail: 'q2', status: 'completed' }
  ]
  const html = renderToStaticMarkup(createElement(ChatTranscript, { items, activeTurnId: 't' }))
  assert.match(html, /Web search 2/)
  assert.match(html, /aria-label="Web search 2, completed"/)
})
