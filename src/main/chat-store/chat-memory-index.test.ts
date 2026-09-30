import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import { ChatMemoryIndex } from './chat-memory-index.js'

function record(id: string, activity: number, cwd = '/proj'): ChatRecord {
  return {
    id,
    cwd,
    projectPath: cwd,
    provider: 'codex',
    modelId: 'gpt',
    reasoningEffort: null,
    codexThreadId: 't1',
    claudeSessionId: null,
    antigravityConversationId: null,
    cursorSessionId: null,
    threadId: `codex:${id}`,
    title: `Chat ${id}`,
    preview: '',
    createdAt: activity - 1000,
    updatedAt: activity,
    lastTurnEndedAt: activity,
    messageSentAt: activity,
    archived: false,
    pinnedAt: null,
    continuation: null,
    checkpoint: null,
    parentChatId: null,
    sessionRotations: [],
    agentRun: null
  }
}

function userItem(id: string, text: string): ChatTranscriptItem {
  return { type: 'user', id, turnId: id, text, attachments: [] }
}

const settings = {
  ...DEFAULT_APP_SETTINGS,
  chatMemoryIndexEnabled: true,
  chatMemoryIndexMaxChats: 3,
  chatMemoryIndexHalfLifeDays: 7,
  chatMemoryIndexMaxCharsPerChat: 10_000
}

test('ChatMemoryIndex evicts least recent chats beyond the cap', () => {
  const index = ChatMemoryIndex.inMemory(settings)
  index.upsert(record('a', 300), [userItem('u1', 'alpha needle')])
  index.upsert(record('b', 200), [userItem('u2', 'beta needle')])
  index.upsert(record('c', 100), [userItem('u3', 'gamma needle')])
  index.upsert(record('d', 400), [userItem('u4', 'delta needle')])
  const result = index.search({ query: 'needle' })
  assert.deepEqual(result.hits.map((hit) => hit.chatId).sort(), ['a', 'b', 'd'])
  assert.equal(result.hits.some((hit) => hit.chatId === 'c'), false)
})

test('ChatMemoryIndex ranks newer chats higher for equal matches', () => {
  const index = ChatMemoryIndex.inMemory(settings)
  index.upsert(record('old', 100), [userItem('u1', 'shared token')])
  index.upsert(record('new', 500), [userItem('u2', 'shared token')])
  const hits = index.search({ query: 'shared', limit: 2 }).hits
  assert.equal(hits[0]?.chatId, 'new')
  assert.equal(hits[1]?.chatId, 'old')
})

test('ChatMemoryIndex excludes caller chat and filters cwd', () => {
  const index = ChatMemoryIndex.inMemory(settings)
  index.upsert(record('here', 300, '/a'), [userItem('u1', 'find me')])
  index.upsert(record('there', 200, '/b'), [userItem('u2', 'find me')])
  assert.equal(index.search({ query: 'find' }, 'here').hits.length, 1)
  assert.equal(index.search({ query: 'find' }, 'here').hits[0]?.chatId, 'there')
  assert.equal(index.search({ query: 'find', cwd: '/b' }).hits.length, 1)
})

test('ChatMemoryIndex interleaves evidence lines within turns', () => {
  const index = ChatMemoryIndex.inMemory(settings)
  index.upsert(record('chat', 100), [
    userItem('u1', 'hello'),
    { type: 'tool', id: 't1', turnId: 'u1', label: 'grep', detail: '', status: 'completed' },
    { type: 'assistant', id: 'a1', turnId: 'u1', text: 'done', phase: 'final_answer', streaming: false },
    userItem('u2', 'second')
  ])
  const stored = index.getRecord('chat')
  assert.ok(stored)
  const roles = stored.lines.map((line) => line.role)
  assert.deepEqual(roles, ['user', 'evidence', 'assistant', 'user'])
})

test('ChatMemoryIndex persists manifest and chat files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-index-'))
  const index = new ChatMemoryIndex(dir, () => settings)
  index.upsert(record('persist', 100), [userItem('u1', 'persisted phrase')])
  await index.flush()
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { chatIds: string[] }
  assert.deepEqual(manifest.chatIds, ['persist'])
  const reopened = new ChatMemoryIndex(dir, () => settings)
  await reopened.load()
  assert.equal(reopened.search({ query: 'persisted' }).hits[0]?.chatId, 'persist')
})

test('search excludes deleted and archived records before limiting and flags unverified evidence', () => {
  const index = ChatMemoryIndex.inMemory(settings)
  const available = record('available', 100)
  const archived = { ...record('archived', 200), archived: true }
  index.upsert(available, [userItem('a', 'needle')])
  index.upsert({ ...archived, archived: false }, [userItem('b', 'needle')])
  index.upsert(record('deleted', 300), [userItem('c', 'needle')])
  const records = new Map([['available', available], ['archived', archived]])
  const result = index.search({ query: 'needle', limit: 1 }, null, (id) => records.get(id))
  assert.equal(result.hits[0]?.chatId, 'available')
  assert.deepEqual(result.hits[0]?.evidenceAvailability, { status: 'not-checked' })
})

test('ChatMemoryIndex search tolerates spacing, then typos only when nothing matches literally', () => {
  const index = ChatMemoryIndex.inMemory(settings)
  index.upsert(record('spine', 300), [userItem('u1', 'yes implement spine v1')])
  index.upsert(record('spin', 200), [userItem('u2', 'spin the wheel v1')])
  const spaced = index.search({ query: 'spinev1' }).hits
  assert.deepEqual(spaced.map((hit) => [hit.chatId, hit.match, hit.matched]), [['spine', 'spacing', 'spine v1']])
  const typo = index.search({ query: 'impelment spine' }).hits
  assert.equal(typo[0]?.chatId, 'spine')
  assert.equal(typo[0]?.match, 'fuzzy')
  const literal = index.search({ query: 'spine v1' }).hits
  assert.equal(literal.length, 1)
  assert.equal(literal[0]?.match, undefined)
})
