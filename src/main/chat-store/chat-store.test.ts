import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chatRecordIsBlank } from '../../shared/chat-store.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import { MemorySettings } from '../chat-peers/peer-manager-harness.js'
import { chatRecordFromPeer, normalizeChatRecord } from './chat-record.js'
import { ChatStore } from './chat-store.js'
import { migrateChatPeersIntoStore } from './chat-store-migration.js'

const seed = { cwd: '/w', projectPath: '/w', provider: 'codex' as const, modelId: 'gpt', reasoningEffort: null }

test('create, update, archive: the thread id follows the provider and ids never change', () => {
  const store = ChatStore.inMemory()
  const changes: string[][] = []
  store.on('change', (change: { ids: string[] }) => changes.push(change.ids))
  const record = store.create(seed)
  assert.equal(record.threadId, null)
  assert.ok(chatRecordIsBlank(record))

  const claude = store.update(record.id, { modelId: 'claude:opus', claudeSessionId: 's1' })
  assert.equal(claude.provider, 'claude')
  assert.equal(claude.threadId, 'claude:s1')
  assert.equal(claude.id, record.id)
  assert.equal(claude.createdAt, record.createdAt)

  const cleared = store.update(record.id, { modelId: null })
  assert.equal(cleared.provider, 'claude', 'a cleared model keeps the chat on its provider')

  store.archive(record.id)
  assert.deepEqual(store.list('/w'), [])
  assert.equal(store.get(record.id)?.archived, true)
  assert.equal(changes.length, 4)
  assert.throws(() => store.update('missing', {}), /Unknown chat/)
})

test('list is scoped to the working directory and newest first', () => {
  const store = ChatStore.inMemory()
  const a = store.create({ ...seed, updatedAt: 1 })
  const b = store.create({ ...seed, updatedAt: 3 })
  store.create({ ...seed, cwd: '/elsewhere', updatedAt: 2 })
  assert.deepEqual(store.list('/w').map((record) => record.id), [b.id, a.id])
})

test('adopt records a provider thread under the thread id and only refreshes a known one', () => {
  const store = ChatStore.inMemory()
  const adopted = store.adopt('/w', '/w', { id: 'claude:abc', title: 'Older work', preview: 'p', createdAt: 5, updatedAt: 9 }, null)
  assert.equal(adopted.id, 'claude:abc')
  assert.equal(adopted.provider, 'claude')
  assert.equal(adopted.claudeSessionId, 'abc')
  assert.equal(adopted.threadId, 'claude:abc')
  assert.equal(adopted.lastTurnEndedAt, 9)

  const own = store.create({ ...seed, codexThreadId: 'thread-1', title: 'Mine', updatedAt: 20 })
  const same = store.adopt('/w', '/w', { id: 'thread-1', title: 'Renamed', preview: '', createdAt: 1, updatedAt: 10 }, null)
  assert.equal(same.id, own.id, 'the existing record is kept')
  assert.equal(same.title, 'Renamed')
  assert.equal(same.updatedAt, 20, 'an older provider time never moves a record back')
  assert.equal(store.list('/w').length, 2)
})

test('writes coalesce and survive a reload; remove forgets a chat outright', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-chats-'))
  const file = join(dir, 'chats.json')
  const store = await ChatStore.open(file)
  const a = store.create(seed)
  store.update(a.id, { title: 'First' })
  const b = store.create(seed)
  store.remove(b.id)
  await store.flush()
  const written = JSON.parse(await readFile(file, 'utf8')) as { version: number; chats: unknown[] }
  assert.equal(written.version, 1)
  assert.equal(written.chats.length, 1)

  const reopened = await ChatStore.open(file)
  assert.equal(reopened.require(a.id).title, 'First')
  assert.equal(reopened.get(b.id), undefined)
})

test('records read back from disk are shape-checked and legacy pane records keep their id', () => {
  assert.equal(normalizeChatRecord({ cwd: '/w' }), null)
  assert.equal(normalizeChatRecord({ id: 'x' }), null)
  const loose = normalizeChatRecord({ id: 'x', cwd: '/w', modelId: 'agy:gemini', antigravityConversationId: 'c1', updatedAt: 7, archived: 'yes' })!
  assert.equal(loose.provider, 'antigravity')
  assert.equal(loose.threadId, 'agy:c1')
  assert.equal(loose.createdAt, 7)
  assert.equal(loose.archived, false)

  const record = chatRecordFromPeer({
    paneId: 'pane-9', provider: 'claude', threadId: 'claude:s9', codexThreadId: null, claudeSessionId: 's9',
    modelId: 'claude:opus', reasoningEffort: 'high', title: 'Kept', updatedAt: 42
  }, '/w', '/w')
  assert.equal(record.id, 'pane-9')
  assert.equal(record.threadId, 'claude:s9')
  assert.equal(record.title, 'Kept')
  assert.equal(record.updatedAt, 42)
  assert.equal(record.lastTurnEndedAt, 42)
})

test('migration imports the active and saved workspaces once, preserving pane ids', async () => {
  const peer = (paneId: string) => ({
    paneId, provider: 'codex' as const, threadId: `t-${paneId}`, codexThreadId: `t-${paneId}`, claudeSessionId: null,
    modelId: 'gpt', reasoningEffort: null
  })
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: [peer('a'), peer('b')],
    chatSelectedPaneId: 'b',
    chatWorkspaces: [{ cwd: '/other', projectPath: '/other', openIds: [], peers: [peer('c')], selectedPaneId: 'c' }]
  })
  const store = ChatStore.inMemory()

  const first = await migrateChatPeersIntoStore(settings, store, { cwd: '/w', projectPath: '/w' })
  assert.equal(first.imported, 3)
  assert.deepEqual(store.list('/w').map((record) => record.id).sort(), ['a', 'b'])
  assert.equal(store.require('c').cwd, '/other')
  assert.deepEqual(first.settings.chatOpenIds, ['a', 'b'])
  assert.equal(first.settings.chatSelectedPaneId, 'b')
  assert.deepEqual(first.settings.chatPeers, [])
  assert.deepEqual(first.settings.chatWorkspaces[0]!.openIds, ['c'])
  assert.deepEqual(first.settings.chatWorkspaces[0]!.peers, [])

  const second = await migrateChatPeersIntoStore(settings, store, { cwd: '/w', projectPath: '/w' })
  assert.equal(second.imported, 0)
  assert.deepEqual(second.settings.chatOpenIds, ['a', 'b'])
})
