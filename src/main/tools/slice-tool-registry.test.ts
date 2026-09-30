import assert from 'node:assert/strict'
import test from 'node:test'

import { appTools } from './app/index.ts'
import { createToolRegistry } from './index.ts'
import { peerChatTools } from './peer-chats/index.ts'
import { searchTools } from './search/index.ts'
import { browserTools } from './browser/index.ts'
import { resolveSlicedToolRegistry, toolAdvertisedEager } from './slice-tool-registry.ts'

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
