import type { ChatPlanUsage, ChatPlanUsageWindow } from '../../shared/chat.js'
import { recordOf } from '../chat-normalizers.js'

// The signed-in account's quota, normalized across providers. Codex and Claude both report
// rolling windows (a short one and a weekly one) but in different shapes and units: Codex
// gives minutes and epoch seconds, Claude gives named buckets and ISO timestamps. The pane
// shows one thing, so both land here first.

/** Names a rolling window by its length, the way each provider's own UI names it. */
export function planWindowLabel(minutes: number): string {
  if (!(minutes > 0)) return 'Usage'
  if (minutes === 10_080) return 'Weekly'
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440
    return days === 1 ? 'Daily' : `${days}-day`
  }
  if (minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-minute`
}

const CODEX_PLAN_NAMES: Record<string, string> = {
  go: 'Go',
  pro: 'Pro',
  prolite: 'Pro Lite',
  plus: 'Plus',
  team: 'Team',
  edu: 'Edu',
  enterprise: 'Enterprise'
}

/** Prettify a provider's plan id; unknown ids are humanized rather than hidden. */
export function planName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  return CODEX_PLAN_NAMES[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The app-server's `RateLimitSnapshot`, from `account/rateLimits/read` or its notification. */
export function codexPlanUsage(value: unknown, now = Date.now()): ChatPlanUsage | null {
  const snapshot = recordOf(value)
  if (!snapshot) return null
  const windows = [snapshot.primary, snapshot.secondary]
    .map((entry) => codexWindow(entry))
    .filter((entry): entry is ChatPlanUsageWindow => entry !== null)
  const credits = recordOf(snapshot.credits)
  const note = credits?.unlimited === true
    ? 'Unlimited credits'
    : credits?.hasCredits === true && typeof credits.balance === 'string'
      ? `${credits.balance} credits`
      : null
  return { plan: planName(snapshot.planType), windows, note, unavailable: null, updatedAt: now }
}

function codexWindow(value: unknown): ChatPlanUsageWindow | null {
  const window = recordOf(value)
  if (!window || typeof window.usedPercent !== 'number') return null
  const minutes = typeof window.windowDurationMins === 'number' ? window.windowDurationMins : 0
  // The app-server reports the reset in epoch seconds; every other clock here is ms.
  const resetsAt = typeof window.resetsAt === 'number' && window.resetsAt > 0 ? window.resetsAt * 1_000 : null
  return { label: planWindowLabel(minutes), percent: clampPercent(window.usedPercent), resetsAt }
}

/** Claude's named buckets, in the order the pane should read them. */
const CLAUDE_WINDOWS: ReadonlyArray<[key: string, label: string]> = [
  ['five_hour', '5-hour'],
  ['seven_day', 'Weekly'],
  ['seven_day_opus', 'Weekly (Opus)'],
  ['seven_day_sonnet', 'Weekly (Sonnet)']
]

/** The SDK's `usage` control response: plan windows plus the subscription that owns them. */
export function claudePlanUsage(value: unknown, now = Date.now()): ChatPlanUsage | null {
  const response = recordOf(value)
  if (!response) return null
  if (response.rate_limits_available === false) {
    return {
      plan: planName(response.subscription_type),
      windows: [],
      note: null,
      unavailable: 'Plan limits do not apply to this Claude session.',
      updatedAt: now
    }
  }
  const limits = recordOf(response.rate_limits)
  if (!limits) return null
  const windows: ChatPlanUsageWindow[] = []
  for (const [key, label] of CLAUDE_WINDOWS) {
    const window = claudeWindow(limits[key], label)
    if (window) windows.push(window)
  }
  if (Array.isArray(limits.model_scoped)) {
    for (const entry of limits.model_scoped) {
      const scoped = recordOf(entry)
      const window = claudeWindow(scoped, `Weekly (${scoped?.display_name ?? 'model'})`)
      if (window) windows.push(window)
    }
  }
  const extra = recordOf(limits.extra_usage)
  const note = extra?.is_enabled === true && typeof extra.used_credits === 'number'
    ? `Extra usage: ${extra.used_credits}${typeof extra.monthly_limit === 'number' ? ` of ${extra.monthly_limit}` : ''}`
    : null
  return { plan: planName(response.subscription_type), windows, note, unavailable: null, updatedAt: now }
}

function claudeWindow(value: unknown, label: string): ChatPlanUsageWindow | null {
  const window = recordOf(value)
  if (!window || typeof window.utilization !== 'number') return null
  const resets = typeof window.resets_at === 'string' ? Date.parse(window.resets_at) : NaN
  return { label, percent: clampPercent(window.utilization), resetsAt: Number.isFinite(resets) ? resets : null }
}

/** Claude's `rate_limit_event` names one window it just moved. */
const CLAUDE_EVENT_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly (Opus)',
  seven_day_sonnet: 'Weekly (Sonnet)',
  seven_day_overage_included: 'Weekly'
}

export type ClaudeRateLimitSignal = { label: string; percent: number; resetsAt: number | null }

/**
 * The one window a mid-turn `rate_limit_event` reports. The full reading costs a control
 * request; this keeps the hover card moving during a long turn without one.
 */
export function claudeRateLimitSignal(info: Record<string, unknown>): ClaudeRateLimitSignal | null {
  const label = CLAUDE_EVENT_LABELS[String(info.rateLimitType ?? '')]
  if (!label || typeof info.utilization !== 'number') return null
  // The event's `resetsAt` is epoch seconds, unlike the ISO timestamps in the usage response.
  const resetsAt = typeof info.resetsAt === 'number' && info.resetsAt > 0 ? info.resetsAt * 1_000 : null
  return { label, percent: clampPercent(info.utilization), resetsAt }
}

/** Fold a single-window signal into the last full reading, so nothing else goes stale silently. */
export function applyPlanUsageSignal(
  current: ChatPlanUsage | null,
  signal: ClaudeRateLimitSignal,
  now = Date.now()
): ChatPlanUsage {
  const window: ChatPlanUsageWindow = { label: signal.label, percent: signal.percent, resetsAt: signal.resetsAt }
  if (!current) return { plan: null, windows: [window], note: null, unavailable: null, updatedAt: now }
  const windows = current.windows.some((entry) => entry.label === signal.label)
    ? current.windows.map((entry) => (entry.label === signal.label ? window : entry))
    : [...current.windows, window]
  return { ...current, windows, unavailable: null, updatedAt: now }
}

/** A provider that has no plan usage to report says so, rather than showing an empty card. */
export function planUsageUnavailable(reason: string, now = Date.now()): ChatPlanUsage {
  return { plan: null, windows: [], note: null, unavailable: reason, updatedAt: now }
}

/** Short group qualifier for Antigravity's multi-group windows. */
function antigravityGroupLabel(groupName: string): string {
  if (/gemini/i.test(groupName)) return 'Gemini'
  if (/claude|gpt|3p/i.test(groupName)) return 'Claude & GPT'
  return groupName.replace(/\s*models\s*/i, '').trim() || groupName
}

function antigravityWindowLabel(window: string, groupLabel: string, multipleGroups: boolean): string {
  const base = window === '5h' ? '5-hour' : window === 'weekly' ? 'Weekly' : window
  return multipleGroups ? `${base} (${groupLabel})` : base
}

/**
 * The agy CLI's `/quota` response: model group buckets with remaining fractions and reset times.
 */
export function antigravityPlanUsage(value: unknown, now = Date.now()): ChatPlanUsage | null {
  const root = recordOf(value)
  if (!root) return null
  const command = recordOf(root.command)
  const data = recordOf(command?.data)
  const rawGroups = Array.isArray(data?.groups) ? data.groups : null
  const windows: ChatPlanUsageWindow[] = []

  if (rawGroups && rawGroups.length > 0) {
    const multipleGroups = rawGroups.length > 1
    for (const rawGroup of rawGroups) {
      const group = recordOf(rawGroup)
      if (!group) continue
      const groupName = typeof group.name === 'string' ? group.name : ''
      const groupLabel = antigravityGroupLabel(groupName)
      const rawBuckets = Array.isArray(group.buckets) ? [...group.buckets] : []
      rawBuckets.sort((a, b) => {
        const wa = recordOf(a)?.window === '5h' ? 0 : 1
        const wb = recordOf(b)?.window === '5h' ? 0 : 1
        return wa - wb
      })
      for (const rawBucket of rawBuckets) {
        const bucket = recordOf(rawBucket)
        if (!bucket) continue
        const windowKey = typeof bucket.window === 'string' ? bucket.window : ''
        const fraction = typeof bucket.remaining_fraction === 'number' ? bucket.remaining_fraction : null
        if (fraction === null) continue
        const percent = clampPercent((1 - fraction) * 100)
        const resetParsed = typeof bucket.reset_time === 'string' ? Date.parse(bucket.reset_time) : NaN
        const resetsAt = Number.isFinite(resetParsed) ? resetParsed : null
        const label = antigravityWindowLabel(windowKey, groupLabel, multipleGroups)
        windows.push({ label, percent, resetsAt })
      }
    }
  } else if (typeof root.response === 'string') {
    const lines = root.response.trim().split('\n').map((s) => s.trim()).filter(Boolean)
    for (const line of lines) {
      const parts = line.split('\t').map((s) => s.trim())
      if (parts.length >= 3) {
        const [group, name, pct, resetStr] = parts
        const remPct = parseInt(pct.replace('%', ''), 10)
        if (!isNaN(remPct)) {
          const percent = clampPercent(100 - remPct)
          const resetParsed = resetStr ? Date.parse(resetStr) : NaN
          const resetsAt = Number.isFinite(resetParsed) ? resetParsed : null
          const is5h = /five.*hour|5.?h/i.test(name)
          const isWeekly = /week/i.test(name)
          const base = is5h ? '5-hour' : isWeekly ? 'Weekly' : name
          const groupLabel = antigravityGroupLabel(group)
          windows.push({ label: `${base} (${groupLabel})`, percent, resetsAt })
        }
      }
    }
  }

  if (windows.length === 0) return null
  return { plan: null, windows, note: null, unavailable: null, updatedAt: now }
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

