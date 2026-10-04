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

test('a compacted activity headline does not dump a file path', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    {
      type: 'fileChange', id: 'f1', turnId: 't', status: 'completed',
      changes: [{ path: '/home/dp/Desktop/closedai/src/a.ts', kind: 'update', diff: '+a' }]
    },
    {
      type: 'tool', id: 'r1', turnId: 't', label: 'Read src/renderer/titlebar-menu.tsx (79 - 103)',
      detail: '/home/dp/Desktop/closedai/src/renderer/titlebar-menu.tsx', status: 'inProgress'
    }
  ]
  const html = renderTranscript({ items, activeTurnId: 't' })
  assert.match(html, /Editing 1 file, Reading file/)
  // The live step keeps the full path for hover only, as the opened step list does.
  const shown = html.replace(/ title="[^"]*"/g, '')
  assert.doesNotMatch(shown, /src\/renderer\/titlebar-menu|home\/dp\/Desktop/)
})

test('an activity row with edits shows its line counts at the right end, and one without shows none', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    {
      type: 'fileChange', id: 'f1', turnId: 't', status: 'completed',
      changes: [{ path: 'src/a.ts', kind: 'update', diff: '--- a/src/a.ts\n+++ b/src/a.ts\n+a\n+b\n-c' }]
    },
    { type: 'command', id: 'c1', turnId: 't', command: 'npm test', cwd: '/', status: 'completed', output: '', exitCode: 0 }
  ]
  const html = renderTranscript({ items })
  assert.match(html, /class="prompt-tool-activity-head"[^>]*>[\s\S]*class="prompt-tool-activity-lines"[^>]*>[\s\S]*\+<span[^>]*>2<\/span>[\s\S]*−<span[^>]*>1<\/span>/)
  assert.match(html, /aria-label="Edited 1 file, Ran tests, 2 lines added, 1 removed, completed"/)
  const plain = renderTranscript({ items: [items[0]!, items[2]!] })
  assert.doesNotMatch(plain, /prompt-tool-activity-lines/)
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

test('opening a transcript renders every loaded turn without a reveal ceiling', () => {
  const items: ChatTranscriptItem[] = Array.from({ length: 250 }, (_, index) => ({
    type: 'user', id: `u${index}`, turnId: `t${index}`, text: `Message ${index}`
  }))
  const html = renderTranscript({ items })
  assert.doesNotMatch(html, /data-ui="chat\.show-earlier"/)
  assert.match(html, /Message 0/)
  assert.match(html, /Message 248/)
  assert.match(html, /Message 249/)
  assert.equal((html.match(/data-slot="message-scroller-item"/g) ?? []).length, 250)
})

test('a reopened transcript keeps earlier replies visible', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'First' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'First answer', phase: null, streaming: false },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Second' },
    { type: 'assistant', id: 'a2', turnId: 't2', text: 'Second answer', phase: null, streaming: false }
  ]
  const html = renderTranscript({ items })
  assert.match(html, /Second/)
  assert.match(html, /First answer/)
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

test('background group stays collapsed while running and once completed', () => {
  const task: ChatTranscriptItem = {
    type: 'tool', id: 'bg', turnId: 't', label: 'Review adapters', detail: 'Inspect events',
    status: 'inProgress', background: { taskId: 'bg', kind: 'agent', progress: 'Reading SDK events' }
  }
  const running = renderTranscript({ items: [task], activeTurnId: 't' })
  assert.match(running, /activity-live-verb">Running<\/span> 1 subagent in the background/)
  assert.match(running, /0 of 1 done/)
  assert.match(running, /aria-expanded="false"/)
  assert.doesNotMatch(running, /Reading SDK events/)
  const completed = renderTranscript({ items: [{ ...task, status: 'completed', output: 'All checked' }] })
  assert.match(completed, /Ran 1 subagent in the background/)
  assert.match(completed, /aria-expanded="false"/)
})

test('a settled turn shows only its header and answer; the live turn counts up over its steps', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    { type: 'assistant', id: 'n', turnId: 't', text: 'Checking the build.', phase: null, streaming: false },
    { type: 'command', id: 'c1', turnId: 't', command: 'npm run build', cwd: '/', status: 'completed', output: '', exitCode: 0, startedAt: 0, finishedAt: 38_000 },
    { type: 'screenshot', id: 's1', turnId: 't', imageUrl: 'data:,', surface: 'app_window', caption: '' },
    { type: 'assistant', id: 'a', turnId: 't', text: 'All good.', phase: null, streaming: false }
  ]
  const settled = renderTranscript({ items })
  assert.match(settled, /data-ui="chat.turn-steps"[^>]*aria-expanded="false"[^>]*><span>Worked for 38s/)
  assert.match(settled, /All good\./)
  assert.doesNotMatch(settled, /Checking the build|npm run build|prompt-shot/)
  const live = renderTranscript({ items: items.slice(0, 4), activeTurnId: 't' })
  assert.match(live, /class="prompt-turn-head" data-live="true" role="status">Working/)
  assert.match(live, /Checking the build/)
  assert.match(live, /class="prompt-shot-strip"><button[^>]*data-ui="chat.screenshot" data-ui-key="s1"/)
  assert.equal((live.match(/data-ui-key="s1"/g) ?? []).length, 1)
  assert.match(live, /<\/div><\/div><div class="prompt-shot-strip">/,
    'the screenshot strip follows the closed rolling slot instead of inheriting its fade')
})

test('a live turn shows one stage row: the newest text above the newest step, nothing earlier', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'Go' },
    { type: 'assistant', id: 'n1', turnId: 't', text: 'Looking around first.', phase: null, streaming: false },
    { type: 'command', id: 'c1', turnId: 't', command: 'ls', cwd: '/', status: 'completed', output: '', exitCode: 0 },
    { type: 'assistant', id: 'n2', turnId: 't', text: 'Running the suite now.', phase: null, streaming: false },
    { type: 'command', id: 'c2', turnId: 't', command: 'npm test', cwd: '/', status: 'inProgress', output: '', exitCode: null }
  ]
  const html = renderTranscript({ items, activeTurnId: 't' })
  assert.equal((html.match(/class="turn-stage"/g) ?? []).length, 1)
  assert.doesNotMatch(html, /Looking around first/)
  assert.ok(html.indexOf('Running the suite now.') < html.indexOf('npm test'))
  assert.match(html, /class="turn-stage-slot turn-stage-text"/)
})
