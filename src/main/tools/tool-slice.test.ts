import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { setAppCheckoutPath } from '../app-checkout.ts'
import { parseToolSliceCatalog } from '../../shared/tool-slices.ts'
import { appTools } from './app/index.ts'
import { batchTools } from './batch/index.ts'
import { browserTools } from './browser/index.ts'
import { cdpTools } from './cdp/index.ts'
import { captureTools } from './capture/index.ts'
import { createToolRegistry } from './index.ts'
import { nativeInstrumentTools } from './native-instrument/index.ts'
import { mediaTools } from './media/index.ts'
import { credentialVaultTools } from './credential-vault/index.ts'
import { peerChatTools } from './peer-chats/index.ts'
import { searchTools } from './search/index.ts'
import { siteTools } from './site/index.ts'
import type { ResearchDependencies } from './search/research/service.ts'
import { measureToolContextBudget } from './tool-context-budget.ts'
import { applyToolSliceById, loadToolSliceCatalog, resetToolSliceCatalogCache, validateToolSliceCatalog } from './tool-slice.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const root = '/tmp/closedai-tool-slice'

function stubHost(): null {
  return null
}

function minimalResearch(): ResearchDependencies {
  const document = {
    url: 'https://example.com/', title: 'x', text: 'x', contentType: 'text/plain',
    sha256: 'hash', incomplete: false, representation: 'static_text' as const
  }
  return {
    owner: (caller) => ({
      paneId: caller.paneId!, threadId: caller.threadId!, turnId: caller.turnId, workspace: root
    }),
    collect: async () => document,
    read: async () => document.text,
    remove: async () => {},
    openLive: () => 'tab-stub'
  }
}

function fullRegistry() {
  let registry = createToolRegistry([])
  registry = createToolRegistry([
    nativeInstrumentTools(stubHost as never, () => false),
    credentialVaultTools(stubHost, stubHost),
    appTools(stubHost, stubHost),
    mediaTools({ app: stubHost, ui: stubHost, page: stubHost, record: stubHost as never }),
    browserTools(() => stubHost(), () => stubHost(), () => stubHost()),
    siteTools(() => stubHost(), () => stubHost(), () => stubHost()),
    cdpTools(stubHost, undefined, () => stubHost()),
    captureTools(stubHost, stubHost as never),
    searchTools({ research: minimalResearch() }),
    peerChatTools(stubHost),
    batchTools(() => registry, { maxCalls: 16 })
  ])
  return registry
}

test('loadToolSliceCatalog reads scripts/tool-slices.json from app checkout (bundled main safe)', async () => {
  resetToolSliceCatalogCache()
  setAppCheckoutPath(repoRoot)
  const catalog = await loadToolSliceCatalog()
  assert.ok(catalog.slices.core)
  resetToolSliceCatalogCache()
})

test('tool slice catalog parses and every slice respects the Codex eager wire cap', async () => {
  const catalog = await loadToolSliceCatalog()
  assert.equal(catalog.version, 1)
  const registry = fullRegistry()
  assert.deepEqual(validateToolSliceCatalog(catalog, registry), [])
})

test('core slice swaps default browser eager tools for recall-first workspace set', async () => {
  const catalog = await loadToolSliceCatalog()
  const registry = fullRegistry()
  const baseline = measureToolContextBudget(registry)
  assert.deepEqual(baseline.eagerTools.map((row) => row.id), ['embedded_browser.page', 'closedai_app.state'])

  const core = applyToolSliceById(registry, catalog, 'core')
  assert.ok(core.eagerWireChars <= catalog.codexEagerWireCap)
  assert.ok(core.promotedIds.includes('closedai_app.state'))
  assert.ok(core.promotedIds.includes('peer_chats.recall'))
  const eager = measureToolContextBudget(core.registry).eagerTools.map((row) => row.id)
  assert.ok(!eager.includes('embedded_browser.page'))
})

test('browser slice prioritizes page and state within the wire cap', async () => {
  const catalog = await loadToolSliceCatalog()
  const browser = applyToolSliceById(fullRegistry(), catalog, 'browser')
  const eager = measureToolContextBudget(browser.registry).eagerTools.map((row) => row.id)
  assert.ok(eager.includes('embedded_browser.page'))
  assert.ok(eager.includes('closedai_app.state'))
})

test('research slice promotes headless session tools within the wire cap', async () => {
  const catalog = await loadToolSliceCatalog()
  const research = applyToolSliceById(fullRegistry(), catalog, 'research')
  assert.ok(research.promotedIds.includes('embedded_browser.session'))
  assert.ok(
    research.promotedIds.includes('embedded_browser.session.fetch_many') ||
    research.promotedIds.includes('site.discover.bootstrap')
  )
  assert.ok(research.eagerWireChars <= catalog.codexEagerWireCap)
})

test('full slice leaves registry default eager policy unchanged', async () => {
  const catalog = await loadToolSliceCatalog()
  const registry = fullRegistry()
  const full = applyToolSliceById(registry, catalog, 'full')
  assert.deepEqual(
    measureToolContextBudget(full.registry).eagerTools.map((row) => row.id),
    measureToolContextBudget(registry).eagerTools.map((row) => row.id)
  )
})

test('parse rejects malformed catalogs', () => {
  assert.throws(() => parseToolSliceCatalog(null), /object/)
  assert.throws(() => parseToolSliceCatalog({ version: 1, codexEagerWireCap: 3600 }), /slices/)
})
