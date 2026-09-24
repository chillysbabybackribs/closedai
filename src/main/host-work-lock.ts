import fs from 'node:fs'
import path from 'node:path'

/** Same path as `scripts/work-lock.mjs` — one build/verify at a time per workspace. */
export const WORK_LOCK_RELATIVE = path.join('.closedai', 'work.lock')

const STALE_MS = 4 * 60 * 60 * 1000

export function workspaceWorkLockPath(cwd: string): string {
  return path.join(cwd, WORK_LOCK_RELATIVE)
}

export function readWorkLock(lockPath: string): { pid: number; at: number } | null {
  try {
    const [pidLine, atLine] = fs.readFileSync(lockPath, 'utf8').split('\n')
    const pid = Number(pidLine)
    const at = Number(atLine)
    if (!Number.isFinite(pid) || !Number.isFinite(at)) return null
    return { pid, at }
  } catch {
    return null
  }
}

export function isWorkLockStale(lockPath: string, now = Date.now()): boolean {
  const parsed = readWorkLock(lockPath)
  if (!parsed) return true
  if (now - parsed.at > STALE_MS) return true
  try {
    process.kill(parsed.pid, 0)
    return false
  } catch {
    return true
  }
}
