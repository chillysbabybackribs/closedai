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

const root = '/tmp/closedai-tool-budget'

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

test('eager Codex tool wire stays within the regression budget', () => {
  const budget = measureToolContextBudget(fullRegistry())
  assert.equal(budget.toolCount, 29)
  assert.ok(budget.deferredWireChars > budget.eagerWireChars, 'most schema weight should stay deferred')
  assert.ok(budget.eagerWireChars <= 3_600, `eager wire grew to ${budget.eagerWireChars}`)
  assert.ok(budget.deferredWireChars <= 65_500, `deferred full wire grew to ${budget.deferredWireChars}`)
  assert.ok(budget.advertisedTokens <= 1_850, `advertised tokens grew to ${budget.advertisedTokens}`)
  assert.deepEqual(budget.eagerTools.map((row) => row.id), ['embedded_browser.page', 'closedai_app.state'])
  assert.ok(budget.deferredTools.some((row) => row.id === 'search.query'), 'search.query stays available via deferral')
})
