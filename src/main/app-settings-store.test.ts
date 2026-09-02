import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore, DEFAULT_APP_SETTINGS } from './app-settings-store.ts'

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
    modelId: 'claude:opus',
    reasoningEffort: 'high'
  })
})
