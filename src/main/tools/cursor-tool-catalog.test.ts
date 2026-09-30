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
import { resolveCursorToolCatalog } from './cursor-tool-catalog.ts'

const root = '/tmp/closedai-cursor-catalog'

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

test('resolveCursorToolCatalog attaches every namespace when slicing is off', async () => {
  const bundle = await resolveCursorToolCatalog(fullRegistry(), { chatToolSliceEnabled: false }, {
    prompt: 'Fix tests', surface: null
  })
  assert.equal(bundle.sliceId, null)
  assert.equal(bundle.namespaces, null)
})

test('resolveCursorToolCatalog preserves every enabled namespace for core workspace turns', async () => {
  const bundle = await resolveCursorToolCatalog(fullRegistry(), { chatToolSliceEnabled: true }, {
    prompt: 'Fix the failing test', surface: null
  })
  assert.equal(bundle.sliceId, 'core')
  assert.equal(bundle.namespaces, null)
})

test('resolveCursorToolCatalog preserves recall and other capabilities for browser intent', async () => {
  const bundle = await resolveCursorToolCatalog(fullRegistry(), { chatToolSliceEnabled: true }, {
    prompt: 'Summarize this page', surface: null
  })
  assert.equal(bundle.sliceId, 'browser')
  assert.equal(bundle.namespaces, null)
})

test('notepad structural UI work retains notes and UI inspection capabilities', async () => {
  const bundle = await resolveCursorToolCatalog(fullRegistry(), { chatToolSliceEnabled: true }, {
    prompt: 'Lighten the notes header and change the chat layout', surface: null
  })
  assert.equal(bundle.sliceId, 'core')
  // null instructs the ACP bridge to attach all enabled endpoints, including future ones.
  assert.equal(bundle.namespaces, null)
})
