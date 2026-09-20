import assert from 'node:assert/strict'
import test from 'node:test'
import { SearchRouter } from '../router.js'
import type { ProviderSearchResult } from '../types.js'
import { ResearchService } from './service.js'

const context = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const source = (url: string) => ({ provider: 'brave' as const, url, title: url, snippet: '' })

test('fast general discovery cannot spend the slots for selected and later preferred evidence', async (t) => {
  let release!: (value: ProviderSearchResult) => void
  const slow = new Promise<ProviderSearchResult>((resolve) => { release = resolve })
  const reads: string[] = []
  const service = new ResearchService(new SearchRouter([{ provider: 'brave', search: async (request) => request.query === 'slow' ? slow : {
    provider: 'brave', results: Array.from({ length: 6 }, (_, i) => source(`https://general.example/${i}`))
  } }]), {
    owner: () => ({ paneId: 'pane', threadId: 'thread', turnId: 'turn', workspace: '/test' }),
    collect: async (url) => { reads.push(url); return { url, title: url, text: 'evidence', contentType: 'text/plain', sha256: 'hash', incomplete: false, representation: 'static_text' } },
    read: async () => 'evidence', remove: async () => {}
  })
  t.after(() => service.dispose())
  const run = service.start({ queries: ['fast', 'slow'].map((query) => ({ query, intent: 'research', depth: 'quick', count: 6, preferredDomains: ['primary.example'] })),
    urls: [], maxSources: 4, deadlineMs: 30_000, presentation: 'background' }, context)
  await tick()
  assert.equal(reads.length, 2)
  assert.equal(service.read(run.runId, context).sources.filter((item) => item.state === 'deferred').length, 4)
  service.extend(run.runId, [], ['https://general.example/5'], context)
  await tick()
  assert.equal(reads.length, 3)
  assert.equal(reads.at(-1), 'https://general.example/5')
  release({ provider: 'brave', results: [source('https://primary.example/original')] })
  await tick()
  const result = service.read(run.runId, context)
  assert.equal(result.state, 'completed')
  assert.equal(result.readCount, 4)
  assert.equal(reads.at(-1), 'https://primary.example/original')
  assert.equal(result.sources.find((item) => item.url.endsWith('/original'))?.selection, 'preferred_domain')
  const unread = result.sources.find((item) => item.state === 'deferred')!
  await assert.rejects(service.source(run.runId, unread.id, context, 0, 500), /not ready/)
})

test('zero reservation uses the full budget, bounded candidate overflow is visible, and cancellation preserves ready evidence', async (t) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const service = new ResearchService(new SearchRouter([{ provider: 'brave', search: async () => ({ provider: 'brave', results: [] }) }]), {
    owner: () => ({ paneId: 'pane', threadId: 'thread', turnId: 'turn', workspace: '/test' }),
    collect: async (url) => {
      if (url.endsWith('/slow')) await gate
      return { url, title: url, text: 'evidence', contentType: 'text/plain', sha256: 'hash', incomplete: false, representation: 'static_text' }
    }, read: async () => 'evidence', remove: async () => {}
  })
  t.after(() => { release(); service.dispose() })
  const run = service.start({ queries: [], urls: ['https://example.com/ready', 'https://example.com/slow'], maxSources: 2,
    reserveSources: 0, deadlineMs: 30_000, presentation: 'background' }, context)
  await tick()
  for (let batch = 0; batch < 4; batch++) service.extend(run.runId, [], Array.from({ length: 20 }, (_, i) => `https://example.com/${batch}/${i}`), context)
  const before = service.read(run.runId, context)
  assert.equal(before.sourceCount, 80)
  assert.equal(before.readCount, 2)
  assert.equal(before.omittedCandidates, 2)
  assert.match(before.errors.at(-1)!.message, /Candidate budget/)
  service.cancel(run.runId, context)
  const ready = service.read(run.runId, context).sources.find((item) => item.state === 'ready')!
  const retained = await service.source(run.runId, ready.id, context, 0, 200) as { text: string }
  assert.equal(retained.text, 'evidence')
})
