import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { PeerChatReadOptions } from '../../shared/chat-peers.js'
import { PEER_READ_DEFAULT_CHARS } from '../../shared/chat-peers.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import { MAX_PEER_PREVIEW_CHARS, PeerSummaryCache, pageResult, paneTitle, summaryOf } from './peer-summary.js'

function snapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return {
    provider: 'claude',
    connection: { state: 'ready', message: 'ready' },
    account: null,
    models: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    cwd: '/workspace',
    threadId: null,
    threadName: null,
    activeTurnId: null,
    pausedTurnId: null,
    contextUsage: null,
    planUsage: null,
    turnContext: null,
    items: [],
    ...overrides
  }
}

function record(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id: 'pane-a',
    cwd: '/workspace',
    projectPath: '/workspace',
    provider: 'claude',
    threadId: null,
    codexThreadId: null,
    claudeSessionId: null,
    antigravityConversationId: null,
    cursorSessionId: null,
    modelId: 'claude:opus',
    reasoningEffort: null,
    title: null,
    preview: '',
    createdAt: 0,
    updatedAt: 0,
    lastTurnEndedAt: null,
    messageSentAt: null,
    archived: false,
    pinnedAt: null,
    continuation: null,
    checkpoint: null,
    parentChatId: null,
    ...overrides
  }
}

test('the provider name wins, then the first message, then the saved title', () => {
  const userItem = { type: 'user' as const, id: 'u1', turnId: 't1', text: '  Fix the sidebar\nmore detail' }
  assert.equal(paneTitle(snapshot({ threadName: 'Sidebar fixes', items: [userItem] }), record()), 'Sidebar fixes')
  assert.equal(paneTitle(snapshot({ items: [userItem] }), record({ title: 'Saved' })), 'Fix the sidebar')
  assert.equal(paneTitle(snapshot(), record({ title: 'Saved', threadId: 'claude:s1' })), 'Saved')
  assert.equal(paneTitle(snapshot(), record()), 'New chat')
})

test('a saved title belongs to the saved thread; a pane that left its chat is blank again', () => {
  assert.equal(paneTitle(snapshot(), record({ title: 'Old chat', threadId: null })), 'New chat')
  const lineage = { sourcePaneId: 'p', sourceThreadId: 't', sourceTitle: 'Old chat', digest: '', createdAt: 0 }
  assert.equal(
    paneTitle(snapshot(), record({ title: 'Continuing: Old chat', continuation: lineage as never })),
    'Continuing: Old chat'
  )
})

test('the cache reads the record on demand, so a new chat drops the previous name and thread', () => {
  let saved = record({ title: 'Old chat', threadId: 'claude:s1', claudeSessionId: 's1' })
  const cache = new PeerSummaryCache('pane-a', () => saved)
  assert.equal(cache.current.title, 'Old chat')
  assert.equal(cache.current.threadId, 'claude:s1')
  saved = record({ title: 'Old chat', threadId: null })
  cache.update({ type: 'replace', snapshot: snapshot() }, 1)
  assert.equal(cache.current.title, 'New chat')
  assert.equal(cache.current.threadId, null)
})

test('a parked pane still reports its persisted thread and title', () => {
  const summary = summaryOf('pane-a', snapshot(), 0, record({ title: 'Agent sidebar bugs', threadId: 'claude:s1' }))
  assert.equal(summary.title, 'Agent sidebar bugs')
  assert.equal(summary.threadId, 'claude:s1')
  assert.equal(summary.running, false)
  assert.equal(summary.modelId, 'claude:opus')
})

test('long titles are clipped like before', () => {
  const long = 'x'.repeat(80)
  assert.equal(paneTitle(snapshot({ threadName: long }), record()).length, 60)
})

test('late upserts preserve the latest preview and streaming previews stay bounded', () => {
  const cache = new PeerSummaryCache('pane-a', () => record())
  const old = { type: 'tool' as const, id: 'tool', turnId: 'turn', label: 'Read', detail: 'file', status: 'inProgress' }
  const answer = { type: 'assistant' as const, id: 'answer', turnId: 'turn', text: 'latest', phase: null, streaming: true }
  cache.update({ type: 'replace', snapshot: snapshot({ items: [old, answer] }) }, 1)
  cache.update({ type: 'item', item: { ...old, status: 'completed' } }, 2)
  assert.equal(cache.current.preview, 'latest')
  cache.update({ type: 'itemDelta', itemId: 'answer', field: 'text', delta: 'x'.repeat(10_000) }, 3)
  assert.equal(cache.current.preview.length, MAX_PEER_PREVIEW_CHARS)
  assert.equal(cache.current.activity, null)
  cache.update({ type: 'replace', snapshot: snapshot() }, 4)
  cache.update({ type: 'item', item: { ...answer, text: 'new chat' } }, 5)
  assert.equal(cache.current.preview, 'new chat')
})

test('reasoning never reaches a peer: previews skip it and pages leave it out', () => {
  const answer = { type: 'assistant' as const, id: 'answer', turnId: 'turn', text: 'the answer', phase: null, streaming: false }
  const thinking = { type: 'reasoning' as const, id: 'think', turnId: 'turn', text: 'private working state', streaming: true }
  const summary = summaryOf('pane-a', snapshot({ items: [answer, thinking] }), 1, record())
  assert.equal(summary.preview, 'the answer')

  const cache = new PeerSummaryCache('pane-a', () => record())
  cache.update({ type: 'replace', snapshot: snapshot({ items: [answer] }) }, 1)
  cache.update({ type: 'item', item: thinking }, 2)
  assert.equal(cache.current.preview, 'the answer')
  cache.update({ type: 'itemDelta', itemId: 'think', field: 'text', delta: ' more thinking' }, 3)
  assert.equal(cache.current.preview, 'the answer')

  const page = pageResult(summary, [thinking, answer, { ...thinking, id: 'think-2' }], readOptions())
  assert.deepEqual(page.items.map((item) => item.id), ['answer'])
  assert.equal(page.totalItems, 1)
  assert.equal(page.nextCursor, null)
  assert.equal(JSON.stringify(page).includes('private working state'), false)
})

function readOptions(overrides: Partial<PeerChatReadOptions> = {}): PeerChatReadOptions {
  return { cursor: 0, limit: 50, order: 'newest', maxChars: PEER_READ_DEFAULT_CHARS, ...overrides }
}

function answerItem(id: string, text: string) {
  return { type: 'assistant' as const, id, turnId: 't', text, phase: null, streaming: false }
}

test('a page is taken from the live end of the chat and walks backwards from there', () => {
  const summary = summaryOf('pane-a', snapshot(), 1, record())
  const items = Array.from({ length: 10 }, (_, index) => answerItem(`a${index}`, `answer ${index}`))
  const newest = pageResult(summary, items, readOptions({ limit: 3 }))
  assert.deepEqual(newest.items.map((item) => item.id), ['a7', 'a8', 'a9'])
  assert.equal(newest.totalItems, 10)
  assert.equal(newest.nextCursor, 3)

  const older = pageResult(summary, items, readOptions({ limit: 3, cursor: newest.nextCursor! }))
  assert.deepEqual(older.items.map((item) => item.id), ['a4', 'a5', 'a6'])

  const fromStart = pageResult(summary, items, readOptions({ limit: 3, order: 'oldest' }))
  assert.deepEqual(fromStart.items.map((item) => item.id), ['a0', 'a1', 'a2'])
  assert.equal(fromStart.nextCursor, 3)
  assert.equal(pageResult(summary, items, readOptions({ cursor: 10 })).items.length, 0)
})

test('a page fits its character budget by clipping long fields, then by dropping the far items', () => {
  const summary = summaryOf('pane-a', snapshot(), 1, record())
  const items = Array.from({ length: 8 }, (_, index) => answerItem(`a${index}`, 'x'.repeat(4_000)))
  const page = pageResult(summary, items, readOptions({ maxChars: 2_000 }))
  assert.ok(JSON.stringify(page.items).length <= 2_000, `page items are ${JSON.stringify(page.items).length} chars`)
  assert.ok(page.items.length >= 1 && page.items.length < 8)
  assert.deepEqual(page.items.at(-1)?.id, 'a7')
  assert.match((page.items[0] as { text: string }).text, /x+…\[\+\d+ chars\]$/)
  assert.equal(page.nextCursor, page.items.length)
})

test('types narrow a page, and a screenshot never carries its data URL to a peer', () => {
  const summary = summaryOf('pane-a', snapshot(), 1, record())
  const items = [
    { type: 'user' as const, id: 'u', turnId: 't', text: 'the request' },
    { type: 'tool' as const, id: 'x', turnId: 't', label: 'Read', detail: 'a'.repeat(9_000), status: 'completed', output: 'b'.repeat(9_000) },
    { type: 'screenshot' as const, id: 's', turnId: 't', surface: 'app_window' as const, imageUrl: `data:image/png;base64,${'A'.repeat(50_000)}`, caption: 'the window' },
    answerItem('a', 'the answer')
  ]
  const conversation = pageResult(summary, items, readOptions({ types: ['user', 'assistant'] }))
  assert.deepEqual(conversation.items.map((item) => item.id), ['u', 'a'])
  assert.equal(conversation.totalItems, 2)

  const everything = pageResult(summary, items, readOptions())
  const serialized = JSON.stringify(everything)
  assert.equal(serialized.includes('A'.repeat(100)), false)
  assert.ok(serialized.length < 10_000, `page is ${serialized.length} chars`)
  assert.deepEqual(everything.items.map((item) => item.id), ['u', 'x', 's', 'a'])
})

test('cache titles follow the first user message and bounded provider name', () => {
  const cache = new PeerSummaryCache('pane-a', () => record({ title: 'Saved title' }))
  cache.update({ type: 'item', item: { type: 'user', id: 'first', turnId: null, text: 'First request' } }, 1)
  cache.update({ type: 'item', item: { type: 'user', id: 'next', turnId: null, text: 'Later request' } }, 2)
  assert.equal(cache.current.title, 'First request')
  cache.update({ type: 'thread', threadId: 'claude:s', threadName: 'z'.repeat(1000) }, 3)
  assert.equal(cache.current.title.length, 60)
  cache.update({ type: 'turn', turnId: 'running' }, 4)
  assert.equal(cache.current.running, true)
})
