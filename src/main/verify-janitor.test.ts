import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runVerifyJanitor, VERIFY_STALE_AGE_MS } from './verify-janitor.js'

test('removes stale verify scratch directories under /tmp', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-janitor-'))
  const stale = join(root, 'closedai-verify-stale')
  await import('node:fs/promises').then(({ mkdir, utimes }) =>
    mkdir(stale).then(() => utimes(stale, 0, (Date.now() - VERIFY_STALE_AGE_MS - 1_000) / 1_000)))
  const removed: string[] = []
  const result = await runVerifyJanitor(new Set(), {
    tmpRoot: root,
    now: () => Date.now(),
    removeDir: async (path) => { removed.push(path) }
  })
  assert.equal(result.removedDirs, 1)
  assert.equal(removed[0], stale)
})

test('leaves recent verify scratch directories in place', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-janitor-'))
  const fresh = join(root, 'closedai-verify-fresh')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(fresh))
  const result = await runVerifyJanitor(new Set(), { tmpRoot: root, now: () => Date.now() })
  assert.equal(result.removedDirs, 0)
})
