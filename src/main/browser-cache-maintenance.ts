import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { PARTITION } from './browser-url.js'
import { browserPartitionDir, measureRegenerableCacheBytes } from './browser-cache-size.js'

// Reclaim regenerable browser caches when they grow past the point Chromium's disk backend
// stays fast. Measured on a heavy profile: ~1.3GB HTTP cache plus ~260MB Service Worker
// CacheStorage slowed cold startup and page loads without resetting on restart.
//
// Pruning uses the session's clearCache/clearStorageData rather than deleting files under a
// live Chromium (which risks SIGBUS on mmap'd cache blocks). Cookies, localStorage, and
// IndexedDB are untouched.
export const CACHE_PRUNE_THRESHOLD_BYTES = 768 * 1024 * 1024
export const CACHE_PRUNE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
export const CACHE_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000

const STATE_FILE = 'browser-cache-state.json'
const LEGACY_SENTINEL = '.browser-cache-pruned-v1'

type BrowserCacheState = {
  version: 1
  lastPrunedAt: string | null
  lastMeasuredBytes: number
  lastMeasuredAt: string
}

type MaintainResult = {
  pruned: boolean
  bytes: number
  skipped?: 'under-threshold' | 'cooldown'
}

type MaintainDeps = {
  measure?: (partitionDir: string) => Promise<number>
  clear?: () => Promise<void>
}

export async function maintainBrowserCache(
  userDataDir: string,
  now = Date.now(),
  deps: MaintainDeps = {}
): Promise<MaintainResult> {
  const measure = deps.measure ?? measureRegenerableCacheBytes
  const clear = deps.clear ?? clearRegenerableBrowserCache
  const partitionDir = browserPartitionDir(userDataDir, PARTITION)
  const bytes = await measure(partitionDir)
  const state = await readState(userDataDir)
  const lastPrunedAt = state.lastPrunedAt ? Date.parse(state.lastPrunedAt) : null
  const cooledDown = lastPrunedAt === null || Number.isNaN(lastPrunedAt) || now - lastPrunedAt >= CACHE_PRUNE_COOLDOWN_MS

  if (bytes < CACHE_PRUNE_THRESHOLD_BYTES || !cooledDown) {
    await writeState(userDataDir, {
      version: 1,
      lastPrunedAt: state.lastPrunedAt,
      lastMeasuredBytes: bytes,
      lastMeasuredAt: new Date(now).toISOString()
    })
    return {
      pruned: false,
      bytes,
      skipped: bytes < CACHE_PRUNE_THRESHOLD_BYTES ? 'under-threshold' : 'cooldown'
    }
  }

  await clear()
  await writeState(userDataDir, {
    version: 1,
    lastPrunedAt: new Date(now).toISOString(),
    lastMeasuredBytes: 0,
    lastMeasuredAt: new Date(now).toISOString()
  })
  console.info(`[browser-cache] pruned ${formatMegabytes(bytes)} of regenerable cache`)
  return { pruned: true, bytes }
}

/** Re-check cache size periodically while the app runs; idle tabs keep accumulating bytes. */
export function scheduleBrowserCacheMaintenance(
  userDataDir: string,
  intervalMs: number = CACHE_MAINTENANCE_INTERVAL_MS
): () => void {
  const timer = setInterval(() => {
    void maintainBrowserCache(userDataDir).catch((error: unknown) => {
      console.warn('[browser-cache] periodic maintenance failed', error)
    })
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

async function clearRegenerableBrowserCache(): Promise<void> {
  const { session } = await import('electron')
  const partition = session.fromPartition(PARTITION)
  await partition.clearCache()
  await partition.clearStorageData({ storages: ['cachestorage', 'shadercache'] })
}

async function readState(userDataDir: string): Promise<BrowserCacheState> {
  const path = join(userDataDir, STATE_FILE)
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<BrowserCacheState>
    if (parsed.version === 1 && typeof parsed.lastMeasuredBytes === 'number') {
      return {
        version: 1,
        lastPrunedAt: typeof parsed.lastPrunedAt === 'string' ? parsed.lastPrunedAt : null,
        lastMeasuredBytes: parsed.lastMeasuredBytes,
        lastMeasuredAt: typeof parsed.lastMeasuredAt === 'string' ? parsed.lastMeasuredAt : new Date(0).toISOString()
      }
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'ENOENT') console.warn('[browser-cache] unable to read cache state; starting clean', error)
  }
  return migrateLegacySentinel(userDataDir)
}

async function migrateLegacySentinel(userDataDir: string): Promise<BrowserCacheState> {
  const sentinel = join(userDataDir, LEGACY_SENTINEL)
  try {
    const stamped = (await fs.readFile(sentinel, 'utf8')).trim()
    const lastPrunedAt = stamped || new Date(0).toISOString()
    return {
      version: 1,
      lastPrunedAt,
      lastMeasuredBytes: 0,
      lastMeasuredAt: lastPrunedAt
    }
  } catch {
    return {
      version: 1,
      lastPrunedAt: null,
      lastMeasuredBytes: 0,
      lastMeasuredAt: new Date(0).toISOString()
    }
  }
}

async function writeState(userDataDir: string, state: BrowserCacheState): Promise<void> {
  await fs.writeFile(join(userDataDir, STATE_FILE), `${JSON.stringify(state)}\n`)
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** @deprecated Use maintainBrowserCache. Kept for callers/tests that still import the old name. */
export async function pruneOversizedBrowserCacheOnce(userDataDir: string): Promise<{ pruned: boolean }> {
  const result = await maintainBrowserCache(userDataDir)
  return { pruned: result.pruned }
}
