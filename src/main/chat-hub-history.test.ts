import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { DEFAULT_APP_SETTINGS } from './app-settings-store.js'
import { ChatHub, type ChatHubProviders } from './chat-hub.js'
import { restoreHubHistory } from './chat-hub-history.js'
import { chatRecord, FakeSurface, MemorySettings } from './chat-peers/peer-manager-harness.js'
import { PeerSettings } from './chat-peers/peer-settings.js'
import { ChatStore } from './chat-store/chat-store.js'
import { ChatTranscriptCache } from './chat-store/chat-transcript-cache.js'
import { ChatPeerManager } from './chat-peers/peer-manager.js'

const user = (id: string): ChatTranscriptItem => ({ type: 'user', id, turnId: id, text: id })
const continuation = {
  sourcePaneId: 'pane', sourceThreadId: 'first', sourceProvider: 'codex' as const,
  sourceTitle: 'Saved conversation', sourceThroughItemId: 'second-user', handoff: 'Continue', createdAt: 1
}
const rotations = [
  { epoch: 1, providerThreadId: 'first', sourceThroughItemId: 'first-user', at: 1 },
  { epoch: 2, providerThreadId: 'second', sourceThroughItemId: 'second-user', at: 2 }
]

function providers() {
  const codex = Object.assign(new FakeSurface('gpt'), { beginChatGptLogin: async () => '' })
  codex.readThread = async (id) => ({ threadId: id, threadName: 'Saved conversation', items: [user(`${id}-user`)] })
  const all = {
    codex, claude: new FakeSurface('claude:opus'),
    antigravity: new FakeSurface('agy:model'), cursor: new FakeSurface('cursor:model')
  } satisfies ChatHubProviders
  return all
}

test('disk relaunch paints a rotated chat, rebuilds every session, and pages across them', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-relaunch-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'chats.json')
  const store = await ChatStore.open(path)
  const record = store.create({ cwd: '/workspace', projectPath: '/workspace', provider: 'codex', modelId: 'gpt' })
  store.update(record.id, { continuation, sessionRotations: rotations, title: 'Saved conversation' })
  const cache = new ChatTranscriptCache(join(dir, 'transcripts'))
  cache.remember(record.id, 'second', { ...new FakeSurface('gpt').state, items: [user('second-user')] })
  await Promise.all([store.flush(), cache.flush()])

  const reopened = await ChatStore.open(path)
  const loaded = new ChatTranscriptCache(join(dir, 'transcripts'))
  const settings = new MemorySettings({ ...DEFAULT_APP_SETTINGS, chatOpenIds: [record.id], chatSelectedPaneId: record.id })
  const all = providers()
  const hub = new ChatHub(all, 'gpt', new PeerSettings(settings, reopened, record.id))
  const manager = new ChatPeerManager(settings, reopened, () => hub, undefined, undefined, loaded)
  t.after(() => manager.stop())
  const painted: string[][] = []
  manager.on('event', (event) => {
    if (event.type === 'workspace') painted.push(event.snapshot.selected.items.map((item: ChatTranscriptItem) => item.id))
  })
  await manager.start()
  assert.deepEqual(painted[0], ['second-user'])
  assert.equal(manager.snapshot().selected.threadId, null)
  assert.deepEqual(hub.snapshot().items.map((item) => item.id), ['first-user', 'second-user'])
  assert.deepEqual((await manager.readHistoryPage(record.id, null, 'second-user')).items.map((item) => item.id), ['first-user'])

  // A subsequent session adds to the same visible conversation without duplicating old rows.
  all.codex.state.threadId = 'third'
  all.codex.state.items = [user('second-user'), user('third-user')]
  assert.deepEqual(hub.snapshot().items.map((item) => item.id), ['first-user', 'second-user', 'third-user'])
  assert.deepEqual(hub.snapshot({ limit: 1, unit: 'turn' }).items.map((item) => item.id), ['third-user'])
  manager.stop()
  await loaded.flush()
  const saved = await new ChatTranscriptCache(join(dir, 'transcripts')).load(record.id)
  assert.equal(saved?.items.at(-1)?.id, 'third-user')
})

test('history survives a consumed handoff and a resumed active thread', async () => {
  const settings = new MemorySettings({ ...DEFAULT_APP_SETTINGS, chatThreadId: 'third', chatSessionRotations: rotations })
  const all = providers()
  all.codex.state.threadId = 'third'
  all.codex.state.items = [user('third-user')]
  const hub = new ChatHub(all, 'gpt', settings)
  await hub.start()
  assert.deepEqual(hub.snapshot().items.map((item) => item.id), ['first-user', 'second-user', 'third-user'])
  await hub.newThread()
  assert.deepEqual(settings.get().chatSessionRotations, [])
  hub.stop()
})

test('a missing retired session does not prevent restoring other sessions', async () => {
  const history = await restoreHubHistory({ ...DEFAULT_APP_SETTINGS, chatContinuation: continuation, chatSessionRotations: rotations }, async (id) => {
    if (id === 'first') throw new Error('missing provider file')
    return { threadId: id, threadName: null, items: [user('second-user'), user('past-boundary')] }
  })
  assert.deepEqual(history?.items.map((item) => item.id), ['second-user'])
})

test('an explicit new chat and a separate continuation do not restore retired history', async () => {
  const read = async () => { throw new Error('must not read an unrelated chat') }
  assert.equal(await restoreHubHistory({ ...DEFAULT_APP_SETTINGS, chatSessionRotations: rotations }, read), null)
  assert.equal(await restoreHubHistory({ ...DEFAULT_APP_SETTINGS, chatContinuation: continuation }, read), null)
  assert.equal(chatRecord('blank', 'gpt').threadId, null)
})
