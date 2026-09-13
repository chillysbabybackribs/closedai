import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/** Regenerable Chromium stores cleared by session cache APIs, not auth/session data. */
export const REGENERABLE_CACHE_DIRS = [
  'Cache',
  'Service Worker',
  'GPUCache',
  'DawnWebGPUCache',
  'DawnGraphiteCache'
] as const

/** Map `persist:browser` to the on-disk partition directory under userData. */
export function browserPartitionDir(userDataDir: string, partition = 'persist:browser'): string {
  return join(userDataDir, 'Partitions', partition.replace(/^persist:/, ''))
}

export async function measureRegenerableCacheBytes(partitionDir: string): Promise<number> {
  let total = 0
  for (const name of REGENERABLE_CACHE_DIRS) {
    total += await directoryBytes(join(partitionDir, name))
  }
  return total
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        try {
          total += (await fs.stat(path)).size
        } catch {
          // A file can disappear while we walk; skip it.
        }
      }
    }
  }
  await walk(root)
  return total
}
