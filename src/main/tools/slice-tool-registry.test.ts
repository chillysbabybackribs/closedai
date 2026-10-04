import assert from 'node:assert/strict'
import test from 'node:test'

import { appTools } from './app/index.ts'
import { createToolRegistry } from './index.ts'
import { peerChatTools } from './peer-chats/index.ts'
import { searchTools } from './search/index.ts'
import { browserTools } from './browser/index.ts'
import { attachToolSliceForTurn } from './provider-tool-slice-turn.ts'
import { resolveSlicedToolRegistry, slicedToolRegistryKey, toolAdvertisedEager } from './slice-tool-registry.ts'

function stubHost(): null {
  return null
}

function registry() {
  return createToolRegistry([
    appTools(stubHost, stubHost),
    searchTools(),
    peerChatTools(stubHost),
    browserTools(() => stubHost(), () => stubHost(), () => stubHost())
  ])
}

test('resolveSlicedToolRegistry leaves advertisement null when slicing is off', async () => {
  const bundle = await resolveSlicedToolRegistry(registry(), { chatToolSliceEnabled: false }, { prompt: 'fix tests', surface: null })
  assert.equal(bundle.sliceId, null)
  assert.equal(bundle.advertisement, null)
})

test('resolveSlicedToolRegistry builds core advertisement with recall eager', async () => {
  const live = registry()
  const bundle = await resolveSlicedToolRegistry(live, { chatToolSliceEnabled: true }, { prompt: 'fix tests', surface: null })
  assert.equal(bundle.sliceId, 'core')
  assert.ok(bundle.advertisement)
  assert.ok(bundle.promotedIds.includes('peer_chats.recall'))
  const page = live.enabledNamespaces().find((ns) => ns.name === 'embedded_browser')!.tools.find((tool) => tool.name === 'page')!
  assert.equal(toolAdvertisedEager(bundle.advertisement, 'embedded_browser', page), false)
  assert.equal(toolAdvertisedEager(null, 'embedded_browser', page), true)
})

test('toolAdvertisedEager follows browser slice promotions', async () => {
  const bundle = await resolveSlicedToolRegistry(registry(), { chatToolSliceEnabled: true }, {
    prompt: 'summarize this page',
    surface: { tabId: 'tab-test', title: 'Example', url: 'https://example.com/', isLoading: false }
  })
  assert.equal(bundle.sliceId, 'browser')
  const page = registry().enabledNamespaces().find((ns) => ns.name === 'embedded_browser')!.tools.find((tool) => tool.name === 'page')!
  assert.equal(toolAdvertisedEager(bundle.advertisement, 'embedded_browser', page), true)
})


test('baseline task changes keep Claude and Antigravity processes, but switching modes reapplies policy', async () => {
  for (const provider of ['claude', 'antigravity'] as const) {
    let applied = 0
    const state = { cacheKey: null as string | null }
    const settings = { chatToolSliceEnabled: false, chatCursorBaselineEnabled: true }
    const deps = { provider, paneId: 'pane', activeTurnId: null, registry: registry(), settings,
      prompt: 'Fix tests', surface: null, chatProjectPath: '/external-project', state,
      cacheKeyOf: slicedToolRegistryKey, onApplied: async () => { applied++ } }
    await attachToolSliceForTurn(deps)
    await attachToolSliceForTurn({ ...deps, prompt: 'Summarize this page' })
    await attachToolSliceForTurn({ ...deps, prompt: 'Research the latest browser release' })
    assert.equal(applied, 1)
    settings.chatCursorBaselineEnabled = false
    await attachToolSliceForTurn(deps)
    assert.equal(applied, 2, 'mode change refreshes spawn-time settings even with slices already off')
  }
})
