import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import type { ChatContextUsage, ChatPlanUsage, ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'

/** Latency stays flat with context (prompt cache), so the colour tracks how much old history the
 * model is wading through; past these, quality drifts and a fresh chat is worth considering. */
const WARM_PERCENT = 50
const HOT_PERCENT = 75

const RADIUS = 5.25
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Past this a reading is worth dating, so a parked provider's numbers are not read as live. */
const STALE_MS = 5 * 60 * 1000

export type ContextLevel = 'cool' | 'warm' | 'hot'

export function contextLevel(percent: number): ContextLevel {
  return percent >= HOT_PERCENT ? 'hot' : percent >= WARM_PERCENT ? 'warm' : 'cool'
}

export function ContextMeterRing({
  percent,
  level,
  size = 14,
  className = 'context-meter-ring'
}: {
  percent: number
  level?: ContextLevel
  size?: number
  className?: string
}): JSX.Element {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <svg className={className} data-level={level} viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
      <circle className="context-meter-track" cx="7" cy="7" r={RADIUS} />
      <circle
        className="context-meter-fill"
        cx="7"
        cy="7"
        r={RADIUS}
        strokeDasharray={`${(CIRCUMFERENCE * clamped) / 100} ${CIRCUMFERENCE}`}
      />
    </svg>
  )
}

export type ContextUsageProps = {
  usage: ChatContextUsage | null
  provider: ChatProvider
  /** The account's plan windows, cached between readings; null until one lands. */
  planUsage: ChatPlanUsage | null
  /** Re-seed provider-side context when the active provider supports it. */
  onCompact?: () => Promise<void>
  compactEnabled?: boolean
  modelName?: string | null
  modelContext?: string | null
  modelDescription?: string | null
}

/** How full the model's window is, with the subscription windows the turn is spending. Lives in
 *  the composer's setup panel; silent about tokens until the first response reports usage. */
export function ContextUsage({
  provider,
  usage,
  planUsage,
  modelName,
  modelContext,
  modelDescription,
  onCompact,
  compactEnabled = false
}: ContextUsageProps): JSX.Element {
  const now = useNow(planUsage !== null)
  const percent = Math.min(100, Math.max(0, usage?.percent ?? 0))
  const level = contextLevel(percent)
  const stale = planUsage && planUsage.updatedAt > 0 && now - planUsage.updatedAt > STALE_MS
  const contextAside = usage
    ? `${formatTokens(usage.usedTokens)}/${formatTokens(usage.contextWindow)}`
    : (modelContext ? `—/${modelContext}` : '—')

  return (
    <div className="usage-card" data-level={level} data-ui="composer.usage">
      <p className="usage-card-title">
        {modelName ?? CHAT_PROVIDER_LABELS[provider]}
        {modelContext ? ` · ${modelContext}` : ''}
        {planUsage?.plan ? ` · ${planUsage.plan}` : ''}
      </p>
      <div className="usage-row">
        <div className="usage-row-line">
          <span className="usage-row-label">
            <ContextMeterRing percent={percent} level={level} size={13} />
            Context
          </span>
          <span className="usage-row-aside">{contextAside}</span>
        </div>
        <div className="usage-row-track" role="presentation">
          <div className="usage-row-fill" data-level={level} style={{ width: `${percent}%` }} />
        </div>
      </div>
      {planUsage?.windows.map((window) => (
        <UsageRow
          key={window.label}
          label={window.label}
          percent={window.percent}
          aside={`${window.percent}%${window.resetsAt ? ` · ${resetNote(window.resetsAt, now)}` : ''}`}
        />
      ))}
      {onCompact && (
        <div className="usage-card-actions">
          <button
            type="button"
            className="usage-card-action"
            data-ui="composer.compact"
            disabled={!compactEnabled}
            onClick={() => { void onCompact() }}
          >
            Shrink provider context
          </button>
        </div>
      )}
      {modelDescription && <p className="usage-card-note">{modelDescription}</p>}
      {planUsage?.unavailable && <p className="usage-card-note">{planUsage.unavailable}</p>}
      {planUsage?.note && <p className="usage-card-note">{planUsage.note}</p>}
      {stale && <p className="usage-card-note">Read {ageNote(now - planUsage.updatedAt)}</p>}
    </div>
  )
}

function UsageRow({ label, percent, aside }: { label: string; percent: number; aside: string }): JSX.Element {
  return (
    <div className="usage-row">
      <div className="usage-row-line">
        <span className="usage-row-label">{label}</span>
        <span className="usage-row-aside">{aside}</span>
      </div>
      <div className="usage-row-track" role="presentation">
        <div className="usage-row-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  )
}

/** A minute-resolution clock, running only while the panel is showing a reading to date. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/** 61.2k below 100k, 200k above; small counts stay whole. */
export function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k` : String(tokens)
}

/** The wait until a window rolls over, at one unit: the hour a weekly window resets is noise. */
export function resetNote(resetsAt: number, now: number): string {
  const minutes = Math.round((resetsAt - now) / 60_000)
  if (minutes <= 0) return 'resetting'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

/** How old a reading is, for the line that admits it is not live. */
export function ageNote(ageMs: number): string {
  const minutes = Math.round(ageMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}
