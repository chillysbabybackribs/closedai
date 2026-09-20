import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchTools } from '../index.js'
import { ToolRegistry } from '../../registry.js'
import type { ToolContext } from '../../tool.js'
import { ResearchService } from './service.js'
import { SourceStore } from './source-reader.js'
import type { ResearchSnapshot } from '../../../../shared/web-research.js'

const context: ToolContext = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const url = 'https://example.com/paper.pdf'

async function fixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const root = await mkdtemp(join(tmpdir(), 'research-expansion-'))
  const store = new SourceStore(root, async () => new Response('PDF bytes', { headers: { 'content-type': 'application/pdf' } }))
  let service!: ResearchService
  let contentsCalls = 0
  let reply = async (_signal: AbortSignal): Promise<Response> => Response.json({
    statuses: [{ status: 'success' }], results: [{ url, title: 'Paper', text: 'Expanded evidence '.repeat(12_000) }]
  })
  const namespace = searchTools({
    readKey: async () => 'fixture',
    fetch: async (target, init) => {
      if (String(target).endsWith('/contents')) { contentsCalls++; return reply(init!.signal!) }
      const body = JSON.parse(String(init?.body))
      assert.equal(body.contents.text.maxCharacters, 10_000)
      return Response.json({ results: [{ url, title: 'Paper', text: 'x'.repeat(10_000) }] })
    },
    research: {
      owner: (caller) => ({ paneId: caller.paneId!, threadId: caller.threadId!, turnId: caller.turnId, workspace: '/workspace' }),
      collect: (...args) => store.collect(...args),
      retain: (run, source, page, coverage) => store.retain(run, source, page, 'provider_text', coverage),
      replace: (...args) => store.replace(...args), discard: (...args) => store.discard(...args),
      read: (...args) => store.read(...args), remove: (run) => store.remove(run)
    },
    onResearchCreated: (created) => { service = created }
  })
  t.after(async () => { service.dispose(); await rm(root, { recursive: true, force: true }) })
  const registry = new ToolRegistry([namespace])
  async function start(knownUrl = false) {
    const result = await registry.call({ namespace: 'search', tool: 'run', arguments: {
      action: 'start', max_text_chars: 10_000, presentation: 'background',
      ...(knownUrl ? { urls: [url] } : { queries: [{ query: 'paper', intent: 'research', providers: ['exa'] }] })
    } }, context)
    assert.equal(result.isError, undefined)
    const snapshot = JSON.parse((result.content[0] as { text: string }).text) as ResearchSnapshot
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = service.read(snapshot.runId, context)
      if (current.state !== 'running') return current
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('Fixture did not settle')
  }
  return { service, registry, store, start, contentsCalls: () => contentsCalls, setReply: (next: typeof reply) => { reply = next } }
}

test('registry expansion replaces a completed source beyond 120k, preserves identity, and pages the new hash', async (t) => {
  const f = await fixture(t)
  const run = await f.start()
  const before = run.sources[0]
  assert.equal(before.incomplete, true)
  const result = await f.registry.call({ namespace: 'search', tool: 'run', arguments: {
    action: 'expand', run_id: run.runId, source_id: before.id
  } }, context)
  assert.equal(result.isError, undefined)
  const after = f.service.read(run.runId, context).sources[0]
  assert.equal(after.id, before.id)
  assert.equal(after.requestedUrl, url)
  assert.deepEqual(after.discovery, before.discovery)
  assert.equal(after.chars, 216_000)
  assert.equal(after.incomplete, false)
  assert.notEqual(after.sha256, before.sha256)
  assert.equal(after.contentProvider, 'exa')
  assert.equal(after.expanding, false)
  assert.equal(f.contentsCalls(), 1)
  const excerpt = await f.service.source(run.runId, after.id, context, 200_000, 1000) as { text: string; nextOffset: number }
  assert.equal(excerpt.text.length, 1000)
  assert.equal(excerpt.nextOffset, 201_000)
})

test('failed PDF read can explicitly use Exa without claiming native PDF parsing', async (t) => {
  const f = await fixture(t)
  const run = await f.start(true)
  assert.equal(run.sources[0].state, 'failed')
  await f.service.expand(run.runId, run.sources[0].id, context, { maxTextChars: 0 }, 'exa')
  const after = f.service.read(run.runId, context).sources[0]
  assert.equal(after.state, 'ready')
  assert.equal(after.representation, 'provider_text')
  assert.equal(after.error, undefined)
})

test('failed and shorter expansions keep earlier text, metadata, and source id', async (t) => {
  const f = await fixture(t)
  const run = await f.start()
  const source = run.sources[0]
  f.setReply(async () => { throw new Error('provider unavailable') })
  await assert.rejects(f.service.expand(run.runId, source.id, context, { maxTextChars: 0 }), /provider unavailable/)
  f.setReply(async () => Response.json({ results: [{ url, text: 'Shorter text' }] }))
  const shorter = await f.service.expand(run.runId, source.id, context, { maxTextChars: 0 }) as { changed: boolean }
  assert.equal(shorter.changed, false)
  assert.equal(f.service.read(run.runId, context).sources[0].sha256, source.sha256)
  assert.equal((await f.store.read(run.runId, source.id)).length, 10_000)
})

test('expansion ownership, duplicate requests, later turns, and cancellation preserve existing evidence', async (t) => {
  const f = await fixture(t)
  const run = await f.start()
  const source = run.sources[0]
  await assert.rejects(f.service.expand(run.runId, source.id, { ...context, paneId: 'other' }, {}), /unavailable/)
  f.setReply(async (signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  const later = { ...context, turnId: 'later' }
  const operation = f.service.expand(run.runId, source.id, later, { maxTextChars: 0 })
  const rejected = assert.rejects(operation, /cancelled|ended/)
  await tick()
  f.service.reconcile('pane', 'thread', 'later')
  assert.equal(f.service.read(run.runId, later).sources[0].expanding, true)
  await assert.rejects(f.service.expand(run.runId, source.id, later, {}), /already expanding/)
  f.service.cancelPane('pane', 'thread', 'later')
  await rejected
  assert.equal(f.service.read(run.runId, later).pending, 0)
  assert.equal(f.service.read(run.runId, later).sources[0].sha256, source.sha256)
  assert.equal((await f.store.read(run.runId, source.id)).length, 10_000)
  await assert.rejects(f.service.expand(run.runId, source.id, later, {}), /unstopped/)
})
