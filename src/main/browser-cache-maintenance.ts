import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { session } from 'electron'
import { PARTITION } from './browser-url.js'

// One-time reclaim of the authenticated persist:browser partition when its caches
// have grown past the point where Chromium's disk-cache backend stays fast. Measured
// on this profile: 132k HTTP cache entries (1.4GB) plus 760MB of Service Worker
// CacheStorage — accumulated scraping bytes that slow every cold startup and page
// load and never reset on restart.
//
// The prune goes through the session's own clearCache/clearStorageData rather than
// deleting files under a live Chromium (which would risk a renderer SIGBUS on an
// mmap'd cache block and reclaim nothing until exit). Only regenerable cache stores
// are cleared — cookies, localStorage, and IndexedDB are untouched, so authenticated
// sessions survive. A sentinel makes it fire exactly once so the warm-cache benefit
// returns after the single reclaim; bump the sentinel name to force another prune.
const SENTINEL = '.browser-cache-pruned-v1'

export async function pruneOversizedBrowserCacheOnce(
  userDataDir: string
): Promise<{ pruned: boolean }> {
  const sentinel = join(userDataDir, SENTINEL)
  try {
    await fs.access(sentinel)
    return { pruned: false }
  } catch {
    // Sentinel absent — this is the one-time prune.
  }
  const partition = session.fromPartition(PARTITION)
  await partition.clearCache()
  await partition.clearStorageData({ storages: ['cachestorage', 'shadercache'] })
  await fs.writeFile(sentinel, new Date().toISOString())
  return { pruned: true }
}
