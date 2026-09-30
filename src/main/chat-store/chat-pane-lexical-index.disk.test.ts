import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chatRecord } from '../chat-peers/peer-manager-harness.js'
import { ChatPaneLexicalIndex } from './chat-pane-lexical-index.js'

const settings = { chatMemoryIndexEnabled: true, chatMemoryIndexMaxCharsPerChat: 10_000 }
const workerUrl = new URL('./pane-index-worker.ts', import.meta.url)
const meta = { rotationEpoch: 2, partial: false }
const items = (text: string) => [{ type: 'user' as const, id: 'u1', turnId: 't', text }]

test('disk index starts lazily, searches fresh FTS rows, and survives reopen', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-pane-index-'))
  const index = new ChatPaneLexicalIndex(dir, () => settings, workerUrl)
  t.after(async () => { await index.close(); await rm(dir, { recursive: true, force: true }) })
  await index.load()
  const record = chatRecord('pane-disk', null, { threadId: 't' })
  index.upsert(record, items('Remember layout tokens for sidebar'), meta)
  await index.flush()
  assert.ok(!(await readdir(dir)).includes('search.sqlite'), 'startup and upsert must not open SQLite')
  const search = await index.searchPane('pane-disk', { query: 'layout sidebar' })
  assert.match(search.hits[0]?.snippet ?? '', /layout/)
  assert.equal(search.rotationEpoch, 2)
  assert.equal(search.indexPartial, false)
  assert.ok((await readdir(dir)).includes('search.sqlite'))

  index.upsert(record, items('Replacement purple buttons'), meta)
  assert.equal((await index.searchPane('pane-disk', { query: 'layout sidebar' })).hits.length, 0)
  assert.match((await index.searchPane('pane-disk', { query: 'purple buttons' })).hits[0]?.snippet ?? '', /purple/)
  await index.close()
  const reopened = new ChatPaneLexicalIndex(dir, () => settings, workerUrl)
  try {
    const before = await stat(join(dir, 'search.sqlite'))
    await reopened.load()
    assert.equal((await stat(join(dir, 'search.sqlite'))).mtimeMs, before.mtimeMs, 'load does not rebuild FTS')
    assert.ok((await reopened.searchPane('pane-disk', { query: 'purple buttons' })).hits.length)
  } finally { await reopened.close() }
})

test('only dirty files are written; unchanged updates and repeated flushes do no writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-pane-dirty-'))
  const index = new ChatPaneLexicalIndex(dir, () => settings, workerUrl)
  t.after(async () => { await index.close(); await rm(dir, { recursive: true, force: true }) })
  await index.load()
  const a = chatRecord('a', null), b = chatRecord('b', null)
  index.upsert(a, items('alpha tokens'), meta)
  index.upsert(b, items('beta tokens'), meta)
  await index.flush()
  const identity = async (name: string) => {
    const s = await stat(join(dir, name))
    return [s.ino, s.mtimeMs]
  }
  const beforeA = await identity('a.json'), beforeB = await identity('b.json'), manifest = await identity('manifest.json')
  index.upsert(a, items('alpha tokens'), meta)
  await index.flush()
  assert.deepEqual(await identity('a.json'), beforeA)
  index.upsert(a, items('changed alpha tokens'), meta)
  await index.flush()
  assert.notDeepEqual(await identity('a.json'), beforeA)
  assert.deepEqual(await identity('b.json'), beforeB)
  assert.deepEqual(await identity('manifest.json'), manifest)
  const afterA = await identity('a.json')
  await index.flush()
  assert.deepEqual(await identity('a.json'), afterA)
})

test('drop during persistence or worker search cannot resurrect a chat', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-pane-drop-'))
  const index = new ChatPaneLexicalIndex(dir, () => settings, workerUrl)
  t.after(async () => { await index.close(); await rm(dir, { recursive: true, force: true }) })
  await index.load()
  index.upsert(chatRecord('a', null), items('purple buttons'), meta)
  const writing = index.flush()
  const searching = index.searchPane('a', { query: 'purple' })
  index.drop('a')
  await Promise.all([writing, index.flush()])
  assert.equal((await searching).hits.length, 0)
  assert.ok(!(await readdir(dir)).includes('a.json'))
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).chatIds, [])
})

test('worker failure uses current authoritative lines, including forgiving search', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-pane-fallback-'))
  const index = new ChatPaneLexicalIndex(dir, () => settings, new URL('./missing-worker.js', import.meta.url))
  t.after(async () => { await index.close(); await rm(dir, { recursive: true, force: true }) })
  await index.load()
  index.upsert(chatRecord('a', null), items('Remember Spine-V1 purple buttons'), meta)
  assert.ok((await index.searchPane('a', { query: 'purple buttons' })).hits.length)
  assert.equal((await index.searchPane('a', { query: 'spinev1' })).hits[0]?.match, 'spacing')
})


test('SQLite lock waits stay off the main event loop and searches return the new content', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-pane-responsive-'))
  const index = new ChatPaneLexicalIndex(dir, () => settings, workerUrl)
  t.after(async () => { await index.close(); await rm(dir, { recursive: true, force: true }) })
  await index.load()
  const record = chatRecord('a', null)
  index.upsert(record, items('initial purple buttons'), meta)
  await index.searchPane('a', { query: 'purple' })
  const lock = new DatabaseSync(join(dir, 'search.sqlite'))
  lock.exec('BEGIN IMMEDIATE')
  let ticks = 0
  const heartbeat = setInterval(() => { ticks++ }, 5)
  const release = setTimeout(() => lock.exec('COMMIT'), 100)
  try {
    index.upsert(record, items('changed orange buttons'), meta)
    const result = await index.searchPane('a', { query: 'orange' })
    assert.ok(result.hits.length)
    assert.ok(ticks >= 3, `main loop must keep ticking during SQLite contention (ticks=${ticks})`)
  } finally {
    clearInterval(heartbeat)
    clearTimeout(release)
    lock.close()
  }
})
