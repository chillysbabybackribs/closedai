import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.ts'
import type { ChatMemoryCheckpoint } from '../../shared/chat-memory.js'
import {
  buildThreadHandoff,
  continuationFromThreadHandoff,
  handoffAdditionalContext,
  handoffPreviewExchange,
  THREAD_HANDOFF_CONTEXT
} from './thread-handoff.ts'

const user = (id: string, text: string, turnId = id): ChatTranscriptItem => ({ type: 'user', id, turnId, text })
const answer = (id: string, turnId: string, text: string, phase: 'commentary' | 'final_answer' | null = 'final_answer'): ChatTranscriptItem =>
  ({ type: 'assistant', id, turnId, text, phase, streaming: false })

test('handoffPreviewExchange keeps the last user and answer for the continued pane preview', () => {
  const items: ChatTranscriptItem[] = [
    user('u1', 'First task', 't1'),
    answer('a1', 't1', 'Done one.'),
    user('u2', 'Second task', 't2'),
    answer('a2', 't2', 'Done two.')
  ]
  assert.deepEqual(handoffPreviewExchange(items), { user: 'Second task', assistant: 'Done two.' })
  assert.deepEqual(handoffPreviewExchange([user('u1', 'Only ask', 't1')]), { user: 'Only ask', assistant: null })
})

test('handoff titles and user lines omit closedai_context markup', () => {
  const items: ChatTranscriptItem[] = [
    user('u1', '<closedai_context name="closedai.instructions" kind="application">\nrules\n</closedai_context>\nMove menu item', 't1'),
    answer('a1', 't1', 'Done.')
  ]
  const digest = buildThreadHandoff(items, '<closedai_context name="x">')!
  assert.equal(digest.title, 'Move menu item')
  assert.match(digest.text, /Handoff from the previous chat "Move menu item"\./)
  assert.match(digest.text, /User: Move menu item\nAssistant: Done\./)
  assert.doesNotMatch(digest.text, /closedai_context|<\/?closedai/)
})

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
  assert.match(handoff, /Where it stood: 2 user requests; the latest request was answered\./)
  assert.doesNotMatch(handoff, /Working directory there/)
  assert.match(handoff, /Files changed there: src\/header\.tsx/)
  assert.match(handoff, /User: Make the header sticky\nAssistant: Done: the header is sticky\.\nUser: Now match this \[attached: mock\.png\]\nAssistant: Working on it/)
  assert.doesNotMatch(handoff, /thinking hard|lots of output|data:image|compacted/)
  assert.deepEqual(handoffAdditionalContext('digest'), { [THREAD_HANDOFF_CONTEXT]: { kind: 'untrusted', value: 'digest' } })
})

test('the overview names the source directory and a request that was cut off before its answer', () => {
  const stopped = buildThreadHandoff([
    user('u1', 'Refactor the parser'),
    answer('a1', 'u1', 'Parser refactored.'),
    user('u2', 'Now add tests')
  ], null, null, { cwd: '/home/me/project' })!.text
  assert.match(stopped, /Where it stood: 2 user requests; the latest request had no completed answer when the chat was continued \(its turn was stopped or unfinished\)\./)
  assert.match(stopped, /Working directory there: \/home\/me\/project/)
  // The overview sits in the header, before the checkpoint, changed files, and conversation.
  assert.ok(stopped.indexOf('Where it stood') < stopped.indexOf('Conversation so far'))

  const streaming = buildThreadHandoff([
    user('u1', 'Refactor the parser'),
    { type: 'assistant', id: 'a1', turnId: 'u1', text: 'Starting with', phase: null, streaming: true }
  ], null)!.text
  assert.match(streaming, /1 user request; the latest request had no completed answer/)

  // Rotation and compaction seeds re-seed the same pane; they keep their own preambles.
  const rotation = buildThreadHandoff([user('u1', 'Keep going')], null, null, { framing: 'rotation', cwd: '/w' })!.text
  assert.doesNotMatch(rotation, /Where it stood|Working directory there/)
})

test('an empty or tool-only transcript has nothing to hand off', () => {
  assert.equal(buildThreadHandoff([], null), null)
  assert.equal(buildThreadHandoff([{ type: 'notice', id: 'n', turnId: null, text: 'hi', tone: 'info' }], null), null)
})

test('a destination continuation keeps the frozen source boundary and checkpoint', () => {
  const checkpoint: ChatMemoryCheckpoint = {
    version: 1, revision: 3, threadId: 'claude:source', throughItemId: 'a1', createdAt: 10,
    state: { goal: 'Finish the migration', constraints: ['Keep the legacy API compatible'],
      decisions: [], progress: [], nextSteps: [], files: ['src/api.ts'] }
  }
  const continuation = continuationFromThreadHandoff('pane-1', {
    provider: 'claude', threadId: 'claude:source', title: 'Migration', text: 'digest',
    sourceThroughItemId: 'a2', checkpoint
  }, 20)
  assert.deepEqual(continuation, {
    sourcePaneId: 'pane-1', sourceThreadId: 'claude:source', sourceProvider: 'claude',
    sourceTitle: 'Migration', sourceThroughItemId: 'a2', checkpoint, handoff: 'digest', createdAt: 20
  })
})

test('handoffs preserve complete user requests and latest answer while omitting whole older answers', () => {
  const items = [user('u0', 'The original goal')]
  for (let i = 1; i <= 40; i++) {
    items.push(user(`u${i}`, `Request ${i} ${'x'.repeat(900)}`))
    items.push(answer(`a${i}`, `u${i}`, `Answer ${i} ${'y'.repeat(2_000)} END`))
  }
  const handoff = buildThreadHandoff(items, null)!.text
  assert.match(handoff, /User: The original goal/)
  assert.match(handoff, /Request 1 x/)
  assert.match(handoff, /Older answer omitted; recall item_id="a1"/)
  assert.ok(handoff.endsWith(`Answer 40 ${'y'.repeat(2_000)} END`))
  assert.ok(handoff.length > 24_000, 'protected requests may exceed the soft target')
  const unlimited = buildThreadHandoff(items, null, null, { maxChars: 0 })!.text
  assert.doesNotMatch(unlimited, /Older answer omitted/)
  assert.ok(unlimited.includes(`Answer 1 ${'y'.repeat(2_000)} END`))
})

test('a bounded structured checkpoint preserves old decisions alongside recent corrections', () => {
  const checkpoint: ChatMemoryCheckpoint = {
    version: 1, revision: 2, threadId: 'thread', throughItemId: 'a1', createdAt: 1,
    state: { goal: 'Ship memory', constraints: ['Keep the production database read-only'],
      decisions: ['Use local storage'], progress: ['Recall implemented'], nextSteps: ['Test branches'], files: ['memory.ts'] }
  }
  const items = [user('u1', 'Ship memory'), answer('a1', 't1', 'Storage decision made')]
  for (let i = 2; i < 60; i++) items.push(user(`u${i}`, `Task ${i} ${'x'.repeat(1_000)}`))
  items.push(user('latest', 'Correction: use the existing provider archive, not a second store'))
  const handoff = buildThreadHandoff(items, 'Memory', checkpoint)!.text
  assert.match(handoff, /production database read-only/)
  assert.match(handoff, /Correction: use the existing provider archive/)
  assert.match(handoff, /may be stale; later messages take precedence/)
  assert.match(handoff, /Task 2 x/)
  const earlierBranch = buildThreadHandoff(items.slice(0, 1), 'Memory', checkpoint)!.text
  assert.doesNotMatch(earlierBranch, /production database|Storage decision/)
})

test('protected checkpoint, requests, answers and paths survive a small soft budget', () => {
  const checkpoint: ChatMemoryCheckpoint = {
    version: 1, revision: 1, threadId: 'thread', throughItemId: 'a1', createdAt: 1,
    state: { goal: 'g'.repeat(1_000), constraints: Array.from({ length: 12 }, (_, i) => `${i}${'c'.repeat(340)}`),
      decisions: [], progress: [], nextSteps: [], files: [] }
  }
  const items: ChatTranscriptItem[] = [user('u1', 'u'.repeat(3_000)), answer('a1', 't1', 'a'.repeat(3_000)), {
    type: 'fileChange', id: 'f', turnId: 't', status: 'completed',
    changes: Array.from({ length: 30 }, () => ({ path: 'p'.repeat(1_000), kind: 'update' as const, diff: '' }))
  }, user('u2', 'The latest task')]
  const text = buildThreadHandoff(items, 'title'.repeat(10_000), checkpoint, { maxChars: 100 })!.text
  assert.ok(text.includes('u'.repeat(3_000)))
  assert.ok(text.includes('a'.repeat(3_000)))
  assert.ok(text.includes('p'.repeat(1_000)))
  assert.match(text, /The latest task/)
})

test('rotation seeds instruct recall for omitted tool evidence', () => {
  const items = [user('u1', 'Keep going'), answer('a1', 't1', 'Done.')]
  const digest = buildThreadHandoff(items, 'Demo', null, { framing: 'rotation' })!
  assert.match(digest.text, /rotated to reduce context/)
  assert.match(digest.text, /peer_chats\.recall with scope source/)
  assert.doesNotMatch(digest.text, /Handoff from the previous chat/)
})


test('a larger target retains complete older answers and evidence is recallable by id', () => {
  const items: ChatTranscriptItem[] = [user('u', 'Task'), answer('a', 'u', 'old'.repeat(2_000)),
    { type: 'command', id: 'cmd', turnId: 'u', command: 'npm run test:one', cwd: '/w', status: 'failed', output: 'FAIL details', exitCode: 1 },
    { type: 'plan', id: 'plan', turnId: 'u', text: 'Fix the failing test', streaming: false },
    user('u2', 'Next'), answer('a2', 'u2', 'Latest answer'), answer('comment', 'u2', 'Late commentary', 'commentary')]
  const small = buildThreadHandoff(items, null, null, { maxChars: 2_000 })!.text
  const large = buildThreadHandoff(items, null, null, { maxChars: 20_000 })!.text
  assert.match(small, /Older answer omitted; recall item_id="a"/)
  assert.ok(large.includes('old'.repeat(2_000)))
  assert.match(small, /Fix the failing test/)
  assert.match(small, /command item_id="cmd".*exitCode=1/)
  assert.doesNotMatch(small, /FAIL details|Late commentary/)
  assert.match(small, /Latest answer/)
})
