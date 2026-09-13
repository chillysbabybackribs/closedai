import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  browserPartitionDir,
  measureRegenerableCacheBytes
} from './browser-cache-size.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempPartition(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'browser-cache-size-'))
  dirs.push(root)
  const partition = browserPartitionDir(root)
  await mkdir(join(partition, 'Cache', 'data'), { recursive: true })
  await writeFile(join(partition, 'Cache', 'data', 'entry'), 'hello')
  await mkdir(join(partition, 'Local Storage'), { recursive: true })
  await writeFile(join(partition, 'Local Storage', 'leveldb'), 'keep-me')
  return partition
}

test('browserPartitionDir maps persist partitions to Partitions/<name>', () => {
  assert.equal(browserPartitionDir('/data'), '/data/Partitions/browser')
})

test('measureRegenerableCacheBytes counts only regenerable cache directories', async () => {
  const partition = await tempPartition()
  assert.equal(await measureRegenerableCacheBytes(partition), 5)
})
