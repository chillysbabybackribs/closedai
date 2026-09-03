import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '../components/ui/hover-card.js'
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

export type ContextMeterProps = {
  usage: ChatContextUsage | null
  provider: ChatProvider
  /** The account's plan windows, cached between readings; null until one lands. */
  planUsage: ChatPlanUsage | null
  onInspect: () => void
  /** Asked for a fresh reading each time the card opens, including mid-turn. */
  onRefreshPlanUsage: () => Promise<void>
}

/** How full the model's window is, drawn as a ring beside the model that owns that window.
 *  Silent until the first response reports usage, and self-explaining once it is warm: the
 *  ring carries the proportion, the label the number, and the card the token counts plus the
 *  subscription windows the turn is spending — the one place both meters belong together.
 *
 *  The card is one monochrome list: the meter itself already colours the one number that
 *  warrants it, so repeating that colour per row made a quiet reading look like an alarm. */
export function ContextMeter({ usage, provider, planUsage, onInspect, onRefreshPlanUsage }: ContextMeterProps): JSX.Element {
  const percent = Math.min(100, Math.max(0, usage?.percent ?? 0))
  const level = percent >= HOT_PERCENT ? 'hot' : percent >= WARM_PERCENT ? 'warm' : 'cool'
  const detail = usage
    ? `Context — ${percent}% full, ${formatTokens(usage.usedTokens)} of ${formatTokens(usage.contextWindow)} tokens`
    : 'Context and plan usage'
  return (
    <HoverCard openDelay={120} closeDelay={80} onOpenChange={(open) => { if (open) void onRefreshPlanUsage() }}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="context-meter"
          data-ui="composer.context"
          data-level={level}
          aria-label={detail}
          onClick={onInspect}
        >
          <svg className="context-meter-ring" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <circle className="context-meter-track" cx="7" cy="7" r={RADIUS} />
            <circle
              className="context-meter-fill"
              cx="7"
              cy="7"
              r={RADIUS}
              strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`}
            />
          </svg>
          <span className="context-meter-value">{usage ? `${percent}%` : 'Context'}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="usage-card" align="end" side="top" data-ui="composer.usage-card">
        <UsageCardBody provider={provider} usage={usage} planUsage={planUsage} />
      </HoverCardContent>
    </HoverCard>
  )
}

function UsageCardBody({ provider, usage, planUsage }: {
  provider: ChatProvider
  usage: ChatContextUsage | null
  planUsage: ChatPlanUsage | null
}): JSX.Element {
  const now = useNow(planUsage !== null)
  const stale = planUsage && planUsage.updatedAt > 0 && now - planUsage.updatedAt > STALE_MS
  return (
    <>
      <p className="usage-card-title">
        {CHAT_PROVIDER_LABELS[provider]}{planUsage?.plan ? ` · ${planUsage.plan}` : ''}
      </p>
      <UsageRow
        label="Context"
        percent={usage?.percent ?? 0}
        aside={usage ? `${formatTokens(usage.usedTokens)}/${formatTokens(usage.contextWindow)}` : '—'}
      />
      {planUsage?.windows.map((window) => (
        <UsageRow
          key={window.label}
          label={window.label}
          percent={window.percent}
          aside={`${window.percent}%${window.resetsAt ? ` · ${resetNote(window.resetsAt, now)}` : ''}`}
        />
      ))}
      {planUsage?.unavailable && <p className="usage-card-note">{planUsage.unavailable}</p>}
      {planUsage?.note && <p className="usage-card-note">{planUsage.note}</p>}
      {stale && <p className="usage-card-note">Read {ageNote(now - planUsage.updatedAt)}</p>}
    </>
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

/** A minute-resolution clock, running only while the card is showing a reading to date. */
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

function formatTokens(tokens: number): string {
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
