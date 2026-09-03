import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.ts'
import { buildThreadHandoff, handoffAdditionalContext, THREAD_HANDOFF_CONTEXT } from './thread-handoff.ts'

const user = (id: string, text: string, turnId = id): ChatTranscriptItem => ({ type: 'user', id, turnId, text })
const answer = (id: string, turnId: string, text: string, phase: 'commentary' | 'final_answer' | null = 'final_answer'): ChatTranscriptItem =>
  ({ type: 'assistant', id, turnId, text, phase, streaming: false })

test('the digest keeps requests, one answer per turn, and changed files, and drops tool noise', () => {
  const items: ChatTranscriptItem[] = [
    user('u1', 'Make the header sticky', 't1'),
    { type: 'reasoning', id: 'r1', turnId: 't1', text: 'thinking hard', streaming: false },
    { type: 'command', id: 'c1', turnId: 't1', command: 'ls', cwd: '/w', status: 'completed', output: 'lots of output', exitCode: 0 },
    { type: 'tool', id: 'x1', turnId: 't1', label: 'capture', detail: 'page', status: 'completed' },
    { type: 'screenshot', id: 's1', turnId: 't1', imageUrl: 'data:image/png;base64,AAAA', surface: 'browser_page', caption: 'page' },
    { type: 'fileChange', id: 'f1', turnId: 't1', status: 'completed', changes: [{ path: 'src/header.tsx', kind: 'update', diff: '+++' }] },
    answer('a1', 't1', 'Looking at the header now.', 'commentary'),
    answer('a2', 't1', 'Done: the header is sticky.'),
    { type: 'notice', id: 'n1', turnId: 't1', text: 'Conversation context compacted', tone: 'info' },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Now match this', attachments: [{ id: 'att', kind: 'image', name: 'mock.png' }] },
    answer('a3', 't2', 'Working on it', null)
  ]
  const digest = buildThreadHandoff(items, 'Header work')
  assert.ok(digest)
  assert.equal(digest.title, 'Header work')
  const handoff = digest.text
  assert.match(handoff, /^Handoff from the previous chat "Header work"\./)
  assert.match(handoff, /Files changed there: src\/header\.tsx/)
  assert.match(handoff, /User: Make the header sticky\nAssistant: Done: the header is sticky\.\nUser: Now match this \[attached: mock\.png\]\nAssistant: Working on it$/)
  assert.doesNotMatch(handoff, /thinking hard|lots of output|data:image|compacted/)
  assert.deepEqual(handoffAdditionalContext('digest'), { [THREAD_HANDOFF_CONTEXT]: { kind: 'untrusted', value: 'digest' } })
})

test('an empty or tool-only transcript has nothing to hand off', () => {
  assert.equal(buildThreadHandoff([], null), null)
  assert.equal(buildThreadHandoff([{ type: 'notice', id: 'n', turnId: null, text: 'hi', tone: 'info' }], null), null)
})

test('long conversations keep the opening request and the most recent exchanges within budget', () => {
  const items: ChatTranscriptItem[] = [user('u0', 'The original goal', 't0')]
  for (let index = 1; index <= 40; index += 1) {
    items.push(user(`u${index}`, `Request ${index} ${'x'.repeat(900)}`, `t${index}`))
    items.push(answer(`a${index}`, `t${index}`, `Answer ${index} ${'y'.repeat(2_000)}`))
  }
  const digest = buildThreadHandoff(items, null)
  assert.ok(digest)
  assert.equal(digest.title, 'The original goal')
  const handoff = digest.text
  assert.ok(handoff.length <= 12_000, `digest is ${handoff.length} chars`)
  assert.match(handoff, /^Handoff from the previous chat "The original goal"\./)
  assert.match(handoff, /User: The original goal\n\[\d+ earlier messages omitted\]\n/)
  assert.match(handoff, /Assistant: Answer 40 y+…$/)
  assert.doesNotMatch(handoff, /Request 1 x/)
  assert.doesNotMatch(handoff, /y{1500}/)
})
