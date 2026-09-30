import type { ChatPlanUsage, ChatPlanUsageWindow, ChatProvider, ProviderUsageSnapshot } from '../../shared/chat.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { CHAT_PROVIDERS } from '../../shared/chat-providers.js'

export const USAGE_STALE_MS = 5 * 60_000
export type UsageLevel = 'normal' | 'low' | 'critical' | 'exhausted' | 'stale' | 'unknown'
export type ProviderUsageEntry = {
  key: string
  provider: ChatProvider
  source: ChatRowSummary | null
  account: ProviderUsageSnapshot['account']
  usage: ChatPlanUsage | null
}

/** Never add quotas across chats. Keep known accounts separate; retain the newest observation. */
export function providerUsageEntries(chats: readonly ChatRowSummary[], readings?: readonly ProviderUsageSnapshot[]): ProviderUsageEntry[] {
  const entries = new Map<string, ProviderUsageEntry>()
  for (const row of chats) {
    if (!row.attached || !row.providerUsage) continue
    const { account, usage } = row.providerUsage
    const key = JSON.stringify([row.provider, account?.type ?? null, account?.email ?? null])
    const prior = entries.get(key)
    if (!prior || (usage?.updatedAt ?? -1) > (prior.usage?.updatedAt ?? -1)
      || ((usage?.updatedAt ?? -1) === (prior.usage?.updatedAt ?? -1) && row.updatedAt > (prior.source?.updatedAt ?? 0))) {
      entries.set(key, { key, provider: row.provider, source: row, account, usage })
    }
  }
  if (readings) for (const provider of CHAT_PROVIDERS) {
    const reading = readings.find((item) => item.provider === provider)
    const account = reading?.account ?? null
    const key = JSON.stringify([provider, account?.type ?? null, account?.email ?? null])
    const prior = entries.get(key)
    const providerEntries = [...entries.values()].filter((item) => item.provider === provider)
    // A placeholder must not create an extra unknown-account tab beside live telemetry.
    if (!reading && providerEntries.length) continue
    if (!account && providerEntries.length) {
      if (reading?.usage) for (const item of providerEntries) {
        if (!item.account && reading.usage.updatedAt > (item.usage?.updatedAt ?? -1)) item.usage = reading.usage
      }
      continue
    }
    if (!prior || (reading?.usage?.updatedAt ?? -1) >= (prior.usage?.updatedAt ?? -1)) {
      entries.set(key, { key, provider, source: null, account, usage: reading?.usage ?? null })
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

/** The chip shows the lowest remaining window; the detail names every scope rather than guessing model eligibility. */
export function usageHeadline(usage: ChatPlanUsage | null, now: number): {
  text: string; level: UsageLevel; window: ChatPlanUsageWindow | null; remaining: number | null
} {
  if (!usage || usage.unavailable || !usage.windows.length) {
    return { text: 'Unavailable', level: 'unknown', window: null, remaining: null }
  }
  const windows = usage.windows.filter((window) => Number.isFinite(window.percent))
  if (!windows.length) return { text: 'Unavailable', level: 'unknown', window: null, remaining: null }
  const window = windows.reduce((lowest, next) => next.percent > lowest.percent ? next : lowest)
  const state = usageWindowState(window, usage, now)
  // Do not present a fresh overall minimum when any other bucket is unverified.
  const stale = windows.some((entry) => usageWindowState(entry, usage, now).level === 'stale')
  const level = stale ? 'stale' : state.level
  const remaining = state.remaining
  const text = remaining === null ? 'Unavailable' : stale ? `${remaining}% stale` : `${remaining}% remaining`
  return { text, level, window, remaining }
}

export type UsageChipDisplay = {
  /** Remaining percent for the bar and figure; null when the provider reports no numeric quota. */
  remaining: number | null
  /** The chip figure: a percent, or the plan name when no quota is reported. */
  text: string
  level: UsageLevel
  ariaLabel: string
}

/** Rail chip: mark, remaining percent and a short bar; the plan name alone when no numeric window exists. */
export function usageChipDisplay(
  usage: ChatPlanUsage | null,
  plan: string | null,
  now: number,
  providerLabel: string
): UsageChipDisplay {
  const headline = usageHeadline(usage, now)
  if (headline.remaining === null) {
    const name = usage?.plan ?? plan
    return {
      remaining: null,
      text: name ?? 'Unavailable',
      level: headline.level,
      ariaLabel: `${providerLabel}: ${name ? `${name} · usage unavailable` : headline.text}`
    }
  }
  const detail = headline.window ? ` · lowest: ${headline.window.label}` : ''
  return {
    remaining: headline.remaining,
    text: `${headline.remaining}%`,
    level: headline.level,
    ariaLabel: `${providerLabel}: ${headline.text}${detail}`
  }
}

export function usageChipText(usage: ChatPlanUsage | null, plan: string | null, now: number): string {
  return usageChipDisplay(usage, plan, now, '').text
}
