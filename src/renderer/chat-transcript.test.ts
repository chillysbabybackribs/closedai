import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageScrollerProvider } from '../components/ui/message-scroller.tsx'
import type { ChatTranscriptItem } from '../shared/chat.ts'
import { ChatTranscript } from './chat-transcript.tsx'

function renderTranscript(props: { items: ChatTranscriptItem[] }): string {
  return renderToStaticMarkup(createElement(MessageScrollerProvider, null, createElement(ChatTranscript, props) as ReactNode))
}

test('reasoning never reaches the transcript, not even as a label', () => {
  const html = renderTranscript({
    items: [
      { type: 'user', id: 'u', turnId: 't', text: 'Hi' },
      { type: 'reasoning', id: 'r', turnId: 't', text: 'secret plan', streaming: true },
      { type: 'plan', id: 'p', turnId: 't', text: 'step one', streaming: false }
    ]
  })
  assert.doesNotMatch(html, /secret plan/)
  assert.doesNotMatch(html, /step one/)
  assert.doesNotMatch(html, /Thinking|Thought/)
})

test('an active turn without model output renders only the user prompt', () => {
  const html = renderTranscript({
    items: [{ type: 'user', id: 'u', turnId: 't', text: 'Hi' }]
  })
  assert.match(html, /Hi/)
  assert.doesNotMatch(html, /Thinking|Thought/)
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
  const html = renderTranscript({ items })
  assert.match(html, /Searched 2 times/)
  assert.match(html, /aria-label="Searched 2 times, completed"/)
})

test('a streaming tool call is the first thing shown after the prompt', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    {
      type: 'command', id: 'c1', turnId: 't', command: 'bash -lc "rg AGENTS.md"',
      cwd: '/', status: 'inProgress', output: '', exitCode: null
    }
  ]
  const html = renderTranscript({ items })
  assert.match(html, /Searched for AGENTS.md/)
})

test('user turns are scroller rows and attachments render as attachment cards', () => {
  const html = renderTranscript({
    items: [{
      type: 'user',
      id: 'u',
      turnId: 't',
      text: 'See this',
      attachments: [{ id: 'a1', kind: 'file', name: 'notes.md' }]
    }]
  })
  assert.match(html, /data-slot="message-scroller-item"/)
  assert.doesNotMatch(html, /data-scroll-anchor="true"/)
  assert.match(html, /data-slot="attachment"/)
  assert.match(html, /notes\.md/)
})

test('identically named tool calls collapse to a counted label', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    { type: 'tool', id: 's1', turnId: null, label: 'Web search', detail: 'q1', status: 'completed' },
    { type: 'assistant', id: 'a0', turnId: 't', text: '', phase: null, streaming: true },
    { type: 'tool', id: 's2', turnId: 't', label: 'Web search', detail: 'q2', status: 'completed' }
  ]
  const html = renderTranscript({ items })
  assert.match(html, /Searched the web 2 times/)
  assert.match(html, /aria-label="Searched the web 2 times, completed"/)
})

test('long transcripts initially mount only the latest bounded window', () => {
  const items: ChatTranscriptItem[] = Array.from({ length: 250 }, (_, index) => ({
    type: 'user', id: `u${index}`, turnId: `t${index}`, text: `Message ${index}`
  }))
  const html = renderTranscript({ items })
  assert.match(html, /130 earlier entries/)
  assert.doesNotMatch(html, /Message 129</)
  assert.match(html, /Message 130</)
  assert.match(html, /Message 249</)
  assert.equal((html.match(/data-slot="message-scroller-item"/g) ?? []).length, 120)
})
