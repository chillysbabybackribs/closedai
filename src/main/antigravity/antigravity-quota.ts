import type { ChatPlanUsage } from '../../shared/chat.js'
import { antigravityPlanUsage, planUsageUnavailable } from '../chat-context/plan-usage.js'
import { messageOf } from '../chat-normalizers.js'
import { runAntigravityCommand } from './antigravity-cli.js'

/** Fallback reading when the CLI does not report subscription usage or fails. */
export const ANTIGRAVITY_PLAN_USAGE_UNAVAILABLE = planUsageUnavailable('The agy CLI does not report subscription usage.', 0)

/**
 * How long a quota reading serves every pane before any of them asks the CLI again. `/quota` is
 * a two-second `agy` process; with one per new chat, one per hover and one per turn end, quota
 * reads were most of what Antigravity spent on a chat that had not said anything yet. Hover and
 * turn end still request a reading; they only spawn when the shared one is older than this.
 */
export const ANTIGRAVITY_QUOTA_REUSE_MS = 60_000

let lastQuotaReading: { at: number; usage: ChatPlanUsage } | null = null

/** Test seam: forget the shared quota reading. */
export function forgetAntigravityQuota(): void {
  lastQuotaReading = null
}

export async function readAntigravityPlanUsage(reuseWithinMs = ANTIGRAVITY_QUOTA_REUSE_MS): Promise<ChatPlanUsage | 'reuse' | 'unchanged'> {
  if (lastQuotaReading && Date.now() - lastQuotaReading.at < reuseWithinMs) {
    return 'reuse'
  }
  try {
    const result = await runAntigravityCommand(['-p', '/quota', '--output-format', 'json'])
    if (!result.ok) return 'unchanged'
    const parsed = JSON.parse(result.stdout) as unknown
    const usage = antigravityPlanUsage(parsed)
    if (!usage) return 'unchanged'
    lastQuotaReading = { at: Date.now(), usage }
    return usage
  } catch (error) {
    console.warn('[antigravity] could not read plan usage:', messageOf(error))
    return 'unchanged'
  }
}

export function cachedAntigravityPlanUsage(): ChatPlanUsage | null {
  return lastQuotaReading?.usage ?? null
}
