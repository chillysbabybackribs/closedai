import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatModel } from '../../shared/chat.js'
import { connectedProviderSources, mergeProviderCatalog, providerSourcesFromHub } from './ipc.js'

const model = (id: string): ChatModel => ({
  provider: 'codex',
  id,
  displayName: id,
  description: '',
  defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [],
  isDefault: false
})

test('mergeProviderCatalog prefers live models over cache', () => {
  assert.deepEqual(mergeProviderCatalog('codex', [model('live')], [model('cached')]).map((entry) => entry.id), ['live'])
  assert.deepEqual(mergeProviderCatalog('codex', [], [model('cached')]).map((entry) => entry.id), ['cached'])
})

test('connectedProviderSources keeps ready providers that have models', () => {
  const ready = { provider: 'codex' as const, connection: { state: 'ready' as const, message: '' }, models: [model('a')] }
  const signedOut = { provider: 'claude' as const, connection: { state: 'signed-out' as const, message: '' }, models: [model('claude:opus')] }
  assert.deepEqual(connectedProviderSources([ready, signedOut]), [ready])
})

test('providerSourcesFromHub merges cache into each provider row', () => {
  const rows = providerSourcesFromHub(
    (provider) => ({
      provider,
      connection: { state: 'ready', message: '' },
      models: provider === 'codex' ? [] : [model(`${provider}:x`)]
    }),
    (provider) => (provider === 'codex' ? [model('gpt')] : undefined)
  )
  assert.deepEqual(rows.find((entry) => entry.provider === 'codex')?.models.map((entry) => entry.id), ['gpt'])
})
