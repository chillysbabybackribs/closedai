import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Headless verify harnesses (Electron in /tmp) are not tagged with Claude runtime ids.
 * Optional lease: set CLOSEDAI_VERIFY_LEASE=<paneId>:<startedAtMs> in child environments
 * so the janitor skips active work. Stale dirs and orphaned verify scripts are reclaimed here.
 */
export const VERIFY_LEASE_ENV = 'CLOSEDAI_VERIFY_LEASE'
export const VERIFY_JANITOR_INTERVAL_MS = 30 * 60 * 1000
export const VERIFY_STALE_AGE_MS = 4 * 60 * 60 * 1000

const TMP_PREFIXES = ['closedai-verify', 'closedai-before'] as const
const TMP_DIR_NAMES = ['drag-profile'] as const
const VERIFY_SCRIPT = 'verify-browser-drag'

export type VerifyJanitorResult = {
  removedDirs: number
  signaledProcesses: number
  skippedLeased: number
}

type VerifyJanitorDeps = {
  now?: () => number
  staleAgeMs?: number
  listProc?: () => Promise<number[]>
  signal?: (pid: number, signal: NodeJS.Signals) => void
  removeDir?: (path: string) => Promise<void>
  tmpRoot?: string
}

export async function runVerifyJanitor(
  activePaneIds: ReadonlySet<string>,
  deps: VerifyJanitorDeps = {}
): Promise<VerifyJanitorResult> {
  const now = deps.now?.() ?? Date.now()
  const staleAgeMs = deps.staleAgeMs ?? VERIFY_STALE_AGE_MS
  const tmpRoot = deps.tmpRoot ?? '/tmp'
  const removeDir = deps.removeDir ?? ((path: string) => rm(path, { recursive: true, force: true }))
  const signal = deps.signal ?? ((pid, sig) => {
    try { process.kill(pid, sig) } catch { /* ESRCH */ }
  })
  const result: VerifyJanitorResult = { removedDirs: 0, signaledProcesses: 0, skippedLeased: 0 }

  await cleanupTmpDirs(tmpRoot, now, staleAgeMs, activePaneIds, removeDir, result)
  await cleanupVerifyProcesses(now, staleAgeMs, activePaneIds, deps.listProc ?? listNumericProcIds, signal, result)
  return result
}

export function scheduleVerifyJanitor(
  activePaneIds: () => ReadonlySet<string>,
  intervalMs: number = VERIFY_JANITOR_INTERVAL_MS
): () => void {
  const tick = (): void => {
    void runVerifyJanitor(activePaneIds()).then((result) => {
      const touched = result.removedDirs + result.signaledProcesses
      if (touched > 0) {
        console.info('[verify-janitor]', result)
      }
    }).catch((error: unknown) => {
      console.warn('[verify-janitor] cleanup failed:', error instanceof Error ? error.message : String(error))
    })
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

async function cleanupTmpDirs(
  tmpRoot: string,
  now: number,
  staleAgeMs: number,
  activePaneIds: ReadonlySet<string>,
  removeDir: (path: string) => Promise<void>,
  result: VerifyJanitorResult
): Promise<void> {
  const entries = await readdir(tmpRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    const path = join(tmpRoot, name)
    const stalePrefix = TMP_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}-`))
    const staleNamed = TMP_DIR_NAMES.includes(name as typeof TMP_DIR_NAMES[number])
    if (!stalePrefix && !staleNamed) continue
    const info = await stat(path).catch(() => null)
    if (!info || now - info.mtimeMs < staleAgeMs) continue
    if (await anyActiveVerifyLease(activePaneIds)) {
      result.skippedLeased += 1
      continue
    }
    await removeDir(path)
    result.removedDirs += 1
  }
}

async function anyActiveVerifyLease(activePaneIds: ReadonlySet<string>): Promise<boolean> {
  if (process.platform !== 'linux') return false
  const pids = await listNumericProcIds()
  for (const pid of pids) {
    const env = await readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '')
    const lease = env.split('\0').find((line) => line.startsWith(`${VERIFY_LEASE_ENV}=`))
    if (!lease) continue
    const paneId = lease.slice(`${VERIFY_LEASE_ENV}=`.length).split(':')[0]
    if (paneId && activePaneIds.has(paneId)) return true
  }
  return false
}

async function cleanupVerifyProcesses(
  now: number,
  staleAgeMs: number,
  activePaneIds: ReadonlySet<string>,
  listProc: () => Promise<number[]>,
  signal: (pid: number, sig: NodeJS.Signals) => void,
  result: VerifyJanitorResult
): Promise<void> {
  if (process.platform !== 'linux') return
  for (const pid of await listProc()) {
    if (pid === process.pid) continue
    const cmd = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
    if (!cmd.includes(VERIFY_SCRIPT)) continue
    const statInfo = await stat(`/proc/${pid}`).catch(() => null)
    if (!statInfo) continue
    const started = statInfo.birthtimeMs > 0 ? statInfo.birthtimeMs : statInfo.mtimeMs
    if (now - started < staleAgeMs) continue
    const env = await readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '')
    const leaseLine = env.split('\0').find((line) => line.startsWith(`${VERIFY_LEASE_ENV}=`))
    if (leaseLine) {
      const paneId = leaseLine.slice(`${VERIFY_LEASE_ENV}=`.length).split(':')[0]
      if (paneId && activePaneIds.has(paneId)) {
        result.skippedLeased += 1
        continue
      }
    }
    signal(pid, 'SIGTERM')
    result.signaledProcesses += 1
  }
}

async function listNumericProcIds(): Promise<number[]> {
  const entries = await readdir('/proc', { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
}
