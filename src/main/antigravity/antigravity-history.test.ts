import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { AntigravityHistory, firstLine } from './antigravity-history.js'

// Column shapes copied from ~/.gemini/antigravity-cli/conversation_summaries.db (agy 1.1.24).
function summariesDb(dir: string, rows: Array<[id: string, title: string]>): string {
  const path = join(dir, 'conversation_summaries.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text NOT NULL DEFAULT "")')
  const insert = db.prepare('INSERT INTO conversation_summaries (conversation_id, title) VALUES (?, ?)')
  for (const [id, title] of rows) insert.run(id, title)
  db.close()
  return path
}

test('recorded conversations list for their workspace newest first, titled by the CLI when it has one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-history-'))
  try {
    const history = new AntigravityHistory(join(dir, 'state'), summariesDb(dir, [['a', 'Search plan']]))
    await history.recordThread('a', '/home/dp/My Project', [{ type: 'user', id: 'u', turnId: null, text: '<closedai_context name="x" kind="application">\nstate\n</closedai_context>\nfirst prompt\nmore' }])
    await new Promise((resolve) => setTimeout(resolve, 5))
    await history.recordThread('b', '/home/dp/My Project/', [{ type: 'user', id: 'u', turnId: null, text: 'Hello there' }])
    await history.recordThread('c', '/tmp/other', [{ type: 'user', id: 'u', turnId: null, text: 'Elsewhere' }])
    await history.recordThread('e', '/home/dp/My Project', [{ type: 'user', id: 'u', turnId: null, text: 'Archived' }])
    await history.archive('e')
    const threads = await history.listThreads('/home/dp/My Project')
    assert.deepEqual(threads.map((thread) => thread.id), ['agy:b', 'agy:a'])
    assert.equal(threads[0]!.title, 'Hello there')
    assert.equal(threads[1]!.title, 'Search plan')
    assert.ok(threads[1]!.preview.startsWith('first prompt'))
    assert.ok(threads[1]!.createdAt <= threads[1]!.updatedAt)
    assert.equal(await history.threadName('a'), 'Search plan')
    assert.equal(await history.threadName('b'), null)
    // A second turn keeps the title and creation time but moves the conversation up.
    const createdAt = threads[1]!.createdAt
    await new Promise((resolve) => setTimeout(resolve, 5))
    await history.recordThread('a', '/home/dp/My Project', [{ type: 'user', id: 'u', turnId: null, text: 'different' }])
    const again = await history.listThreads('/home/dp/My Project')
    assert.equal(again[0]!.id, 'agy:a')
    assert.equal(again[0]!.createdAt, createdAt)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('transcripts round-trip through the state dir and a missing one reads as null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-history-'))
  try {
    const history = new AntigravityHistory(dir, join(dir, 'missing.db'))
    assert.equal(await history.loadTranscript('c1'), null)
    await history.saveTranscript('c1', [{ type: 'user', id: 'u1', turnId: null, text: 'hi' }])
    assert.deepEqual(await history.loadTranscript('c1'), [{ type: 'user', id: 'u1', turnId: null, text: 'hi' }])
    assert.deepEqual(await history.listThreads('/w'), [])
    assert.equal(await history.threadName('c1'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('titles come from the first line of the user\'s own words', () => {
  assert.equal(firstLine('<closedai_context name="a" kind="untrusted">\nx\n</closedai_context>\nWrite a plan\nmore'), 'Write a plan')
  assert.equal(firstLine(`${'a'.repeat(90)}`).length, 80)
})
