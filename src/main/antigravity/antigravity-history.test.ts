import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { AntigravityHistory, parseCliTime, previewText } from './antigravity-history.js'

// Schema and value shapes copied from ~/.gemini/antigravity-cli/conversation_summaries.db (agy 1.1.24).
async function summariesDb(dir: string, rows: Array<Record<string, unknown>>): Promise<string> {
  const path = join(dir, 'conversation_summaries.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text NOT NULL DEFAULT "", preview text NOT NULL DEFAULT "", step_count integer NOT NULL DEFAULT 0, last_modified_time datetime NOT NULL, workspace_uris text NOT NULL, nesting_depth integer NOT NULL DEFAULT 0, last_user_input_time datetime NOT NULL)')
  const insert = db.prepare('INSERT INTO conversation_summaries (conversation_id, title, preview, last_modified_time, workspace_uris, nesting_depth, last_user_input_time) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const row of rows) {
    insert.run(String(row.id), String(row.title ?? ''), String(row.preview ?? ''), String(row.modified), String(row.workspaces ?? '[]'), Number(row.depth ?? 0), String(row.input ?? '0001-01-01 00:00:00+00:00'))
  }
  db.close()
  return path
}

test('threads list the workspace\'s top-level conversations newest first, minus archived ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-history-'))
  try {
    const db = await summariesDb(dir, [
      { id: 'a', title: 'Search plan', preview: 'first prompt', modified: '2026-08-30 17:54:50.501242631+00:00', workspaces: '["file:///home/dp/My%20Project"]', input: '2026-08-30 17:50:00+00:00' },
      { id: 'b', title: '', preview: '<closedai_context name="x" kind="application">\nstate\n</closedai_context>\nHello there\nsecond line', modified: '2026-08-31 10:00:00+00:00', workspaces: '["file:///home/dp/My%20Project/"]' },
      { id: 'c', title: 'Elsewhere', preview: '', modified: '2026-08-31 11:00:00+00:00', workspaces: '["file:///tmp/other"]' },
      { id: 'd', title: 'Subagent', preview: '', modified: '2026-08-31 12:00:00+00:00', workspaces: '["file:///home/dp/My%20Project"]', depth: 1 },
      { id: 'e', title: 'Archived', preview: '', modified: '2026-08-31 13:00:00+00:00', workspaces: '["file:///home/dp/My%20Project"]' }
    ])
    const history = new AntigravityHistory(join(dir, 'state'), db)
    await history.archive('e')
    const threads = await history.listThreads('/home/dp/My Project')
    assert.deepEqual(threads.map((thread) => thread.id), ['agy:b', 'agy:a'])
    assert.equal(threads[0]!.title, 'Hello there')
    assert.equal(threads[0]!.preview, 'Hello there\nsecond line')
    assert.equal(threads[1]!.title, 'Search plan')
    assert.equal(threads[1]!.createdAt, Date.parse('2026-08-30T17:50:00+00:00'))
    assert.equal(threads[1]!.updatedAt, Date.parse('2026-08-30T17:54:50.501+00:00'))
    assert.equal(await history.threadName('a'), 'Search plan')
    assert.equal(await history.threadName('b'), null)
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
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI timestamps parse with nanoseconds trimmed and the zero time as unset', () => {
  assert.equal(parseCliTime('2026-08-30 17:54:50.501242631+00:00'), Date.parse('2026-08-30T17:54:50.501+00:00'))
  assert.equal(parseCliTime('0001-01-01 00:00:00+00:00'), null)
  assert.equal(previewText('<project_instructions src="AGENTS.md">\nrules\n</project_instructions>\nWrite a plan'), 'Write a plan')
})
