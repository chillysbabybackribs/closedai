import assert from 'node:assert/strict'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { ChatSnapshot, ChatTranscriptItem } from '../../shared/chat.js'
import {
  CACHED_TRANSCRIPT_BYTES,
  CACHED_TRANSCRIPT_ITEMS,
  ChatTranscriptCache,
  cachedViewOf,
  normalizeCachedView
} from './chat-transcript-cache.js'

function snapshotWith(items: ChatTranscriptItem[], hasEarlier = false): ChatSnapshot {
  return {
    provider: 'codex',
    connection: { state: 'ready', message: 'ready' },
    account: null,
    models: [],
    selectedModel: 'gpt',
    selectedReasoningEffort: null,
    cwd: '/workspace',
    threadId: 'thread-1',
    threadName: 'Saved chat',
    activeTurnId: null,
    pausedTurnId: null,
    contextUsage: { usedTokens: 1_000, contextWindow: 10_000, percent: 10 },
    planUsage: null,
    turnContext: null,
    items,
    history: { hasEarlier }
  }
}

function messages(count: number, text = 'hello'): ChatTranscriptItem[] {
  return Array.from({ length: count }, (_, index) => ({ type: 'user', id: `u${index}`, turnId: null, text }))
}

async function cacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'closedai-transcripts-'))
}

test('a saved view keeps the tail and says the conversation continues above it', () => {
  const view = cachedViewOf('thread-1', snapshotWith(messages(CACHED_TRANSCRIPT_ITEMS + 20)))
  assert.equal(view.items.length, CACHED_TRANSCRIPT_ITEMS)
  assert.equal(view.items[0]?.id, 'u20')
  assert.equal(view.hasEarlier, true)
  assert.equal(view.contextUsage?.percent, 10)
  assert.equal(view.threadName, 'Saved chat')
})

test('a short chat is saved whole, and the window it came from still reports earlier messages', () => {
  assert.equal(cachedViewOf('thread-1', snapshotWith(messages(3))).hasEarlier, false)
  assert.equal(cachedViewOf('thread-1', snapshotWith(messages(3), true)).hasEarlier, true)
})

test('one conversation of long outputs cannot outgrow the size cap', () => {
  const heavy = messages(20, 'x'.repeat(40_000))
  const view = cachedViewOf('thread-1', snapshotWith(heavy))
  assert.ok(view.items.length < heavy.length)
  assert.ok(JSON.stringify(view.items).length <= CACHED_TRANSCRIPT_BYTES + 40_100)
  assert.equal(view.hasEarlier, true)
  assert.equal(view.items.at(-1)?.id, 'u19')
})

test('a remembered chat comes back on the next launch and a forgotten one does not', async () => {
  const dir = await cacheDir()
  const cache = new ChatTranscriptCache(dir)
  cache.remember('pane-a', 'thread-1', snapshotWith(messages(2)))
  await cache.flush()

  const reopened = new ChatTranscriptCache(dir)
  assert.equal(reopened.peek('pane-a'), null)
  const view = await reopened.load('pane-a')
  assert.equal(view?.items.length, 2)
  assert.equal(view?.threadId, 'thread-1')
  assert.equal(reopened.peek('pane-a')?.items.length, 2)

  reopened.forget('pane-a')
  await reopened.flush()
  assert.equal(await new ChatTranscriptCache(dir).load('pane-a'), null)
})

test('an empty transcript is never saved over what the chat already had', async () => {
  const cache = new ChatTranscriptCache(null)
  cache.remember('pane-a', 'thread-1', snapshotWith(messages(2)))
  cache.remember('pane-a', 'thread-1', snapshotWith([]))
  assert.equal(cache.peek('pane-a')?.items.length, 2)
})

test('a chat id with a provider prefix survives the round trip, and pruning follows the store', async () => {
  const dir = await cacheDir()
  const cache = new ChatTranscriptCache(dir)
  cache.remember('claude:abc/def', 'claude:abc/def', snapshotWith(messages(1)))
  cache.remember('gone', 'thread-2', snapshotWith(messages(1)))
  await cache.flush()
  assert.equal((await new ChatTranscriptCache(dir).load('claude:abc/def'))?.items.length, 1)

  await cache.prune(new Set(['claude:abc/def']))
  assert.deepEqual(await readdir(dir), ['claude%3Aabc%2Fdef.json'])
})

test('an unreadable or outdated entry reads as no entry at all', async () => {
  const dir = await cacheDir()
  await writeFile(join(dir, 'pane-a.json'), '{ not json', 'utf8')
  await writeFile(join(dir, 'pane-b.json'), JSON.stringify({ version: 0, threadId: 't', items: [] }), 'utf8')
  const cache = new ChatTranscriptCache(dir)
  assert.equal(await cache.load('pane-a'), null)
  assert.equal(await cache.load('pane-b'), null)
  assert.equal(normalizeCachedView({ version: 1, threadId: 't', items: [{ nonsense: true }] }), null)
  assert.equal(normalizeCachedView(null), null)
})

test('a replayed thread keeps the context reading it was measured with', async () => {
  const dir = await cacheDir()
  const cache = new ChatTranscriptCache(dir)
  cache.remember('pane-a', 'thread-1', snapshotWith(messages(2)))
  await cache.flush()

  // A resumed provider has the transcript but no reading of its own until the next turn.
  const resumed = { ...snapshotWith(messages(3)), contextUsage: null }
  cache.remember('pane-a', 'thread-1', resumed)
  assert.equal(cache.peek('pane-a')?.contextUsage?.percent, 10)
  assert.equal(cache.peek('pane-a')?.items.length, 3)

  // A different thread is a different window, so its reading starts empty.
  cache.remember('pane-a', 'thread-2', resumed)
  assert.equal(cache.peek('pane-a')?.contextUsage, null)

  // And a resume that beats the read of the saved view does not lose it either.
  const racing = new ChatTranscriptCache(dir)
  racing.remember('pane-a', 'thread-1', resumed)
  assert.equal((await racing.load('pane-a'))?.contextUsage?.percent, 10)
})
