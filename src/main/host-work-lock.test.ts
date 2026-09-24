import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isWorkLockStale, workspaceWorkLockPath } from './host-work-lock.ts'

test('workspace work lock path lives under .closedai', () => {
  assert.match(workspaceWorkLockPath('/proj'), /\/proj\/\.closedai\/work\.lock$/)
})

test('a missing or stale lock is treated as free', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-lock-'))
  const lockPath = workspaceWorkLockPath(dir)
  assert.equal(isWorkLockStale(lockPath), true)
  await mkdir(join(dir, '.closedai'), { recursive: true })
  await writeFile(lockPath, `${process.pid}\n${Date.now() - 5 * 60 * 60 * 1000}\n`)
  assert.equal(isWorkLockStale(lockPath), true)
})
