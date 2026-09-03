import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CLOSEDAI_ORIGINATOR, ownThreadRows, readThreadOriginator } from './codex-thread-origin.ts'

test('another app’s threads are dropped and this app’s are kept', async () => {
  const originators = new Map([
    ['/rollouts/a.jsonl', CLOSEDAI_ORIGINATOR],
    ['/rollouts/b.jsonl', 'Codex Desktop'],
    ['/rollouts/c.jsonl', 'codex-tui']
  ])
  const rows = [
    { id: 'a', path: '/rollouts/a.jsonl' },
    { id: 'b', path: '/rollouts/b.jsonl' },
    { id: 'c', path: '/rollouts/c.jsonl' }
  ]

  const kept = await ownThreadRows(rows, async (path) => originators.get(path) ?? null)

  assert.deepEqual(kept.map((row) => (row as { id: string }).id), ['a'])
})

test('a row with no readable header is kept rather than hidden', async () => {
  const rows = [{ id: 'no-path' }, { id: 'unreadable', path: '/rollouts/missing.jsonl' }]

  const kept = await ownThreadRows(rows, async () => null)

  assert.deepEqual(kept.map((row) => (row as { id: string }).id), ['no-path', 'unreadable'])
})

test('the originator is read from a meta line far longer than one read, not the whole file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rollout-'))
  const path = join(directory, 'rollout.jsonl')
  // Real rollouts embed the thread's instructions, putting the meta record around 18 KB.
  const meta = {
    type: 'session_meta',
    payload: { id: 'thread', originator: CLOSEDAI_ORIGINATOR, cwd: '/workspace', instructions: 'x'.repeat(40_000) }
  }
  await writeFile(path, `${JSON.stringify(meta)}\n${'y'.repeat(50_000)}\n`)

  assert.equal(await readThreadOriginator(path), CLOSEDAI_ORIGINATOR)
  assert.equal(await readThreadOriginator(join(directory, 'absent.jsonl')), null)
})
