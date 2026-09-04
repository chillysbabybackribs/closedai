import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ChatModel } from '../../shared/chat.js'
import { PROVIDER_CATALOG_TTL_MS, ProviderCatalogCache, WorkspaceCatalogs } from './provider-catalog-cache.js'

function model(id: string): ChatModel {
  return { id, label: id, provider: 'claude' } as unknown as ChatModel
}

test('a remembered catalog fills the picker at any age but only stands in for a start-up read while fresh', () => {
  let now = 1_000
  const catalogs = new WorkspaceCatalogs(() => now)
  catalogs.remember('claude', [model('claude:opus[1m]')], [{ name: 'opus' }])

  assert.deepEqual(catalogs.read('claude')?.models.map((entry) => entry.id), ['claude:opus[1m]'])
  assert.deepEqual(catalogs.read('claude', PROVIDER_CATALOG_TTL_MS)?.raw, [{ name: 'opus' }])

  now += PROVIDER_CATALOG_TTL_MS + 1
  assert.equal(catalogs.read('claude', PROVIDER_CATALOG_TTL_MS), null)
  assert.deepEqual(catalogs.read('claude')?.models.map((entry) => entry.id), ['claude:opus[1m]'])
})

test('catalogs survive a relaunch through the cache file, so only the active provider needs to start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-catalogs-'))
  const path = join(dir, 'provider-catalogs.json')
  try {
    const first = await ProviderCatalogCache.open(path, () => 5)
    first.forWorkspace('/a').remember('antigravity', [model('agy:gemini')], [{ id: 'gemini' }])
    first.forWorkspace('/b').remember('cursor', [model('cursor:opus')])
    await first.flush()
    assert.ok((await readFile(path, 'utf8')).includes('agy:gemini'))

    const second = await ProviderCatalogCache.open(path, () => 10)
    assert.deepEqual(second.forWorkspace('/a').read('antigravity')?.raw, [{ id: 'gemini' }])
    assert.deepEqual(second.forWorkspace('/b').read('cursor')?.models.map((entry) => entry.id), ['cursor:opus'])
    assert.equal(second.forWorkspace('/a').read('cursor'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a missing or broken cache file opens empty rather than failing start-up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-catalogs-'))
  try {
    const missing = await ProviderCatalogCache.open(join(dir, 'none.json'))
    assert.equal(missing.forWorkspace('/a').read('codex'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
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
