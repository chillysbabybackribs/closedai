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

function accountKey(provider: ChatProvider, account: ProviderUsageSnapshot['account']): string {
  return JSON.stringify([provider, account?.type ?? null, account?.email ?? null])
}

/** Never add quotas across chats. Keep known accounts separate; retain the newest observation. */
export function providerUsageEntries(chats: readonly ChatRowSummary[], readings?: readonly ProviderUsageSnapshot[]): ProviderUsageEntry[] {
  const entries = new Map<string, ProviderUsageEntry>()
  for (const row of chats) {
    if (!row.attached || !row.providerUsage) continue
    const { account, usage } = row.providerUsage
    const key = accountKey(row.provider, account)
    const prior = entries.get(key)
    if (!prior || (usage?.updatedAt ?? -1) > (prior.usage?.updatedAt ?? -1)
      || ((usage?.updatedAt ?? -1) === (prior.usage?.updatedAt ?? -1) && row.updatedAt > (prior.source?.updatedAt ?? 0))) {
      entries.set(key, { key, provider: row.provider, source: row, account, usage })
    }
  }
  if (readings) for (const provider of CHAT_PROVIDERS) {
    const reading = readings.find((item) => item.provider === provider)
    const account = reading?.account ?? null
    const key = accountKey(provider, account)
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

/** A plan's lowest remaining window; every scope keeps its own row rather than guessing model eligibility. */
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

export type UsageTightest = {
  entry: ProviderUsageEntry
  window: ChatPlanUsageWindow
  remaining: number
  level: UsageLevel
}

/** The one window across every plan closest to empty: the dock figure and the flyout's summary line. */
export function tightestUsage(entries: readonly ProviderUsageEntry[], now: number): UsageTightest | null {
  let tightest: UsageTightest | null = null
  for (const entry of entries) {
    const { window, remaining, level } = usageHeadline(entry.usage, now)
    if (!window || remaining === null) continue
    if (!tightest || remaining < tightest.remaining) tightest = { entry, window, remaining, level }
  }
  return tightest
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/**
 * How long a window runs, read from the label main gives it (plan-usage.ts names rolling windows
 * by length). A month is measured back from its own reset. Null when the label names no length.
 */
export function usageWindowDuration(window: ChatPlanUsageWindow): number | null {
  const label = window.label.trim().toLowerCase()
  const counted = /^(\d+)-(minute|hour|day)\b/.exec(label)
  if (counted) return Number(counted[1]) * (counted[2] === 'minute' ? 60_000 : counted[2] === 'hour' ? HOUR_MS : DAY_MS)
  if (label.startsWith('daily')) return DAY_MS
  if (label.startsWith('weekly')) return 7 * DAY_MS
  if (label.startsWith('monthly') && window.resetsAt !== null) {
    const start = new Date(window.resetsAt)
    start.setMonth(start.getMonth() - 1)
    return window.resetsAt - start.getTime()
  }
  return null
}

export type UsagePace = {
  /** When the allowance reaches zero if spending continues at the window's average rate so far. */
  runsOutAt: number
  /** How long before the reset that is. */
  shortBy: number
}

/**
 * A straight-line projection of the window's average rate so far. It speaks only when that rate
 * empties the window before it resets, and only once a tenth of both the window and the allowance
 * has gone: before that the rate is one burst, not a pace.
 */
export function usagePace(window: ChatPlanUsageWindow, usage: ChatPlanUsage, now: number): UsagePace | null {
  const { level, observedAt } = usageWindowState(window, usage, now)
  if (level === 'stale' || level === 'unknown' || level === 'exhausted' || window.resetsAt === null) return null
  const duration = usageWindowDuration(window)
  if (!duration) return null
  const elapsed = duration - (window.resetsAt - observedAt)
  if (elapsed < duration / 10 || window.percent < 10) return null
  const runsOutAt = observedAt + elapsed * (100 - window.percent) / window.percent
  const shortBy = window.resetsAt - runsOutAt
  // A margin under a twentieth of the window is inside the projection's own error.
  if (shortBy < duration / 20) return null
  return { runsOutAt, shortBy }
}

/** "45m", "2h 14m", "5d 8h": two units, so a reset days away does not read the same all day. */
export function spanNote(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`
}

/** One rounded unit ("5d", "3h"), for a span that sits beside an exact one. */
export function roughSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

/** The flyout's one-line answer to "am I fine?", naming the window that decides it. */
export function usageVerdict(tightest: UsageTightest | null, providerLabel: string, now: number): string {
  if (!tightest) return 'No plan has reported a quota yet.'
  const { window, remaining, level } = tightest
  const name = `${providerLabel} ${window.label}`
  const reset = window.resetsAt !== null && window.resetsAt > now ? `resets in ${spanNote(window.resetsAt - now)}` : null
  if (level === 'stale') return `Lowest reading is ${name} at ${remaining}% left, but it is out of date.`
  if (level === 'exhausted') return `${name} is used up${reset ? ` and ${reset}` : ''}.`
  if (level === 'normal') return `Every plan has room. The tightest is ${name} at ${remaining}% left.`
  return `${name} is down to ${remaining}% left${reset ? ` and ${reset}` : ''}.`
}
