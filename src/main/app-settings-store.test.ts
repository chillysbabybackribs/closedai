import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatContinuation } from '../shared/types.ts'
import { AppSettingsStore, DEFAULT_APP_SETTINGS } from './app-settings-store.ts'
import { PeerSettings } from './chat-peers/peer-settings.ts'

async function storeWith(contents: string | null): Promise<{ store: AppSettingsStore; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-settings-'))
  const file = join(dir, 'app-settings.json')
  if (contents !== null) await writeFile(file, contents)
  return { store: await AppSettingsStore.open(file), file }
}

test('a missing file yields the defaults, including the compaction threshold', async () => {
  const { store } = await storeWith(null)
  assert.deepEqual(store.get(), DEFAULT_APP_SETTINGS)
  assert.equal(store.get().chatCompactAtPercent, 80)
  assert.equal(store.get().chatCompactAtTokens, 0)
  assert.equal(store.get().chatMidTurnCompactTokens, 0)
  assert.equal(store.get().toolBatchMaxCalls, 16)
})

test('the tool batch limit is configurable within safe startup bounds', async () => {
  assert.equal((await storeWith('{"toolBatchMaxCalls": 24}')).store.get().toolBatchMaxCalls, 24)
  assert.equal((await storeWith('{"toolBatchMaxCalls": 24.4}')).store.get().toolBatchMaxCalls, 24)
  assert.equal((await storeWith('{"toolBatchMaxCalls": 0}')).store.get().toolBatchMaxCalls, 1)
  assert.equal((await storeWith('{"toolBatchMaxCalls": 999}')).store.get().toolBatchMaxCalls, 64)
  assert.equal((await storeWith('{"toolBatchMaxCalls": "many"}')).store.get().toolBatchMaxCalls, 16)
})

test('the opt-in mid-turn compact limit is bounded, with 0 leaving it to Codex', async () => {
  assert.equal((await storeWith('{"chatMidTurnCompactTokens": 0}')).store.get().chatMidTurnCompactTokens, 0)
  assert.equal((await storeWith('{"chatMidTurnCompactTokens": -1}')).store.get().chatMidTurnCompactTokens, 0)
  assert.equal((await storeWith('{"chatMidTurnCompactTokens": 500}')).store.get().chatMidTurnCompactTokens, 20_000)
  assert.equal((await storeWith('{"chatMidTurnCompactTokens": 9e9}')).store.get().chatMidTurnCompactTokens, 2_000_000)
  assert.equal((await storeWith('{"chatMidTurnCompactTokens": "lots"}')).store.get().chatMidTurnCompactTokens, 0)
  assert.equal((await storeWith('{"chatMidTurnCompactTokens": 80000.4}')).store.get().chatMidTurnCompactTokens, 80_000)
  // The retired key from the first cut of this feature is dropped rather than honoured.
  const { store } = await storeWith('{"chatAutoCompactTokens": 100000}')
  assert.equal(store.get().chatMidTurnCompactTokens, 0)
  assert.equal('chatAutoCompactTokens' in store.get(), false)
})

test('the compaction threshold is clamped and bad values fall back', async () => {
  assert.equal((await storeWith('{"chatCompactAtPercent": 140}')).store.get().chatCompactAtPercent, 95)
  assert.equal((await storeWith('{"chatCompactAtPercent": -4}')).store.get().chatCompactAtPercent, 0)
  assert.equal((await storeWith('{"chatCompactAtPercent": "soon"}')).store.get().chatCompactAtPercent, 80)
  const { store, file } = await storeWith('{}')
  const updated = await store.set({ chatCompactAtPercent: 72.4 })
  assert.equal(updated.chatCompactAtPercent, 72)
  assert.match(await readFile(file, 'utf8'), /"chatCompactAtPercent": 72/)
})

test('the between-turn token budget is opt-in, bounded, and persists independently', async () => {
  for (const [input, expected] of [[0, 0], [-1, 0], [500, 20_000], [32_000.4, 32_000], [9e9, 2_000_000], ['lots', 0]]) {
    const { store } = await storeWith(JSON.stringify({ chatCompactAtTokens: input }))
    assert.equal(store.get().chatCompactAtTokens, expected)
  }
  const { store, file } = await storeWith('{}')
  await store.set({ chatCompactAtTokens: 32_000, chatCompactAtPercent: 0 })
  assert.equal((await AppSettingsStore.open(file)).get().chatCompactAtTokens, 32_000)
  assert.equal(store.get().chatMidTurnCompactTokens, 0)
})

test('reasoning effort is persisted as a model preference', async () => {
  const { store, file } = await storeWith('{}')
  await store.set({ chatReasoningEffort: 'high' })
  assert.equal(store.get().chatReasoningEffort, 'high')
  assert.match(await readFile(file, 'utf8'), /"chatReasoningEffort": "high"/)
})

test('legacy single-chat settings migrate into one selected peer', async () => {
  const { store } = await storeWith(JSON.stringify({
    chatThreadId: 'codex-thread',
    chatClaudeSessionId: 'claude-session',
    chatModelId: 'claude:opus',
    chatReasoningEffort: 'high'
  }))
  const settings = store.get()
  assert.equal(settings.chatPeers.length, 1)
  assert.equal(settings.chatSelectedPaneId, settings.chatPeers[0]!.paneId)
  assert.deepEqual(settings.chatPeers[0], {
    paneId: settings.chatPeers[0]!.paneId,
    provider: 'claude',
    threadId: 'claude:claude-session',
    codexThreadId: 'codex-thread',
    claudeSessionId: 'claude-session',
    antigravityConversationId: null,
    cursorSessionId: null,
    modelId: 'claude:opus',
    reasoningEffort: 'high',
    continuation: null
  })
})

test('a pending continuation digest and its source lineage survive settings reload', async () => {
  const continuation: ChatContinuation = {
    sourcePaneId: 'source-pane',
    sourceThreadId: 'source-thread',
    sourceProvider: 'codex',
    sourceTitle: 'Original chat',
    handoff: 'Compact handoff',
    createdAt: 1234
  }
  const { store, file } = await storeWith(JSON.stringify({
    chatPeers: [{
      paneId: 'target-pane',
      provider: 'claude',
      threadId: null,
      modelId: 'claude:opus',
      continuation
    }],
    chatSelectedPaneId: 'target-pane'
  }))

  assert.deepEqual(store.get().chatPeers[0]!.continuation, continuation)
  await new PeerSettings(store, 'target-pane').set({ chatContinuation: { ...continuation, handoff: null } })
  const reopened = await AppSettingsStore.open(file)
  assert.equal(reopened.get().chatPeers[0]!.continuation?.handoff, null)
  assert.equal(reopened.get().chatPeers[0]!.continuation?.sourceThreadId, 'source-thread')
})

test('an antigravity model routes the legacy settings to its own conversation field', async () => {
  const { store } = await storeWith(JSON.stringify({
    chatAntigravityConversationId: 'conv-1',
    chatModelId: 'agy:gemini-3.8-flash',
    chatPeers: [{ paneId: 'p1', provider: 'antigravity', threadId: 'agy:conv-2', modelId: 'agy:gemini-3.8-flash' }]
  }))
  const peer = store.get().chatPeers[0]!
  assert.equal(peer.provider, 'antigravity')
  assert.equal(peer.antigravityConversationId, 'conv-2')
  assert.equal(peer.threadId, 'agy:conv-2')
})

test('a pane title and activity time survive reload; junk values are dropped', async () => {
  const { store } = await storeWith(JSON.stringify({
    chatPeers: [
      { paneId: 'a', provider: 'claude', modelId: 'claude:opus', title: 'Sidebar work', updatedAt: 1700000000000 },
      { paneId: 'b', provider: 'codex', modelId: 'gpt', title: '', updatedAt: -5 }
    ]
  }))
  const [a, b] = store.get().chatPeers
  assert.equal(a!.title, 'Sidebar work')
  assert.equal(a!.updatedAt, 1700000000000)
  assert.equal('title' in b!, false)
  assert.equal('updatedAt' in b!, false)
})

test('saved project workspaces retain their own selected pane sets', async () => {
  const { store, file } = await storeWith(JSON.stringify({
    chatWorkspaces: [{
      cwd: '/projects/one',
      projectPath: '/projects/one',
      selectedPaneId: 'project-pane',
      peers: [{ paneId: 'project-pane', provider: 'codex', threadId: 'thread-one', modelId: 'gpt' }]
    }]
  }))

  const workspace = store.get().chatWorkspaces[0]!
  assert.equal(workspace.cwd, '/projects/one')
  assert.equal(workspace.selectedPaneId, 'project-pane')
  assert.equal(workspace.peers[0]?.threadId, 'thread-one')

  await store.set({ chatWorkspaces: [workspace] })
  const reopened = await AppSettingsStore.open(file)
  assert.equal(reopened.get().chatWorkspaces[0]?.peers[0]?.threadId, 'thread-one')
})
