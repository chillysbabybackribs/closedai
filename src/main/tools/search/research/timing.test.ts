import assert from 'node:assert/strict'
import test from 'node:test'
import { ResearchService } from './service.js'
import { SearchRouter } from '../router.js'
import type { ResearchTimingEvent } from './timing.js'

test('production collection reports first evidence separately from completion and ignores broken trace subscribers', async (t) => {
  let now = 100
  const events: ResearchTimingEvent[] = []
  const service = new ResearchService(new SearchRouter([]), {
    now: () => now,
    owner: () => ({ paneId: 'pane', threadId: 'thread', turnId: 'turn', workspace: '/test' }),
    collect: async (url) => { now = 250; return { url, title: 'Source', text: 'private source text', contentType: 'text/plain', sha256: 'hash', incomplete: false, representation: 'static_text' } },
    read: async () => '', remove: async () => {},
    trace: (_owner, event) => { events.push(event); if (event.event === 'first_source') throw new Error('diagnostic failure') }
  })
  t.after(() => service.dispose())
  const context = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }
  const run = service.start({ queries: [], urls: ['https://example.com/private'], maxSources: 1, deadlineMs: 30_000, presentation: 'background' }, context)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(service.read(run.runId, context).state, 'completed')
  assert.deepEqual(events.map((event) => event.event), ['started', 'read_started', 'first_source', 'read_finished', 'finished'])
  assert.equal(events.find((event) => event.event === 'first_source')?.elapsedMs, 150)
  assert.equal(events.find((event) => event.event === 'read_finished')?.durationMs, 150)
  assert.doesNotMatch(JSON.stringify(events), /private|example\.com/)
})
