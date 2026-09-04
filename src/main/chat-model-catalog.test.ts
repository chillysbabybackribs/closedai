import assert from 'node:assert/strict'
import test from 'node:test'
import { loadChatModels } from './chat-model-catalog.js'

test('loads every visible model page, deduplicates models, and keeps an available preference', async () => {
  const requests: unknown[] = []
  const client = {
    request: async <T>(_method: string, params?: unknown): Promise<T> => {
      requests.push(params)
      const cursor = (params as { cursor?: string }).cursor
      return (cursor
        ? { data: [model('terra', false), model('luna', false)], nextCursor: null }
        : { data: [model('sol', true), model('terra', false)], nextCursor: 'next' }) as T
    }
  }

  const catalog = await loadChatModels(client, 'terra', null, new Map([['sol', 872_000], ['terra', 872_000], ['luna', 872_000]]))

  assert.deepEqual(catalog.models.map((entry) => entry.id), ['sol', 'terra', 'luna'])
  assert.deepEqual(catalog.models.map((entry) => entry.contextWindow), [872_000, 872_000, 872_000])
  assert.equal(catalog.selectedModel, 'terra')
  assert.equal(catalog.selectedReasoningEffort, 'medium')
  assert.deepEqual(requests, [
    { limit: 100, includeHidden: false },
    { limit: 100, includeHidden: false, cursor: 'next' }
  ])
})

test('falls back to the advertised default when a saved model is unavailable', async () => {
  const client = {
    request: async <T>(): Promise<T> => ({ data: [model('sol', true)], nextCursor: null }) as T
  }
  const catalog = await loadChatModels(client, 'retired-model')
  assert.equal(catalog.selectedModel, 'sol')
})

test('keeps a supported saved effort and falls back when a model does not support it', async () => {
  const client = {
    request: async <T>(): Promise<T> => ({ data: [model('sol', true)], nextCursor: null }) as T
  }
  assert.equal((await loadChatModels(client, 'sol', 'high')).selectedReasoningEffort, 'high')
  assert.equal((await loadChatModels(client, 'sol', 'ultra')).selectedReasoningEffort, 'medium')
})

function model(id: string, isDefault: boolean): Record<string, unknown> {
  return {
    id,
    displayName: id.toUpperCase(),
    description: `${id} description`,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast answers' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deeper reasoning' }
    ],
    isDefault
  }
}
