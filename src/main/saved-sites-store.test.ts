import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { SavedSitesStore, rankSavedFirst } from './saved-sites-store.ts'

const directories: string[] = []

after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

async function savedSitesFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'closedai-saved-sites-'))
  directories.push(directory)
  return join(directory, 'saved-sites.json')
}

test('saving, editing, and removing a site round-trips through the file', async () => {
  const filePath = await savedSitesFile()
  const store = await SavedSitesStore.open(filePath)
  const changes: number[] = []
  store.on('changed', (sites: unknown[]) => changes.push(sites.length))

  const site = store.save({ url: 'https://www.example.com/docs', title: 'Docs', favicon: 'https://example.com/icon.png', note: 'watch the changelog' })
  assert.equal(site.note, 'watch the changelog')
  assert.equal(site.lastCheckedAt, null)
  assert.equal(store.update(site.id, { note: 'release notes only', tags: ['Docs', 'docs', ' ai '] })?.tags.join(','), 'docs,ai')
  await store.flush()

  const reopened = await SavedSitesStore.open(filePath)
  assert.deepEqual(reopened.list().map((entry) => [entry.url, entry.note, entry.tags]), [
    ['https://www.example.com/docs', 'release notes only', ['docs', 'ai']]
  ])
  reopened.remove(site.id)
  await reopened.flush()
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')).sites, [])
  assert.deepEqual(changes, [1, 1])
})

test('saving an already-saved URL refreshes it instead of duplicating', async () => {
  const store = await SavedSitesStore.open(await savedSitesFile())
  const first = store.save({ url: 'https://example.com/a', title: 'Old' })
  const again = store.save({ url: 'http://www.example.com/a', title: 'New' })
  assert.equal(again.id, first.id)
  assert.equal(store.list().length, 1)
  assert.equal(store.list()[0]!.title, 'New')
  assert.equal(store.findByUrl('https://example.com/a')?.id, first.id)
})

test('only web pages can be saved', async () => {
  const store = await SavedSitesStore.open(await savedSitesFile())
  assert.throws(() => store.save({ url: 'file:///tmp/notes.txt' }), /http or https/)
  assert.throws(() => store.save({ url: 'about:blank' }), /http or https/)
  assert.equal(store.list().length, 0)
})

test('an unreadable file starts clean and malformed rows are dropped', async () => {
  const filePath = await savedSitesFile()
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, JSON.stringify({ version: 1, sites: [{ url: 'https://ok.example/' }, { url: 'about:blank' }, 42] }))
  const store = await SavedSitesStore.open(filePath)
  assert.deepEqual(store.list().map((site) => site.url), ['https://ok.example/'])
  await writeFile(filePath, '{not json')
  assert.equal((await SavedSitesStore.open(filePath)).list().length, 0)
})

test('saved sites rank ahead of history and are matched by note', async () => {
  const store = await SavedSitesStore.open(await savedSitesFile())
  store.save({ url: 'https://news.example/ai', title: 'AI news', note: 'daily brief source' })
  const saved = store.search('brief')
  assert.deepEqual(saved.map((row) => [row.completion, row.saved]), [['news.example/ai', true]])
  const merged = rankSavedFirst(saved, [
    { url: 'https://www.news.example/ai', title: 'AI news', completion: 'news.example/ai' },
    { url: 'https://other.example/', title: 'Other', completion: 'other.example' }
  ])
  assert.deepEqual(merged.map((row) => row.url), ['https://news.example/ai', 'https://other.example/'])
})
