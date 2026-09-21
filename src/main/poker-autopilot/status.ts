import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type AutopilotStatus = {
  running: boolean
  tabId: string | null
  startedAt: string
  updatedAt: string
  lastHandId: string | null
  lastDecision: string | null
  lastError: string | null
  heroStack: string | null
  polls: number
  clicks: number
}

export function stopFile(userData: string): string {
  return join(userData, 'poker-autopilot.stop')
}

export function statusFile(userData: string): string {
  return join(userData, 'poker-autopilot-status.json')
}

export async function writeStatus(userData: string, patch: Partial<AutopilotStatus>): Promise<AutopilotStatus> {
  await mkdir(userData, { recursive: true })
  const path = statusFile(userData)
  let current: AutopilotStatus = {
    running: false,
    tabId: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastHandId: null,
    lastDecision: null,
    lastError: null,
    heroStack: null,
    polls: 0,
    clicks: 0
  }
  try {
    current = { ...current, ...JSON.parse(await readFile(path, 'utf8')) as AutopilotStatus }
  } catch { /* first write */ }
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
  await writeFile(path, JSON.stringify(next, null, 2))
  return next
}

export async function shouldStop(userData: string): Promise<boolean> {
  try {
    await readFile(stopFile(userData))
    return true
  } catch {
    return false
  }
}

export async function clearStop(userData: string): Promise<void> {
  try {
    await writeFile(stopFile(userData), '')
  } catch { /* ignore */ }
}
