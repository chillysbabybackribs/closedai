import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatSnapshot, ChatTranscriptItem } from '../../shared/chat.js'
import { initialChatState } from '../chat-state.js'
import { quickChatFeed } from './quick-chat-feed.js'

function snapshot(items: ChatTranscriptItem[], activeTurnId: string | null = null): ChatSnapshot {
  return { ...initialChatState(), items, activeTurnId }
}

const user = (id: string): ChatTranscriptItem => ({ type: 'user', id, turnId: 't', text: 'find the box score' })
const tool = (id: string, label: string, status: string): ChatTranscriptItem =>
  ({ type: 'tool', id, turnId: 't', label, detail: '', status })
const assistant = (id: string, text: string): ChatTranscriptItem =>
  ({ type: 'assistant', id, turnId: 't', text, phase: 'final_answer', streaming: false })

test('an unused chat has nothing to follow', () => {
  assert.deepEqual(quickChatFeed(snapshot([])), { status: 'idle', lines: [], reply: null })
})

test('a working turn lists its latest steps, the live one last', () => {
  const feed = quickChatFeed(snapshot([
    user('u1'), assistant('a0', 'old'), user('u2'),
    tool('s1', 'closedai_app · state', 'completed'),
    tool('s2', 'closedai_app · state', 'completed'),
    tool('s3', 'embedded_browser · page', 'failed'),
    tool('s4', 'embedded_browser · page', 'inProgress')
  ], 't'))
  assert.equal(feed.status, 'working')
  assert.deepEqual(feed.lines.map((line) => [line.id, line.state]), [['s2', 'done'], ['s3', 'failed'], ['s4', 'live']])
  assert.ok(feed.lines.every((line) => line.text.length > 0))
  assert.equal(feed.reply, null)
})

test('a working turn with no live step says it is still working', () => {
  const feed = quickChatFeed(snapshot([user('u1'), tool('s1', 'closedai_app · state', 'completed')], 't'))
  assert.deepEqual(feed.lines.at(-1), { id: 'working', text: 'Working', state: 'live' })
  const thinking = quickChatFeed(snapshot([user('u1'), { type: 'reasoning', id: 'r', turnId: 't', text: '', streaming: true }], 't'))
  assert.deepEqual(thinking.lines.map((line) => line.text), ['Thinking'])
})

test('a finished turn keeps its steps and previews the reply as plain text', () => {
  const feed = quickChatFeed(snapshot([
    user('u1'), tool('s1', 'closedai_app · state', 'completed'),
    assistant('a1', '**Dodgers** lead 3–1. See [the box score](https://espn.com/x).\n\n```js\nx\n```')
  ]))
  assert.equal(feed.status, 'done')
  assert.equal(feed.reply, 'Dodgers lead 3–1. See the box score.')
})

test('an error notice fails the turn and becomes its reply', () => {
  const feed = quickChatFeed(snapshot([user('u1'), { type: 'notice', id: 'n', turnId: 't', text: 'The provider stopped', tone: 'error' }]))
  assert.equal(feed.status, 'failed')
  assert.equal(feed.reply, 'The provider stopped')
})

test('page steps read as plain words, whatever the lane calls the tool', () => {
  const feed = quickChatFeed(snapshot([
    user('u1'),
    { type: 'tool', id: 's1', turnId: 't', label: 'Tool search', detail: 'select:mcp__embedded_browser__script', status: 'completed' },
    { type: 'tool', id: 's2', turnId: 't', label: 'embedded_browser · page', detail: '{\n  "action": "navigate",\n  "url": "https://www.espn.com/mlb/scoreboard"', status: 'completed' },
    { type: 'tool', id: 's3', turnId: 't', label: 'mcp__embedded_browser__script', detail: '{"action":"evaluate","expression":"(() => {', status: 'inProgress' }
  ], 't'), 5)
  assert.deepEqual(feed.lines.map((line) => line.text), ['Loaded tools', 'Opened espn.com', 'Working in the page'])
  const other = quickChatFeed(snapshot([user('u1'), tool('s1', 'Some other tool', 'completed')]))
  assert.equal(other.lines[0]!.text.length > 0, true)
})
