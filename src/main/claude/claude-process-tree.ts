import { readdir, readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

// A turn's "active" flag is not process ownership: Bash and subagent work can outlive the
// turn, create its own process group, or be reparented. Every SDK query therefore gets a
// unique runtime id in its environment, and retiring that runtime signals every process still
// carrying the marker rather than only the CLI's pid. Linux-only (/proc); elsewhere the SDK's
// own close() is the whole stop.

export const CLAUDE_RUNTIME_ID_ENV = 'CLOSEDAI_CLAUDE_RUNTIME_ID'

export type ClaudeRuntimeTermination = { matched: number; forceKilled: number }

function runtimeMarker(runtimeId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(runtimeId)) throw new Error('Invalid Claude runtime id')
  return `${CLAUDE_RUNTIME_ID_ENV}=${runtimeId}`
}

async function processHasMarker(pid: number, marker: string): Promise<boolean> {
  if (pid === process.pid) return false
  try {
    const environment = await readFile(`/proc/${pid}/environ`, 'utf8')
    return environment.split('\0').includes(marker)
  } catch {
    return false
  }
}

export async function claudeRuntimeProcessIds(runtimeId: string): Promise<number[]> {
  if (process.platform !== 'linux') return []
  const marker = runtimeMarker(runtimeId)
  const entries = await readdir('/proc', { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
  const matches = await Promise.all(candidates.map(async (pid) => (await processHasMarker(pid, marker) ? pid : null)))
  return matches.filter((pid): pid is number => pid !== null)
}

async function signalTagged(pid: number, marker: string, signal: NodeJS.Signals): Promise<void> {
  if (!(await processHasMarker(pid, marker))) return
  try {
    process.kill(pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** TERM every process carrying the runtime marker, then KILL whatever survived the grace period. */
export async function terminateClaudeRuntimeProcesses(
  runtimeId: string,
  graceMs = 750
): Promise<ClaudeRuntimeTermination> {
  if (process.platform !== 'linux') return { matched: 0, forceKilled: 0 }
  const marker = runtimeMarker(runtimeId)
  const matched = await claudeRuntimeProcessIds(runtimeId)
  await Promise.all(matched.map((pid) => signalTagged(pid, marker, 'SIGTERM')))
  if (matched.length > 0 && graceMs > 0) await delay(graceMs)
  const survivors = await claudeRuntimeProcessIds(runtimeId)
  await Promise.all(survivors.map((pid) => signalTagged(pid, marker, 'SIGKILL')))
  return { matched: matched.length, forceKilled: survivors.length }
}
