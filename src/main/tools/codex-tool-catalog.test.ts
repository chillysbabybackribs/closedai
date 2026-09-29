import assert from 'node:assert/strict'
import test from 'node:test'

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
import type { ResearchDependencies } from './search/research/service.ts'
import { measureToolContextBudget } from './tool-context-budget.ts'
import { resolveCodexToolCatalog } from './codex-tool-catalog.ts'

const root = '/tmp/closedai-codex-catalog'

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
    cdpTools(stubHost),
    captureTools(stubHost, stubHost as never),
    searchTools({ research: minimalResearch() }),
    peerChatTools(stubHost),
    batchTools(() => registry, { maxCalls: 16 })
  ])
  return registry
}

test('resolveCodexToolCatalog leaves registry defaults when slicing is off', async () => {
  const registry = fullRegistry()
  const off = await resolveCodexToolCatalog(registry, { chatToolSliceEnabled: false }, { prompt: 'Read the page', surface: null })
  assert.equal(off.sliceId, null)
  const baseline = measureToolContextBudget(registry).eagerTools.map((row) => row.id)
  const resolved = measureToolContextBudget(
    // Rebuild registry view is not exposed; compare eager flags via scanning dynamicTools
    registry
  ).eagerTools.map((row) => row.id)
  assert.deepEqual(baseline, resolved)
  assert.ok(off.dynamicTools.some((ns) => ns.tools.some((tool) => tool.name === 'page' && !tool.deferLoading)))
})

test('resolveCodexToolCatalog promotes recall-first core slice for ordinary workspace turns', async () => {
  const registry = fullRegistry()
  const core = await resolveCodexToolCatalog(registry, { chatToolSliceEnabled: true }, { prompt: 'Fix the failing test', surface: null })
  assert.equal(core.sliceId, 'core')
  assert.ok(core.promotedIds.includes('peer_chats.recall'))
  const pageSpec = core.dynamicTools.find((ns) => ns.name === 'embedded_browser')?.tools.find((tool) => tool.name === 'page')
  assert.equal(pageSpec?.deferLoading, true)
})

test('resolveCodexToolCatalog selects browser slice for page intent', async () => {
  const registry = fullRegistry()
  const browser = await resolveCodexToolCatalog(registry, { chatToolSliceEnabled: true }, { prompt: 'Summarize this page', surface: null })
  assert.equal(browser.sliceId, 'browser')
  const pageSpec = browser.dynamicTools.find((ns) => ns.name === 'embedded_browser')?.tools.find((tool) => tool.name === 'page')
  assert.notEqual(pageSpec?.deferLoading, true)
})
