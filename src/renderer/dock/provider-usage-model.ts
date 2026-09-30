import type { ChatPlanUsage, ChatPlanUsageWindow, ChatProvider } from '../../shared/chat.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { CHAT_PROVIDERS } from '../../shared/chat-providers.js'

export const USAGE_STALE_MS = 5 * 60_000
export type UsageLevel = 'normal' | 'low' | 'critical' | 'exhausted' | 'stale' | 'unknown'
export type ProviderUsageEntry = {
  key: string
  provider: ChatProvider
  source: ChatRowSummary
  usage: ChatPlanUsage | null
}

/** Never add quotas across chats. Keep known accounts separate; retain the newest observation. */
export function providerUsageEntries(chats: readonly ChatRowSummary[]): ProviderUsageEntry[] {
  const entries = new Map<string, ProviderUsageEntry>()
  for (const row of chats) {
    if (!row.attached || !row.providerUsage) continue
    const { account, usage } = row.providerUsage
    const key = JSON.stringify([row.provider, account?.type ?? null, account?.email ?? null])
    const prior = entries.get(key)
    if (!prior || (usage?.updatedAt ?? -1) > (prior.usage?.updatedAt ?? -1)
      || ((usage?.updatedAt ?? -1) === (prior.usage?.updatedAt ?? -1) && row.updatedAt > prior.source.updatedAt)) {
      entries.set(key, { key, provider: row.provider, source: row, usage })
    }
  }
  return [...entries.values()].sort((a, b) => CHAT_PROVIDERS.indexOf(a.provider) - CHAT_PROVIDERS.indexOf(b.provider)
    || a.key.localeCompare(b.key))
}

export function usageWindowState(window: ChatPlanUsageWindow, usage: ChatPlanUsage, now: number): {
  remaining: number | null; level: UsageLevel; observedAt: number
} {
  const observedAt = window.updatedAt ?? usage.updatedAt
  if (!Number.isFinite(window.percent)) return { remaining: null, level: 'unknown', observedAt }
  const remaining = Math.max(0, Math.min(100, 100 - window.percent))
  // A reset passing is not evidence of a replenished allowance. Wait for the provider to report it.
  if (!(observedAt > 0) || now - observedAt > USAGE_STALE_MS || (window.resetsAt !== null && window.resetsAt <= now)) {
    return { remaining, level: 'stale', observedAt }
  }
  const level = remaining <= 0 ? 'exhausted' : remaining <= 10 ? 'critical' : remaining <= 20 ? 'low' : 'normal'
  return { remaining, level, observedAt }
}

/** The chip explicitly says “lowest”; the detail names every scope rather than guessing model eligibility. */
export function usageHeadline(usage: ChatPlanUsage | null, now: number): {
  text: string; level: UsageLevel; window: ChatPlanUsageWindow | null
} {
  if (!usage || usage.unavailable || !usage.windows.length) return { text: 'Unavailable', level: 'unknown', window: null }
  const windows = usage.windows.filter((window) => Number.isFinite(window.percent))
  if (!windows.length) return { text: 'Unavailable', level: 'unknown', window: null }
  const window = windows.reduce((lowest, next) => next.percent > lowest.percent ? next : lowest)
  const state = usageWindowState(window, usage, now)
  // Do not present a fresh overall minimum when any other bucket is unverified.
  const stale = windows.some((entry) => usageWindowState(entry, usage, now).level === 'stale')
  return { text: stale ? 'Stale' : `${state.remaining}% left`, level: stale ? 'stale' : state.level, window }
}
