import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readFileSnapshot } from './file-snapshot.js'
import { SourceReadHistory } from './source-read-history.js'

const oldHash = 'sha256:' + 'a'.repeat(64)
const newHash = 'sha256:' + 'b'.repeat(64)
const scope = { paneId: 'pane', threadId: 'thread', cwd: '/workspace' }

test('only changed versions are reported, without consuming the read baseline', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'closedai-freshness-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const scoped = { ...scope, cwd }
  const path = join(cwd, 'source.ts')
  await writeFile(path, 'original\n')
  const history = new SourceReadHistory()
  history.remember(scoped, await readFileSnapshot(path))
  assert.equal(await history.changes(scoped), null)
  await writeFile(path, 'changed\n')
  const report = (await history.changes(scoped))!
  assert.equal(report.checkedFiles, 1)
  assert.deepEqual(report.changes.map(({ path, status }) => ({ path, status })), [{ path: 'source.ts', status: 'changed' }])
  assert.deepEqual((await history.changes(scoped))!.changes, report.changes)
  history.remember(scoped, await readFileSnapshot(path))
  assert.equal(await history.changes(scoped), null)
  await rm(path)
  assert.equal((await history.changes(scoped))!.changes[0]!.status, 'missing')
})

test('pane, thread and workspace boundaries are independent and unscoped reads are ignored', async () => {
  let reads = 0
  const history = new SourceReadHistory(async (path) => { reads++; return { path, hash: newHash } })
  history.remember(scope, { path: '/workspace/source.ts', hash: oldHash })
  for (const other of [
    { ...scope, paneId: 'other' }, { ...scope, threadId: 'other' }, { ...scope, cwd: '/other' },
    { ...scope, threadId: null }, { ...scope, paneId: null }
  ]) assert.equal(await history.changes(other), null)
  assert.equal(reads, 0)
  assert.equal((await history.changes(scope))!.changes.length, 1)
  history.remember({ ...scope, threadId: null }, { path: '/workspace/ignored.ts', hash: oldHash })
  history.remember(scope, { path: '/elsewhere/ignored.ts', hash: oldHash })
  assert.equal((await history.changes(scope))!.checkedFiles, 1)
})

test('reports and retained observations stay bounded, with newest paths first', async () => {
  const history = new SourceReadHistory(async (path) => ({ path, hash: newHash }))
  for (let index = 0; index < 50; index++) history.remember(scope, { path: `/workspace/file-${index}.ts`, hash: oldHash })
  const report = (await history.changes(scope))!
  assert.equal(report.checkedFiles, 32)
  assert.equal(report.changes.length, 8)
  assert.equal(report.omittedChanges, 24)
  assert.equal(report.changes[0]!.path, 'file-49.ts')
  assert.ok(JSON.stringify(report).length <= 4000)
  for (let index = 0; index < 65; index++) history.remember({ ...scope, threadId: `thread-${index}` }, { path: '/workspace/x.ts', hash: oldHash })
  assert.equal(await history.changes(scope), null)
})

test('a slow read is aborted and omitted rather than blocking send enrichment', async () => {
  let aborted = false
  const history = new SourceReadHistory((_path, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
  }), 5)
  history.remember(scope, { path: '/workspace/x.ts', hash: oldHash })
  assert.equal(await history.changes(scope), null)
  assert.equal(aborted, true)
})

test('new observations during a check invalidate results based on older reads', async () => {
  let finish!: (value: { path: string; hash: string }) => void
  const history = new SourceReadHistory(() => new Promise((resolve) => { finish = resolve }))
  history.remember(scope, { path: '/workspace/x.ts', hash: oldHash })
  const pending = history.changes(scope)
  history.remember(scope, { path: '/workspace/x.ts', hash: newHash })
  finish({ path: '/workspace/x.ts', hash: newHash })
  assert.equal(await pending, null)
})

test('unreadable paths are distinguished from deletion without retaining error text', async () => {
  const history = new SourceReadHistory(async () => { throw Object.assign(new Error('private error detail'), { code: 'EACCES' }) })
  history.remember(scope, { path: '/workspace/x.ts', hash: oldHash })
  const report = (await history.changes(scope))!
  assert.equal(report.changes[0]!.status, 'unavailable')
  assert.ok(!JSON.stringify(report).includes('private error detail'))
})
