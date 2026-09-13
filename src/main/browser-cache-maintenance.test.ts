import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  CACHE_PRUNE_COOLDOWN_MS,
  CACHE_PRUNE_THRESHOLD_BYTES,
  maintainBrowserCache
} from './browser-cache-maintenance.js'
import { browserPartitionDir, measureRegenerableCacheBytes } from './browser-cache-size.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempUserData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'browser-cache-maint-'))
  dirs.push(dir)
  return dir
}

async function seedCache(partitionDir: string, bytes: number): Promise<void> {
  const file = join(partitionDir, 'Cache', 'blob')
  await mkdir(join(partitionDir, 'Cache'), { recursive: true })
  await writeFile(file, Buffer.alloc(bytes, 1))
}

test('maintainBrowserCache skips pruning when regenerable cache is under threshold', async () => {
  const userDataDir = await tempUserData()
  const partitionDir = browserPartitionDir(userDataDir)
  await seedCache(partitionDir, 1024)
  const result = await maintainBrowserCache(userDataDir)
  assert.equal(result.pruned, false)
  assert.equal(result.skipped, 'under-threshold')
})

test('maintainBrowserCache prunes when cache exceeds threshold and cooldown elapsed', async () => {
  const userDataDir = await tempUserData()
  const partitionDir = browserPartitionDir(userDataDir)
  await seedCache(partitionDir, CACHE_PRUNE_THRESHOLD_BYTES + 1024)
  const cleared: string[] = []
  const result = await maintainBrowserCache(userDataDir, Date.now(), {
    measure: measureRegenerableCacheBytes,
    clear: async () => { cleared.push('cleared') }
  })
  assert.equal(result.pruned, true)
  assert.deepEqual(cleared, ['cleared'])
})

test('maintainBrowserCache respects cooldown after a recent prune', async () => {
  const userDataDir = await tempUserData()
  const partitionDir = browserPartitionDir(userDataDir)
  await seedCache(partitionDir, CACHE_PRUNE_THRESHOLD_BYTES + 1024)
  await writeFile(join(userDataDir, 'browser-cache-state.json'), `${JSON.stringify({
    version: 1,
    lastPrunedAt: new Date().toISOString(),
    lastMeasuredBytes: CACHE_PRUNE_THRESHOLD_BYTES + 1024,
    lastMeasuredAt: new Date().toISOString()
  })}\n`)
  const result = await maintainBrowserCache(userDataDir, Date.now(), {
    measure: measureRegenerableCacheBytes,
    clear: async () => { throw new Error('should not clear during cooldown') }
  })
  assert.equal(result.pruned, false)
  assert.equal(result.skipped, 'cooldown')
})

test('maintainBrowserCache prunes again once cooldown has elapsed', async () => {
  const userDataDir = await tempUserData()
  const partitionDir = browserPartitionDir(userDataDir)
  await seedCache(partitionDir, CACHE_PRUNE_THRESHOLD_BYTES + 1024)
  await writeFile(join(userDataDir, 'browser-cache-state.json'), `${JSON.stringify({
    version: 1,
    lastPrunedAt: new Date(Date.now() - CACHE_PRUNE_COOLDOWN_MS - 1_000).toISOString(),
    lastMeasuredBytes: CACHE_PRUNE_THRESHOLD_BYTES + 1024,
    lastMeasuredAt: new Date().toISOString()
  })}\n`)
  let cleared = false
  const result = await maintainBrowserCache(userDataDir, Date.now(), {
    measure: measureRegenerableCacheBytes,
    clear: async () => { cleared = true }
  })
  assert.equal(result.pruned, true)
  assert.equal(cleared, true)
})
