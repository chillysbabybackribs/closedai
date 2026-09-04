import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatModel } from '../../shared/chat.js'
import { PROVIDER_CATALOG_TTL_MS, ProviderCatalogCache, WorkspaceCatalogs } from './provider-catalog-cache.js'

function model(id: string): ChatModel {
  return { id, label: id, provider: 'claude' } as unknown as ChatModel
}

test('a remembered catalog is readable until its TTL passes, then reads as missing', () => {
  let now = 1_000
  const catalogs = new WorkspaceCatalogs(() => now)
  catalogs.remember('claude', [model('claude:opus[1m]')], [{ name: 'opus' }])

  assert.deepEqual(catalogs.read('claude')?.models.map((entry) => entry.id), ['claude:opus[1m]'])
  assert.deepEqual(catalogs.read('claude')?.raw, [{ name: 'opus' }])

  now += PROVIDER_CATALOG_TTL_MS + 1
  assert.equal(catalogs.read('claude'), null)
})

test('an empty catalog is not remembered, and a reading without raw keeps the raw already held', () => {
  const catalogs = new WorkspaceCatalogs(() => 5)
  catalogs.remember('antigravity', [])
  assert.equal(catalogs.read('antigravity'), null)

  catalogs.remember('antigravity', [model('agy:a')], [{ id: 'a' }])
  catalogs.remember('antigravity', [model('agy:a'), model('agy:b')])
  assert.deepEqual(catalogs.read('antigravity')?.models.map((entry) => entry.id), ['agy:a', 'agy:b'])
  assert.deepEqual(catalogs.read('antigravity')?.raw, [{ id: 'a' }])

  catalogs.forget('antigravity')
  assert.equal(catalogs.read('antigravity'), null)
})

test('catalogs are shared per workspace: two panes of one cwd see the same entries, another cwd does not', () => {
  const cache = new ProviderCatalogCache(() => 5)
  const a = cache.forWorkspace('/a')
  a.remember('codex', [model('gpt-5.6-sol')])

  assert.equal(cache.forWorkspace('/a'), a)
  assert.deepEqual(cache.forWorkspace('/a').read('codex')?.models.map((entry) => entry.id), ['gpt-5.6-sol'])
  assert.equal(cache.forWorkspace('/b').read('codex'), null)
})
