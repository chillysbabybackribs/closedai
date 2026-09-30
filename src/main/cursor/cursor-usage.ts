import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ChatPlanUsage, ChatPlanUsageWindow, ProviderUsageSnapshot } from '../../shared/chat.js'
import { recordOf } from '../chat-normalizers.js'
import { readCursorAbout } from './cursor-cli.js'

const execFileAsync = promisify(execFile)
const API = 'https://api2.cursor.sh/aiserver.v1.DashboardService/'

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function resetTime(value: unknown): number | null {
  const time = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : number(value)
  return time && Number.isSafeInteger(time) && time <= 8.64e15 ? time : null
}

/** Mirrors the CLI's /usage fields; explicit percentages take precedence over spend ratios. */
export function cursorPlanUsage(current: unknown, planResponse: unknown, hardLimitResponse: unknown, now = Date.now()): ChatPlanUsage {
  const root = recordOf(current)
  const included = recordOf(root?.planUsage)
  const info = recordOf(recordOf(planResponse)?.planInfo)
  const plan = typeof info?.planName === 'string' && info.planName.trim() ? info.planName : null
  const resetsAt = resetTime(root?.billingCycleEnd) ?? resetTime(info?.billingCycleEnd)
  const windows: ChatPlanUsageWindow[] = []
  const add = (label: string, percent: number | null): void => {
    if (percent !== null) windows.push({ label, percent: Math.round(Math.max(0, Math.min(100, percent))), resetsAt })
  }
  if (included) {
    const limit = number(included.limit)
    const spent = number(included.includedSpend)
    add('Monthly included', number(included.totalPercentUsed) ?? (limit && spent !== null ? spent / limit * 100 : null))
    // Missing scoped fields mean unknown, not zero usage.
    add('Monthly Auto', number(included.autoPercentUsed))
    add('Monthly API', number(included.apiPercentUsed))
  }
  const spend = recordOf(root?.spendLimitUsage)
  const hard = recordOf(hardLimitResponse)
  const used = number(spend?.individualUsed) ?? 0
  const personalLimit = number(spend?.individualLimit)
  const dollars = (value: number): string => `$${value.toFixed(2)}`
  const notes: string[] = []
  // Spend-limit amounts are cents; GetHardLimit.hardLimit is dollars. Paid overage is a
  // note, never another quota window that could incorrectly make the footer exhausted.
  if (hard?.noUsageBasedAllowed === true || personalLimit === 0) notes.push(`On-demand usage off${used ? ` · ${dollars(used / 100)} spent` : ''}`)
  else if (personalLimit !== null) notes.push(`On-demand: ${dollars(used / 100)} of ${dollars(personalLimit / 100)}`)
  else if (spend?.limitType === 'team') notes.push(`On-demand: ${dollars(used / 100)} spent · personal limit not reported`)
  else if (number(hard?.hardLimit) !== null) {
    const limit = hard!.hardLimit as number
    notes.push(limit === 0 ? 'On-demand usage off' : limit >= 2_147_483_647
      ? `On-demand: ${dollars(used / 100)} · no monthly limit`
      : `On-demand: ${dollars(used / 100)} of ${dollars(limit)}`)
  }
  return { plan, windows, note: notes.join(' · ') || null,
    unavailable: windows.length ? null : 'Cursor did not report percentage usage for this plan.', updatedAt: now }
}

/** Read only the CLI's credential store; tokens never cross IPC or enter errors/logs. */
async function accessToken(): Promise<string> {
  if (process.env.CURSOR_AUTH_TOKEN?.trim()) return process.env.CURSOR_AUTH_TOKEN.trim()
  if (process.env.AGENT_CLI_CREDENTIAL_STORE === 'memory') throw new Error('Cursor usage requires a persisted CLI sign-in.')
  if (process.platform === 'darwin' && process.env.AGENT_CLI_CREDENTIAL_STORE !== 'file') {
    try {
      const { stdout } = await execFileAsync('/usr/bin/security', ['find-generic-password', '-a', 'cursor-user', '-s', 'cursor-access-token', '-w'], { timeout: 5_000, maxBuffer: 64_000 })
      if (stdout.trim()) return stdout.trim()
    } catch { /* Report only the fixed sign-in guidance below. */ }
  } else {
    const directory = process.platform === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cursor')
      : process.platform === 'darwin' ? join(homedir(), '.cursor')
        : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'cursor')
    try {
      const auth = recordOf(JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8')))
      if (typeof auth?.accessToken === 'string' && auth.accessToken.trim()) return auth.accessToken.trim()
    } catch { /* Missing, malformed, or unreadable credentials are all unavailable. */ }
  }
  throw new Error('Sign in with cursor-agent login to read Cursor usage.')
}

async function activeTeam(): Promise<number | null> {
  const directory = process.env.CURSOR_CONFIG_DIR || (process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'cursor') : join(homedir(), '.cursor'))
  try {
    const config = recordOf(JSON.parse(await readFile(join(directory, 'cli-config.json'), 'utf8')))
    const team = number(recordOf(config?.authInfo)?.activeTeamId)
    return team && Number.isSafeInteger(team) ? team : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('Could not read Cursor CLI team selection.')
  }
}

/** The read-only RPCs used by cursor-agent /usage (verified with CLI 2026.09.28). */
export async function readCursorUsage(): Promise<ProviderUsageSnapshot> {
  // Let the CLI own token refresh/migration. This starts no chat and uses its shared cache.
  await readCursorAbout()
  const team = await activeTeam()
  const request = async (method: string, retry = true): Promise<unknown> => {
    const token = await accessToken()
    let response: Response
    try {
      response = await fetch(API + method, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1', 'x-cursor-client-type': 'cli',
          ...(team ? { 'x-cursor-team-id': String(team) } : {}) },
        body: JSON.stringify(method === 'GetMe' && team ? { teamId: team } : {}), signal: AbortSignal.timeout(10_000) })
    } catch { throw new Error('Could not reach Cursor subscription usage.') }
    if (response.status === 401 && retry) {
      await readCursorAbout(0)
      return request(method, false)
    }
    if (!response.ok) throw new Error(`Cursor usage request failed (${response.status}).`)
    try { return await response.json() } catch { throw new Error('Cursor returned invalid usage data.') }
  }
  const [current, plan, hard, me] = await Promise.all([
    request('GetCurrentPeriodUsage'), request('GetPlanInfo').catch(() => null),
    request('GetHardLimit').catch(() => null), request('GetMe')
  ])
  const usage = cursorPlanUsage(current, plan, hard)
  const email = recordOf(me)?.email
  return { provider: 'cursor', account: { type: 'other', email: typeof email === 'string' ? email : null, planType: usage.plan }, usage }
}
