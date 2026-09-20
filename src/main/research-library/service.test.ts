import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { ResearchLibrary } from './service.js'
import { LibraryStore, DEFAULT_SETTINGS, MAX_PAPERS } from './store.js'
import { parsePapers } from './provider.js'
import { libraryTool } from '../tools/search/library.js'

const now = Date.parse('2026-09-20T12:00:00.000Z')
function papers(topic: string, id = '2609.12345', abstract = 'Memory retrieval for language model agents') {
  return parsePapers([{ paperId: id, title: 'Reliable memory retrieval', abstract,
    publicationDate: '2026-09-19T00:00:00.000Z' }], topic, '2026-06-22', new Date(now).toISOString())
}

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'closedai-library-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'library.json')
  return { path, store: new LibraryStore(path) }
}

test('refresh deduplicates across topics, survives reopen, and never fetches on read', async (t) => {
  const { path, store } = await fixture(t)
  let calls = 0
  const library = new ResearchLibrary(store, async (topic) => { calls++; return papers(topic) }, () => now)
  assert.equal((await library.snapshot()).total, 0)
  assert.equal(calls, 0)
  const snapshot = await library.refresh()
  assert.equal(snapshot.refreshing, false)
  assert.equal(snapshot.total, 1)
  assert.equal(snapshot.lastRefresh?.added, 1)
  assert.equal(snapshot.papers[0]!.topics.length, 3)
  assert.equal(calls, 3)
  const reopened = new ResearchLibrary(new LibraryStore(path), async () => { throw new Error('Must not fetch') }, () => now)
  assert.equal((await reopened.search('memory retrieval')).results.length, 1)
  const record = await reopened.read('2609.12345')
  assert.equal(record.trust, 'untrusted')
  assert.equal(record.evidence, 'paper_metadata_and_abstract')
  assert.equal(record.stale, false)
  await library.refresh()
  assert.equal((await library.snapshot()).lastRefresh?.added, 0)
})

test('partial and failed refreshes preserve prior evidence and report failures honestly', async (t) => {
  const { store } = await fixture(t)
  let stage = 0
  const library = new ResearchLibrary(store, async (topic) => {
    if (stage === 2 || (stage === 1 && topic !== DEFAULT_SETTINGS.topics[0])) throw new Error('HTTP 503')
    return papers(topic, stage ? '2609.54321' : '2609.12345')
  }, () => now)
  await library.refresh()
  stage = 1
  const partial = await library.refresh()
  assert.equal(partial.total, 2)
  assert.equal(partial.lastRefresh?.state, 'partial')
  assert.equal(partial.lastRefresh?.errors.length, 2)
  stage = 2
  const failed = await library.refresh()
  assert.equal(failed.total, 2)
  assert.equal(failed.lastRefresh?.state, 'failed')
  assert.equal(failed.lastRefresh?.received, 0)
})

test('simultaneous refreshes share work; cancellation discards partial collection and prevents settings races', async (t) => {
  const { store } = await fixture(t)
  const library = new ResearchLibrary(store, () => new Promise(() => {}), () => now)
  const first = library.refresh()
  assert.equal(library.refresh(), first)
  assert.equal((await library.snapshot()).refreshing, true)
  await assert.rejects(library.configure(DEFAULT_SETTINGS), /Stop the refresh/)
  library.cancel()
  const snapshot = await first
  assert.equal(snapshot.refreshing, false)
  assert.equal(snapshot.total, 0)
  assert.equal(snapshot.lastRefresh?.state, 'cancelled')
})

test('dismissals survive refresh/reopen and disabled retrieval denies both search and exact reads', async (t) => {
  const { store, path } = await fixture(t)
  const library = new ResearchLibrary(store, async (topic) => papers(topic), () => now)
  await library.refresh()
  await library.dismiss('2609.12345')
  assert.equal((await library.refresh()).total, 0)
  const reopened = new ResearchLibrary(new LibraryStore(path), async () => [], () => now)
  assert.equal((await reopened.search('memory retrieval')).results.length, 0)
  await assert.rejects(reopened.read('2609.12345'), /active library/)
  assert.equal((await reopened.restore()).total, 1)
  await reopened.configure({ ...DEFAULT_SETTINGS, enabled: false })
  await assert.rejects(reopened.search('memory'), /disabled/)
  await assert.rejects(reopened.read('2609.12345'), /disabled/)
  assert.equal((await reopened.snapshot()).total, 1)
})

test('topic removal and age limits exclude irrelevant/expired papers; query budgets are enforced', async (t) => {
  const { store } = await fixture(t)
  let clock = now
  const library = new ResearchLibrary(store, async (topic) => papers(topic), () => clock)
  await library.refresh()
  await assert.rejects(library.search('memory', 100), /Limit/)
  await assert.rejects(library.configure({ ...DEFAULT_SETTINGS, topics: [] }), /./)
  assert.equal((await library.search('unrelated telescope')).results.length, 0)
  clock += 8 * 86400000
  assert.equal((await library.read('2609.12345')).stale, true)
  clock += 100 * 86400000
  assert.equal((await library.search('memory')).results.length, 0)
  clock = now
  await library.configure({ ...DEFAULT_SETTINGS, topics: ['Computer vision'] })
  assert.equal((await library.snapshot()).total, 0)
})

test('bounded retention and model output; tool exposes no mutations', async (t) => {
  const { store } = await fixture(t)
  const library = new ResearchLibrary(store, async (topic) => Array.from({ length: 180 }, (_, i) =>
    papers(topic, `2609.${String(DEFAULT_SETTINGS.topics.indexOf(topic) * 180 + i).padStart(5, '0')}`, 'memory retrieval '.repeat(500))[0]!), () => now)
  assert.equal((await library.refresh()).total, MAX_PAPERS)
  const result = await library.search('memory retrieval', 10)
  assert.equal(result.results.length, 10)
  assert.ok(result.results.every((paper) => paper.excerpt.length <= 400))
  assert.ok(JSON.stringify(result).length < 16000)
  assert.deepEqual(libraryTool(library).actions?.map((action) => action.name), ['status', 'search', 'read'])
  const response = await libraryTool(library).run({ action: 'search', query: 'memory', limit: 999 }, {
    callId: 'test', signal: new AbortController().signal
  })
  assert.equal(response.isError, true)
})

test('damaged disk state is preserved; failed persistence never publishes an in-memory change', async (t) => {
  const { path, store } = await fixture(t)
  await writeFile(path, '{broken')
  await assert.rejects(store.load(), /preserved/)
  assert.equal(await readFile(path, 'utf8'), '{broken')
  await rm(path)
  class FailingStore extends LibraryStore {
    override async save(): Promise<void> { throw new Error('Disk full') }
  }
  const library = new ResearchLibrary(new FailingStore(path), async () => [], () => now)
  await assert.rejects(library.configure({ ...DEFAULT_SETTINGS, enabled: false }), /Disk full/)
  assert.equal((await library.status()).settings.enabled, true)
})
