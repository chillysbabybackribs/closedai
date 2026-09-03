import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageScrollerProvider } from '../components/ui/message-scroller.tsx'
import type { ChatTranscriptItem } from '../shared/chat.ts'
import { ChatTranscript } from './chat-transcript.tsx'

function renderTranscript(props: ComponentProps<typeof ChatTranscript>): string {
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
  assert.match(html, /Searching for AGENTS.md/)
  assert.match(html, /aria-label="Searching for AGENTS.md, running"/)
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
  assert.match(html, /data-scroll-anchor="true"/)
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

test('opening a long transcript paints one screenful, with the rest behind the fold', () => {
  const items: ChatTranscriptItem[] = Array.from({ length: 250 }, (_, index) => ({
    type: 'user', id: `u${index}`, turnId: `t${index}`, text: `Message ${index}`
  }))
  // The window grows to its full bound on idle frames after this first paint.
  const html = renderTranscript({ items })
  assert.match(html, /226 earlier entries/)
  assert.doesNotMatch(html, /Message 225</)
  assert.match(html, /Message 226</)
  assert.match(html, /Message 249</)
  assert.equal((html.match(/data-slot="message-scroller-item"/g) ?? []).length, 24)
})


test('response actions appear once per completed turn, never between model messages and tools', () => {
  const actions = { threadKey: 'thread', running: true, branch: async () => {} }
  const items: ChatTranscriptItem[] = [
    { type: 'assistant', id: 'old', turnId: 'old-turn', text: 'Earlier answer', phase: null, streaming: false },
    { type: 'user', id: 'u', turnId: 'turn', text: 'Do the task' },
    { type: 'assistant', id: 'progress', turnId: 'turn', text: 'Let me verify', phase: null, streaming: false },
    { type: 'tool', id: 'tool', turnId: 'turn', label: 'Run', detail: '', status: 'completed' },
    { type: 'assistant', id: 'final', turnId: 'turn', text: 'Done', phase: null, streaming: false }
  ]
  const running = renderTranscript({ items, activeTurnId: 'turn', actions })
  assert.equal((running.match(/data-ui="chat.message-copy"/g) ?? []).length, 1)
  assert.doesNotMatch(running, /data-ui="chat.message-copy" data-ui-key="(?:progress|final)"/)
  const completed = renderTranscript({ items, activeTurnId: null, actions: { ...actions, running: false } })
  assert.equal((completed.match(/data-ui="chat.message-copy"/g) ?? []).length, 2)
  assert.match(completed, /data-ui="chat.message-copy" data-ui-key="final"/)
  assert.doesNotMatch(completed, /data-ui="chat.message-copy" data-ui-key="progress"/)
})

test('missing turn ids still yield one action row per user turn and none on the running tail', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: null, text: 'First' },
    { type: 'assistant', id: 'a1', turnId: null, text: 'First answer', phase: null, streaming: false },
    { type: 'user', id: 'u2', turnId: null, text: 'Second' },
    { type: 'assistant', id: 'a2', turnId: null, text: 'Progress', phase: null, streaming: false },
    { type: 'assistant', id: 'a3', turnId: null, text: 'Second answer', phase: null, streaming: false }
  ]
  const actions = { threadKey: 'thread', running: false, branch: async () => {} }
  const completed = renderTranscript({ items, actions })
  assert.equal((completed.match(/data-ui="chat.message-copy"/g) ?? []).length, 2)
  assert.doesNotMatch(completed, /data-ui="chat.message-copy" data-ui-key="a2"/)
  const running = renderTranscript({ items, actions: { ...actions, running: true } })
  assert.equal((running.match(/data-ui="chat.message-copy"/g) ?? []).length, 1)
})

test('background group shows live task details and collapses once completed', () => {
  const task: ChatTranscriptItem = {
    type: 'tool', id: 'bg', turnId: 't', label: 'Review adapters', detail: 'Inspect events',
    status: 'inProgress', background: { taskId: 'bg', kind: 'agent', progress: 'Reading SDK events' }
  }
  const running = renderTranscript({ items: [task], activeTurnId: 't' })
  assert.match(running, /Background work/)
  assert.match(running, /Reading SDK events/)
  assert.match(running, /Review adapters/)
  const completed = renderTranscript({ items: [{ ...task, status: 'completed', output: 'All checked' }] })
  assert.match(completed, /1 background task finished/)
  assert.match(completed, /aria-expanded="false"/)
})
